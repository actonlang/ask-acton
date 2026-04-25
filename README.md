# Ask Acton

Ask Acton is the backend and browser widget for an Acton guide assistant.
The guide can remain a static mdBook site on GitHub Pages. Browser code
calls this service, and this service calls OpenAI with the API key kept
server-side.

## Services

- `ask-acton`: TypeScript/Fastify API for `/api/ask`.
- `playground`: TypeScript/Fastify API and page for running Acton
  snippets through a Docker sandbox.
- `caddy`: TLS and reverse proxy for `ask.acton.guide` and
  `play.acton.guide`.
- `public/ask-acton.*`: static widget assets for the mdBook theme.
- `infra/glesys`: OpenTofu scaffold for the first GleSYS VM.

## Local Development

```sh
npm install
cp .env.example .env
$EDITOR .env
npm run dev
```

The health check is:

```sh
curl http://localhost:8787/healthz
```

Ask endpoint:

```sh
curl http://localhost:8787/api/ask \
  -H 'content-type: application/json' \
  -d '{"question":"How do actors store mutable state in Acton?"}'
```

Run the playground service locally:

```sh
npm run dev:playground
```

The playground page is then available at:

```sh
open http://localhost:8788/
```

The playground expects Docker to be available and
`PLAYGROUND_ACTON_IMAGE` to point at an image containing `acton` and
`runacton`.

Build the default runner image:

```sh
docker build -t ask-acton/acton-runner:tip runner-image
```

## Index the Guide

Create or update a vector store from a local checkout of the Acton guide:

```sh
export OPENAI_API_KEY=...
npm run index:docs
```

To update an existing vector store:

```sh
export OPENAI_VECTOR_STORE_ID=vs_...
npm run index:docs
```

Set the printed `OPENAI_VECTOR_STORE_ID` in `.env` before starting the
service.

## Deploy

The first deployment target is one GleSYS VM that runs Ask Acton, the
playground service, the Acton runner image, and Caddy. The guide itself
can still be published as a static GitHub Pages site.

Provisioning is driven with OpenTofu through Docker:

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

Create these DNS records before starting Caddy:

```text
ask.acton.guide   A     188.126.83.249
ask.acton.guide   AAAA  2a02:750:23:f7::f7
play.acton.guide  A     188.126.83.249
play.acton.guide  AAAA  2a02:750:23:f7::f7
```

Caddy obtains certificates during startup. If DNS does not already
resolve to the VM, certificate issuance will fail.

After cloud-init has finished, deploy the services on the VM:

```sh
ssh acton@188.126.83.249
git clone https://github.com/actonlang/ask-acton.git
cd ask-acton
cp .env.example .env
$EDITOR .env
docker build -t ask-acton/acton-runner:tip runner-image
docker compose up -d --build
```

The `.env` file must include `OPENAI_API_KEY`. Ask Acton also needs
`OPENAI_VECTOR_STORE_ID` from the indexing step if it should answer from
the guide instead of only the base model context. The default playground
settings run one Acton snippet at a time with a 15 second timeout.

To deploy only the playground before Ask Acton has an OpenAI key:

```sh
cp .env.example .env
docker build -t ask-acton/acton-runner:tip runner-image
docker compose up -d --build --no-deps playground caddy
```

This starts `play.acton.guide` without starting the `ask-acton` service.
Caddy still loads the full Caddyfile, so `ask.acton.guide` may have a TLS
certificate but will not have a working backend until Ask Acton is
started.

Verify the host and services:

```sh
cloud-init status --wait
docker --version
docker compose ps
curl -fsS https://play.acton.guide/healthz
```

For the full Ask Acton deployment, also verify:

```sh
curl -fsS https://ask.acton.guide/healthz
```

See `docs/PROVISIONING.md` for the full runbook and local state notes.

## Playground Runner

The same VM hosts the first Acton playground, but it is a separate
service from Ask Acton. See `docs/RUNNER.md` for the security model and
the remaining hardening work before broad public use.
