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
  default = 4
}

variable "memory" {
  type    = number
  default = 4096
}

variable "storage" {
  type    = number
  default = 50
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
