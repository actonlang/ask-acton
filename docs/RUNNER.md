# Acton Runner

The same VM can host the first playground backend, but it is a separate
service from the question-answering API.

The chat API sends user text to OpenAI. A runner executes untrusted
Acton code. Those are very different security problems.

Recommended shape:

- `ask-acton`: answers guide questions and explains pasted errors.
- `playground`: accepts short snippets, compiles/runs them in a Docker
  sandbox, and returns stdout, stderr, exit status, and timing.
- `caddy`: routes `ask.acton.guide` and later `run.acton.guide` or
  `play.acton.guide`.

The first implementation uses Docker with no network, CPU/memory/PID
limits, dropped Linux capabilities, `no-new-privileges`, a read-only
container filesystem, and a temporary per-run workspace. The default
limits allow one run at a time with a 90 second timeout and a 3 GiB
container memory limit, because cold Acton compilation is currently the
dominant cost.

Requirements before enabling it broadly:

- Run each snippet in a fresh container or stronger isolation boundary.
- Use CPU, memory, process, file-size, and wall-clock limits.
- Mount a temporary workspace with no host secrets.
- Keep the Acton compiler/runtime image read-only.
- Queue requests instead of running arbitrary concurrency on the host.
- Log request IDs and resource usage, not full private code by default.

Keeping the runner separate lets us reuse the VM and reverse proxy while
leaving room to move the runner to a stronger isolation host later.
