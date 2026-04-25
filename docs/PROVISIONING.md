# Provisioning Checklist

To provision the first production VM, we need:

- GleSYS project credentials: `GLESYS_USERID` and `GLESYS_TOKEN`.
- An SSH public key for the `acton` deploy user.
- DNS records for `ask.acton.guide` and `play.acton.guide` pointing at
  the VM.
- An OpenAI API key for Ask Acton.
- A decision on whether the runner image should track nightly, stable,
  or a pinned commit. The included `runner-image/Dockerfile` currently
  tracks the Acton tip APT repository.

The default Terraform VM starts at 4 vCPU, 4 GiB RAM, and 50 GiB disk.
That is mostly for the playground. Ask Acton itself is small, but cold
Acton snippet compilation needs a larger memory budget and should start
with one concurrent run.

OpenTofu can be run through Docker:

```sh
./scripts/tofu -chdir=infra/glesys init
./scripts/tofu -chdir=infra/glesys plan
./scripts/tofu -chdir=infra/glesys apply
```

Set `GLESYS_USERID` and `GLESYS_TOKEN` in the shell before running
`plan` or `apply`.
