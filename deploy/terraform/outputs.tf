output "ip" {
  value = aws_eip.web.public_ip
}

output "web_url" {
  value = "https://${local.web_host}"
}

output "api_url" {
  value = "https://${local.api_host}"
}

output "ssh_command" {
  value = "ssh -i ~/.ssh/battle-arena ubuntu@${aws_eip.web.public_ip}"
}

output "instance_id" {
  value = aws_instance.web.id
}

output "data_volume_id" {
  value = aws_ebs_volume.data.id
}
