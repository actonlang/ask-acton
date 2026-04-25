variable "hostname" {
  type    = string
  default = "ask-acton-01"
}

variable "datacenter" {
  type    = string
  default = "Stockholm"
}

variable "template" {
  type    = string
  default = "debian-12"
}

variable "cpu" {
  type    = number
  default = 2
}

variable "memory" {
  type    = number
  default = 2048
}

variable "storage" {
  type    = number
  default = 30
}

variable "bandwidth" {
  type    = number
  default = 100
}

variable "ssh_user" {
  type    = string
  default = "acton"
}

variable "ssh_public_keys" {
  type = list(string)
}
