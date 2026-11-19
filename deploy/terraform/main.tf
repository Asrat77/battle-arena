terraform {
  required_version = ">= 1.5"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "aws" {
  region = var.region
}

data "aws_vpc" "default" {
  default = true
}

data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

resource "random_id" "ledger_key" {
  byte_length = 32
}

resource "aws_key_pair" "deploy" {
  key_name   = "battle-arena"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

resource "aws_security_group" "web" {
  name_prefix = "battle-arena-"
  description = "Battle Arena: SSH, HTTP, HTTPS"
  vpc_id      = data.aws_vpc.default.id

  # SSH goes over Tailscale (see deploy/README.md), so port 22 is closed to the
  # internet by default. Pass -var ssh_cidr=<ip>/32 only to open it for a while.
  dynamic "ingress" {
    for_each = var.ssh_cidr == "" ? [] : [var.ssh_cidr]
    content {
      description = "SSH"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }
  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_eip" "web" {
  domain = "vpc"
}

locals {
  web_host = "${aws_eip.web.public_ip}.sslip.io"
  api_host = "api.${aws_eip.web.public_ip}.sslip.io"
}

resource "aws_instance" "web" {
  ami                    = data.aws_ssm_parameter.ubuntu.value
  instance_type          = var.instance_type
  key_name               = aws_key_pair.deploy.key_name
  vpc_security_group_ids = [aws_security_group.web.id]
  # Fixed so the data volume (same AZ only) can always be attached. It is the
  # zone the server already runs in, so this changes nothing on the live one.
  availability_zone = var.availability_zone
  # Session Manager: a way in that needs no open port, for when SSH is broken.
  iam_instance_profile = aws_iam_instance_profile.server.name

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    # Picked up by the nightly snapshot policy in data_volume.tf.
    tags = { Name = "battle-arena-root", Snapshot = "battle-arena-daily" }
  }

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    repo_url   = var.repo_url
    repo_ref   = var.repo_ref
    web_host   = local.web_host
    api_host   = local.api_host
    ledger_key = random_id.ledger_key.hex
    # nvme by-id names drop the dash: vol-0abc -> vol0abc.
    data_volume = replace(aws_ebs_volume.data.id, "-", "")
  })
  user_data_replace_on_change = false

  # Docker volumes now live on aws_ebs_volume.data, which outlives this
  # instance, but the root disk still holds the rest of the setup (kamal-proxy
  # certificates, backup scripts, cron, Tailscale), so nothing here may
  # replace it either. user_data: the running server booted from the older
  # Compose script; only new servers use the new one. ami: the SSM parameter
  # above always points at Canonical's newest image, so without this every new
  # Ubuntu release turns the next apply into destroy-and-recreate. That is how
  # the 2026-11-10 apply (a routine ssh_cidr change) wiped the server.
  # prevent_destroy makes any plan that would destroy it fail instead.
  lifecycle {
    ignore_changes  = [user_data, ami]
    prevent_destroy = true
  }

  tags = { Name = "battle-arena" }
}

resource "aws_eip_association" "web" {
  instance_id   = aws_instance.web.id
  allocation_id = aws_eip.web.id
}
