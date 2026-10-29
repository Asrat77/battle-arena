variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "ssh_cidr" {
  type        = string
  description = "CIDR allowed to SSH, e.g. 203.0.113.4/32"
}

variable "ssh_public_key_path" {
  type    = string
  default = "~/.ssh/battle-arena.pub"
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}

variable "repo_url" {
  type    = string
  default = "https://github.com/Asrat77/battle-arena"
}

variable "repo_ref" {
  type        = string
  description = "Branch to deploy; switch to main once the deploy PR is merged"
  default     = "claude/project-thread-vbt8uk"
}
