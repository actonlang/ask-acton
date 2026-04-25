# Ask Acton

Ask Acton is the backend and browser widget for an Acton guide assistant.
The guide can remain a static mdBook site on GitHub Pages. Browser code
calls this service, and this service calls OpenAI with the API key kept
server-side.

## Services

- `ask-acton`: TypeScript/Fastify API for `/api/ask`.
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
docker compose up -d --build
```

Point `ask.acton.guide` at the VM before starting Caddy so it can issue
the TLS certificate.

## Future Runner

The same VM can host an Acton playground later, but the runner should be
a separate service with stronger sandboxing. See `docs/RUNNER.md`.
