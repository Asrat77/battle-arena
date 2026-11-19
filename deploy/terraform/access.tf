# Break-glass access through AWS Systems Manager Session Manager. Day to day,
# SSH goes over Tailscale and port 22 is closed to the internet. If Tailscale
# or sshd ever breaks, this still opens a shell with no open port:
#   aws ssm start-session --target <instance id> --region eu-west-1
# (needs the Session Manager plugin for the AWS CLI on the Mac). Ubuntu's AWS
# images ship the SSM agent already.
resource "aws_iam_role" "server" {
  name = "battle-arena-server"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "server" {
  name = "battle-arena-server"
  role = aws_iam_role.server.name
}
