set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

host := env_var_or_default("ASK_ACTON_HOST", "acton@188.126.83.249")
remote_dir := env_var_or_default("ASK_ACTON_REMOTE_DIR", "/home/acton/ask-acton")

default:
    @just --list

check-clean:
    @test -z "$(git status --porcelain)" || (git status --short && echo "Refusing to deploy a dirty worktree; commit first." >&2 && exit 1)

sync: check-clean
    git archive HEAD | ssh {{host}} 'mkdir -p {{remote_dir}} && tar -x -C {{remote_dir}}'

deploy-ask: sync
    ssh {{host}} 'cd {{remote_dir}} && docker compose up -d --build ask-acton'
    just health https://ask.acton.guide/healthz

deploy-play: sync
    ssh {{host}} 'cd {{remote_dir}} && docker compose up -d --build playground caddy'
    just health https://play.acton.guide/healthz

deploy: sync
    ssh {{host}} 'cd {{remote_dir}} && docker compose up -d --build'
    just health https://ask.acton.guide/healthz
    just health https://play.acton.guide/healthz

status:
    ssh {{host}} 'cd {{remote_dir}} && docker compose ps'

logs service="ask-acton":
    ssh {{host}} 'cd {{remote_dir}} && docker compose logs --tail=200 -f {{service}}'

health url:
    @for i in {1..20}; do if curl -fsS {{url}}; then exit 0; fi; sleep 1; done; curl -fsS {{url}}
