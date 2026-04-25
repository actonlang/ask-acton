# Ask Acton

Ask Acton is the backend and browser widget for an Acton guide assistant.
The guide can remain a static mdBook site on GitHub Pages. Browser code
calls this service, and this service calls OpenAI with the API key kept
server-side.

## Services

- `ask-acton`: TypeScript/Fastify API for `/api/ask`.
- `playground`: TypeScript/Fastify API and page for running Acton
  snippets through a Docker sandbox.
- `caddy`: TLS and reverse proxy for `ask.acton.guide`.
- `public/ask-acton.*`: static widget assets for the mdBook theme.
- `infra/glesys`: Terraform scaffold for the first GleSYS VM.

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

On the VM:

```sh
git clone https://github.com/actonlang/ask-acton.git
cd ask-acton
cp .env.example .env
$EDITOR .env
docker build -t ask-acton/acton-runner:tip runner-image
docker compose up -d --build
```

Point `ask.acton.guide` and `play.acton.guide` at the VM before
starting Caddy so it can issue TLS certificates.

Provisioning can be driven with OpenTofu through Docker:

```sh
export GLESYS_USERID=...
export GLESYS_TOKEN=...
./scripts/tofu -chdir=infra/glesys init
./scripts/tofu -chdir=infra/glesys plan
```

## Playground Runner

The same VM hosts the first Acton playground, but it is a separate
service from Ask Acton. See `docs/RUNNER.md` for the security model and
the remaining hardening work before broad public use.
