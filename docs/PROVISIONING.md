# Provisioning Runbook

This project is deployed as two static hostnames backed by one GleSYS VM:

- `ask.acton.guide`: Ask Acton API for the guide widget.
- `play.acton.guide`: browser playground and Acton snippet runner.

The mdBook guide can remain on GitHub Pages. Only the assistant API and
the playground need this VM.

## Inputs

Provisioning needs:

- GleSYS project credentials: `GLESYS_USERID` and `GLESYS_TOKEN`.
- An SSH public key for the `acton` deploy user.
- DNS records for `ask.acton.guide` and `play.acton.guide` pointing at
  the VM.
- An OpenAI API key for Ask Acton.
- A decision on whether the runner image should track nightly, stable,
  or a pinned commit. The included `runner-image/Dockerfile` currently
  tracks the Acton tip APT repository.

For the Acton GleSYS project, `GLESYS_USERID` is the project ID
`cl31994`. It is not the login email address. Keep `GLESYS_TOKEN` out of
the repository and rotate it after bootstrap if it was pasted into a
terminal or chat session.

## VM Size

The default VM starts at 4 vCPU, 4 GiB RAM, and 50 GiB disk. That is
mostly for the playground. Ask Acton itself is small, but cold Acton
snippet compilation needs a larger memory budget and should start with
one concurrent run.

## State

OpenTofu currently uses local state in `infra/glesys/terraform.tfstate`.
That file is ignored by Git but is still authoritative for the live VM.
Do not delete it without first importing or recreating the infrastructure
state. Back it up somewhere private, or move this module to a remote
state backend before more people operate it.

## SSH Keys

Put every SSH public key that should work for the `acton` user in
`infra/glesys/terraform.tfvars` before the first boot:

```hcl
ssh_public_keys = [
  "ssh-ed25519 ...",
  "ecdsa-sha2-nistp256 ..."
]
```

Cloud-init installs these keys while the VM is created. Changing
metadata later is not a reliable way to repair a missing login key.

## Provision

OpenTofu can be run through Docker:

```sh
export GLESYS_USERID=cl31994
export GLESYS_TOKEN=...
./scripts/tofu -chdir=infra/glesys init
./scripts/tofu -chdir=infra/glesys plan
./scripts/tofu -chdir=infra/glesys apply
./scripts/tofu -chdir=infra/glesys output
```

The current production VM is:

```text
server_id = kvm4221419
ipv4      = 188.126.83.249
ipv6      = 2a02:750:23:f7::f7
hostname  = ask-acton-01
```

Verify the machine after creation:

```sh
ssh acton@188.126.83.249
cloud-init status --wait
docker --version
docker compose version
```

## DNS

Create or update the public records before starting Caddy:

```text
ask.acton.guide   A     188.126.83.249
ask.acton.guide   AAAA  2a02:750:23:f7::f7
play.acton.guide  A     188.126.83.249
play.acton.guide  AAAA  2a02:750:23:f7::f7
```

Caddy listens on ports 80 and 443 and obtains public TLS certificates on
startup. DNS must already point at the VM, otherwise certificate
issuance will fail.

## First Deploy

On the VM:

```sh
git clone https://github.com/actonlang/ask-acton.git
cd ask-acton
cp .env.example .env
$EDITOR .env
```

Set at least:

```text
OPENAI_API_KEY=...
OPENAI_VECTOR_STORE_ID=vs_...
```

Build the Acton runner image and start the services:

```sh
docker build -t ask-acton/acton-runner:tip runner-image
docker compose up -d --build
docker compose ps
```

The runner image is separate from the playground service image. Rebuild
it whenever the Acton version used by the playground should change.

## Verify

From the VM:

```sh
curl -fsS http://127.0.0.1:8787/healthz
curl -fsS http://127.0.0.1:8788/healthz
```

After DNS and TLS are live:

```sh
curl -fsS https://ask.acton.guide/healthz
curl -fsS https://play.acton.guide/healthz
```

The playground page should load at `https://play.acton.guide/`. The Ask
Acton API is consumed by the mdBook widget and is not meant to be a
standalone page.
