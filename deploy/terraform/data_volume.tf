# App data lives on its own EBS volume, apart from the instance's root disk.
# On 2026-11-10 an apply replaced the instance and its root disk, with every
# Docker volume on it, was deleted. This volume is not deleted with the
# instance: if the instance is ever replaced, the attachment moves it to the
# new one. The server bind-mounts it over /var/lib/docker/volumes (see
# deploy/move-volumes-to-ebs.sh), so Kamal and the apps see no difference.
resource "aws_ebs_volume" "data" {
  availability_zone = var.availability_zone
  size              = var.data_volume_size
  type              = "gp3"
  encrypted         = true

  tags = { Name = "battle-arena-data", Snapshot = "battle-arena-daily" }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "data" {
  # Shows up on the server as /dev/nvme1n1; the move script finds it by
  # volume id instead (/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_vol...).
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.web.id
}

# Nightly snapshots of every volume tagged Snapshot=battle-arena-daily (the
# data volume and the root disk), kept for 14 days. These stay in this AWS
# account, so they cover a deleted or broken disk; the nightly age+rclone
# backups to R2 still cover losing the account.
resource "aws_iam_role" "dlm" {
  name = "battle-arena-dlm"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "dlm.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "daily" {
  description        = "battle-arena nightly EBS snapshots"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { Snapshot = "battle-arena-daily" }

    schedule {
      name = "nightly"
      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        # After the 00:15 (Bunna) and 00:20 (battle-arena) off-site backups.
        times = ["01:00"]
      }
      retain_rule {
        count = 14
      }
      copy_tags = true
    }
  }
}
