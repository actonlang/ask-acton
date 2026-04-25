# GleSYS VM

This OpenTofu module creates the first `ask-acton-01` VM and installs
Docker, Docker Compose, Git, and a basic firewall through cloud-init.

Authentication uses the GleSYS provider defaults:

```sh
export GLESYS_USERID=cl31994
export GLESYS_TOKEN=...
```

`GLESYS_USERID` is the project ID, not the login email address.

Create `terraform.tfvars`:

```hcl
ssh_public_keys = [
  "ssh-ed25519 ...",
  "ecdsa-sha2-nistp256 ..."
]
```

Include every public key that should be able to log in as `acton`.
Cloud-init installs these keys during the first boot.

From the repository root, run:

```sh
./scripts/tofu -chdir=infra/glesys init
./scripts/tofu -chdir=infra/glesys plan
./scripts/tofu -chdir=infra/glesys apply
```

The wrapper runs OpenTofu in Docker, so OpenTofu does not need to be
installed locally. It passes through `GLESYS_USERID` and `GLESYS_TOKEN`
from the host environment.

For validation without touching the remote API, also from the repository
root:

```sh
./scripts/tofu -chdir=infra/glesys init -backend=false
./scripts/tofu -chdir=infra/glesys validate
./scripts/tofu -chdir=infra/glesys fmt -check
```

The provider and exact template names should be checked against the
GleSYS project before applying. The defaults are sized for the first
playground version: 4 vCPU, 4 GiB RAM, and 50 GiB disk.

This module currently uses local state in `terraform.tfstate`. Keep that
file private and backed up, or migrate to a remote state backend before
multiple people operate the VM.
