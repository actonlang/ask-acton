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
limits allow 10 active compile/run tasks with a 15 second timeout and a
3 GiB container memory limit per task. Additional requests are rejected
with `playground_busy` instead of being queued indefinitely.

The public API also has request rate limiting. The default is 10
requests per minute per client IP, enforced by the Fastify service behind
Caddy. The concurrency limit is separate from rate limiting: rate
limiting controls request volume, while `PLAYGROUND_MAX_CONCURRENT_RUNS`
controls how many Docker sandboxes may compile or run Acton code at the
same time.

There is no fixed service-level limit that prevents N concurrent runs.
The safe value depends on the host, the expected snippets, and the
per-run Docker limits. The first VM has 4 vCPU and 4 GiB RAM, so N=10 is
an optimistic public default based on short snippets and a 15 second
wall-clock limit. If the host shows memory or CPU pressure, lower
`PLAYGROUND_MAX_CONCURRENT_RUNS` first.

Each snippet still runs in a fresh container, but the runner mounts a
persistent cache directory as `/home/acton/.cache`. That preserves
`~/.cache/acton` between runs, so the compiler can reuse downloaded and
built dependency artifacts instead of starting from an empty cache for
every request. The source workspace remains per-run and is removed after
the request finishes. Compiler scratch files are directed to a per-run
tmpfs directory with `--tempdir /tmp/acton-build`, so concurrent runs do
not share the compiler's temporary build directory.

The browser uses `POST /api/run/stream` for interactive runs. The
endpoint returns newline-delimited JSON events for sandbox preparation,
compilation, execution, program stdout/stderr, and the final result. The
compiler is invoked directly instead of through `runacton` so the runner
can report distinct compile and run phases while keeping normal compiler
chatter hidden.

Requirements before enabling it broadly:

- Run each snippet in a fresh container or stronger isolation boundary.
- Use CPU, memory, process, file-size, and wall-clock limits.
- Mount a temporary workspace with no host secrets.
- Keep the Acton compiler/runtime image read-only.
- Queue requests instead of running arbitrary concurrency on the host.
- Log request IDs and resource usage, not full private code by default.

Keeping the runner separate lets us reuse the VM and reverse proxy while
leaving room to move the runner to a stronger isolation host later.
