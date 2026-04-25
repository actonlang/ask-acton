# GleSYS VM

This Terraform module creates the first `ask-acton-01` VM and installs
Docker, Docker Compose, Git, and a basic firewall through cloud-init.

Authentication uses the GleSYS provider defaults:

```sh
export GLESYS_USERID=CL12345
export GLESYS_TOKEN=...
```

Create `terraform.tfvars`:

```hcl
ssh_public_keys = [
  "ssh-ed25519 ..."
]
```

Then run:

```sh
terraform init
terraform plan
terraform apply
```

The provider and exact template names should be checked against the
GleSYS project before applying. The defaults are intentionally small:
2 vCPU, 2 GiB RAM, and 30 GiB disk.
