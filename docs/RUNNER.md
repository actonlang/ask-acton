# Future Acton Runner

The same VM can host the first playground backend, but it should be a
separate service from the question-answering API.

The chat API sends user text to OpenAI. A runner executes untrusted
Acton code. Those are very different security problems.

Recommended shape:

- `ask-acton`: answers guide questions and explains pasted errors.
- `acton-runner`: accepts short snippets, compiles/runs them in a
  locked-down sandbox, and returns stdout, stderr, exit status, and
  timing.
- `caddy`: routes `ask.acton.guide` and later `run.acton.guide` or
  `api.acton.guide/run`.

Runner requirements before enabling it publicly:

- Run each snippet in a fresh container or stronger isolation boundary.
- Disable outbound network access by default.
- Use CPU, memory, process, file-size, and wall-clock limits.
- Mount a temporary workspace with no host secrets.
- Keep the Acton compiler/runtime image read-only.
- Queue requests instead of running arbitrary concurrency on the host.
- Log request IDs and resource usage, not full private code by default.

Keeping the runner separate lets us reuse the VM and reverse proxy while
leaving room to move the runner to a stronger isolation host later.
