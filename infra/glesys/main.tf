terraform {
  required_version = ">= 1.6.0"

  required_providers {
    glesys = {
      source  = "glesys/glesys"
      version = "~> 0.16"
    }
  }
}

provider "glesys" {}

resource "glesys_server" "ask_acton" {
  hostname   = var.hostname
  datacenter = var.datacenter
  platform   = "KVM"
  template   = var.template
  cpu        = var.cpu
  memory     = var.memory
  storage    = var.storage
  bandwidth  = var.bandwidth

  cloudconfig = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    ssh_user        = var.ssh_user
    ssh_public_keys = var.ssh_public_keys
  })

  user {
    username   = var.ssh_user
    publickeys = var.ssh_public_keys
  }
}
