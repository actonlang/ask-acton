import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { answerQuestion } from "./openai.js";

const askSchema = z.object({
  question: z.string().trim().min(1).max(config.maxQuestionChars),
  code: z.string().max(config.maxContextChars).optional(),
  error: z.string().max(config.maxContextChars).optional(),
  page: z
    .object({
      url: z.string().url().optional(),
      title: z.string().max(300).optional(),
      excerpt: z.string().max(config.maxContextChars).optional()
    })
    .optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(config.maxContextChars)
      })
    )
    .max(config.maxHistoryMessages)
    .optional()
});

const askPageHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Ask Acton</title>
    <link rel="stylesheet" href="/ask.css">
    <script type="module" src="/ask.js"></script>
  </head>
  <body>
    <main>
      <section class="hero" aria-labelledby="page-title">
        <p class="eyebrow">Ask Acton</p>
        <h1 id="page-title">Get help with Acton code, errors, and concepts.</h1>
        <p>
          Ask a question about Acton, or paste Acton code and compiler output
          for a more specific answer. Ask Acton uses the Acton guide as its
          primary source.
        </p>
        <nav aria-label="Related Acton sites">
          <a href="https://acton.guide/">Acton Guide</a>
          <a href="https://play.acton.guide/">Acton Playground</a>
        </nav>
      </section>

      <section class="card" aria-label="Ask Acton form">
        <form id="ask-form">
          <label>
            <span>Question</span>
            <textarea
              id="question"
              name="question"
              required
              rows="6"
              placeholder="How do I read an optional value safely?"
            ></textarea>
          </label>

          <div class="context-grid">
            <label>
              <span>Acton code <em>optional</em></span>
              <textarea
                id="code"
                name="code"
                rows="10"
                spellcheck="false"
                placeholder="actor main(env):&#10;    print(&quot;Hello, Acton!&quot;)&#10;    env.exit(0)"
              ></textarea>
            </label>

            <label>
              <span>Error output <em>optional</em></span>
              <textarea
                id="error"
                name="error"
                rows="10"
                spellcheck="false"
                placeholder="Paste compiler or runtime output here"
              ></textarea>
            </label>
          </div>

          <div class="actions">
            <button id="ask-button" type="submit">Ask Acton</button>
            <p id="status" role="status" aria-live="polite"></p>
          </div>
        </form>
      </section>

      <section id="answer-panel" class="card answer-card" aria-live="polite" hidden>
        <h2>Answer</h2>
        <pre id="answer-text"></pre>
        <div id="sources-panel" hidden>
          <h3>Sources</h3>
          <ul id="sources"></ul>
        </div>
      </section>
    </main>
  </body>
</html>`;

const askPageCss = `
:root {
  color-scheme: light dark;
  --bg: #eff5ed;
  --bg-soft: #f8fbf5;
  --text: #132018;
  --muted: #526157;
  --border: rgba(24, 63, 39, 0.18);
  --accent: #1d7a47;
  --accent-strong: #0f6034;
  --accent-text: #ffffff;
  --error: #aa2c2c;
  --shadow: 0 24px 80px rgba(31, 68, 45, 0.16);
  font-family:
    "Avenir Next",
    "Segoe UI",
    ui-sans-serif,
    system-ui,
    sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  min-height: 100vh;
  margin: 0;
  background:
    radial-gradient(circle at 12% 4%, rgba(122, 191, 119, 0.28), transparent 32rem),
    linear-gradient(145deg, var(--bg), #dbead8 55%, #f6f4ea);
  color: var(--text);
}

main {
  width: min(72rem, calc(100% - 2rem));
  margin: 0 auto;
  padding: 4rem 0;
}

.hero {
  max-width: 48rem;
  margin-bottom: 2rem;
}

.eyebrow {
  margin: 0 0 0.75rem;
  color: var(--accent-strong);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 1rem;
  font-size: clamp(2.4rem, 6vw, 5rem);
  line-height: 0.95;
  letter-spacing: -0.055em;
}

h2 {
  margin-bottom: 1rem;
  font-size: 1.35rem;
}

h3 {
  margin: 1.25rem 0 0.6rem;
  font-size: 1rem;
}

p {
  color: var(--muted);
  font-size: 1.05rem;
  line-height: 1.6;
}

nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

a {
  display: inline-flex;
  align-items: center;
  min-height: 2.5rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 1rem;
  color: var(--accent-strong);
  background: rgba(255, 255, 255, 0.42);
  font-weight: 750;
  text-decoration: none;
}

a:hover {
  border-color: rgba(29, 122, 71, 0.5);
}

.card {
  border: 1px solid var(--border);
  border-radius: 1.5rem;
  padding: clamp(1.25rem, 3vw, 2rem);
  background: rgba(248, 251, 245, 0.86);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
}

label {
  display: grid;
  gap: 0.55rem;
  color: var(--text);
  font-weight: 750;
}

label span {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

em {
  color: var(--muted);
  font-size: 0.82rem;
  font-style: normal;
  font-weight: 650;
}

textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 1rem;
  padding: 0.9rem 1rem;
  color: var(--text);
  background: var(--bg-soft);
  font: inherit;
  line-height: 1.5;
  resize: vertical;
}

textarea:focus {
  border-color: rgba(29, 122, 71, 0.72);
  box-shadow: 0 0 0 4px rgba(29, 122, 71, 0.15);
  outline: none;
}

#code,
#error,
#answer-text {
  font-family:
    "SFMono-Regular",
    "Cascadia Code",
    "Liberation Mono",
    ui-monospace,
    monospace;
}

.context-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 1.25rem;
}

button {
  min-height: 3rem;
  border: 0;
  border-radius: 999px;
  padding: 0 1.35rem;
  color: var(--accent-text);
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  font: inherit;
  font-weight: 850;
  cursor: pointer;
}

button:hover {
  filter: brightness(1.04);
}

button:disabled {
  cursor: wait;
  filter: grayscale(0.2);
  opacity: 0.72;
}

#status {
  margin: 0;
  font-size: 0.95rem;
}

#status.error {
  color: var(--error);
}

.answer-card {
  margin-top: 1.5rem;
}

#answer-text {
  overflow-x: auto;
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-size: 0.96rem;
  line-height: 1.6;
}

#sources {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

#sources li {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.35rem 0.7rem;
  color: var(--muted);
  background: rgba(29, 122, 71, 0.08);
  font-size: 0.88rem;
}

[hidden] {
  display: none !important;
}

@media (max-width: 760px) {
  main {
    padding: 2rem 0;
  }

  .context-grid {
    grid-template-columns: 1fr;
  }

  .actions {
    align-items: stretch;
    flex-direction: column;
  }

  button {
    width: 100%;
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #07110d;
    --bg-soft: #101d16;
    --text: #edf6ef;
    --muted: #abc0b1;
    --border: rgba(176, 224, 190, 0.18);
    --accent: #47c979;
    --accent-strong: #7be39e;
    --accent-text: #07110d;
    --error: #ff8c8c;
    --shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
  }

  body {
    background:
      radial-gradient(circle at 18% 0%, rgba(71, 201, 121, 0.18), transparent 32rem),
      linear-gradient(145deg, #07110d, #0d1c14 56%, #111913);
  }

  a,
  .card {
    background: rgba(12, 24, 17, 0.78);
  }
}
`.trim();

const askPageJs = `
const form = document.querySelector("#ask-form");
const askButton = document.querySelector("#ask-button");
const statusText = document.querySelector("#status");
const answerPanel = document.querySelector("#answer-panel");
const answerText = document.querySelector("#answer-text");
const sourcesPanel = document.querySelector("#sources-panel");
const sourcesList = document.querySelector("#sources");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = readPayload();
  if (!payload.question) {
    setStatus("Write a question first.", true);
    return;
  }

  setLoading(true);
  setStatus("Asking Acton...");
  answerPanel.hidden = true;
  answerText.textContent = "";
  sourcesList.replaceChildren();
  sourcesPanel.hidden = true;

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(errorMessage(response, data));
    }

    renderAnswer(data);
    setStatus("Answer ready.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Ask Acton failed.", true);
  } finally {
    setLoading(false);
  }
});

function readPayload() {
  const formData = new FormData(form);
  const question = String(formData.get("question") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const error = String(formData.get("error") ?? "").trim();
  const payload = { question };

  if (code) {
    payload.code = code;
  }
  if (error) {
    payload.error = error;
  }

  return payload;
}

function renderAnswer(data) {
  answerText.textContent = data.answer || "Ask Acton did not return an answer.";
  answerPanel.hidden = false;

  const citations = Array.isArray(data.citations) ? data.citations : [];
  const filenames = citations
    .map((citation) => citation.filename || citation.fileId)
    .filter(Boolean);

  for (const filename of new Set(filenames)) {
    const item = document.createElement("li");
    item.textContent = filename;
    sourcesList.append(item);
  }

  sourcesPanel.hidden = sourcesList.childElementCount === 0;
}

function setLoading(loading) {
  askButton.disabled = loading;
  askButton.textContent = loading ? "Asking..." : "Ask Acton";
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function errorMessage(response, data) {
  if (response.status === 429) {
    return "Ask Acton is receiving too many requests. Wait a moment and try again.";
  }
  if (response.status === 502) {
    return "Ask Acton could not reach the AI service. Try again shortly.";
  }
  if (data && data.error === "invalid_request") {
    return "The request is invalid. Shorten the text and try again.";
  }
  if (data && data.requestId) {
    return "Ask Acton failed. Request id: " + data.requestId;
  }
  return "Ask Acton failed with HTTP " + response.status + ".";
}
`.trim();

const app = Fastify({
  logger: {
    level: config.nodeEnv === "production" ? "info" : "debug"
  },
  trustProxy: true
});

await app.register(helmet, {
  global: true
});

await app.register(cors, {
  origin: config.allowedOrigins,
  methods: ["GET", "POST", "OPTIONS"]
});

await app.register(rateLimit, {
  max: config.rateLimitMax,
  timeWindow: config.rateLimitWindow
});

app.get("/healthz", async () => ({
  ok: true,
  service: "ask-acton"
}));

app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(askPageHtml));

app.get("/ask.css", async (_request, reply) => reply.type("text/css; charset=utf-8").send(askPageCss));

app.get("/ask.js", async (_request, reply) =>
  reply.type("application/javascript; charset=utf-8").send(askPageJs)
);

app.post("/api/ask", async (request, reply) => {
  const requestId = request.id;
  const parsed = askSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "invalid_request",
      requestId,
      details: z.treeifyError(parsed.error)
    });
  }

  try {
    return await answerQuestion(parsed.data, requestId);
  } catch (error) {
    request.log.error({ err: error, requestId }, "OpenAI request failed");
    return reply.code(502).send({
      error: "ask_acton_failed",
      requestId
    });
  }
});

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error, requestId: request.id }, "Unhandled request error");
  reply.code(500).send({
    error: "internal_error",
    requestId: request.id
  });
});

await app.listen({
  host: config.host,
  port: config.port
});
