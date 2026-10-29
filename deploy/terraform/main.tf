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

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
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

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    repo_url   = var.repo_url
    repo_ref   = var.repo_ref
    web_host   = local.web_host
    api_host   = local.api_host
    ledger_key = random_id.ledger_key.hex
  })
  user_data_replace_on_change = true

  tags = { Name = "battle-arena" }
}

resource "aws_eip_association" "web" {
  instance_id   = aws_instance.web.id
  allocation_id = aws_eip.web.id
}
