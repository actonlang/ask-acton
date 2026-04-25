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
../../scripts/tofu init
../../scripts/tofu plan
../../scripts/tofu apply
```

The wrapper runs OpenTofu in Docker, so OpenTofu does not need to be
installed locally. It passes through `GLESYS_USERID` and `GLESYS_TOKEN`
from the host environment.

The provider and exact template names should be checked against the
GleSYS project before applying. The defaults are sized for the first
playground version: 4 vCPU, 4 GiB RAM, and 50 GiB disk.
