import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { answerQuestion } from "./openai.js";

const optionalText = (maxLength: number) =>
  z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().max(maxLength).optional());

const askSchema = z
  .object({
    question: optionalText(config.maxQuestionChars),
    code: optionalText(config.maxContextChars),
    error: optionalText(config.maxContextChars),
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
  })
  .refine((request) => request.question || request.code || request.error, {
    message: "Provide a question, Acton code, or error output."
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
          for a more specific answer.
        </p>
        <nav aria-label="Related Acton sites">
          <a href="https://acton.guide/">Acton Guide</a>
          <a href="https://play.acton.guide/">Acton Playground</a>
        </nav>
      </section>

      <section class="card" aria-label="Ask Acton form">
        <form id="ask-form">
          <label>
            <span>What do you want help with?</span>
            <textarea
              id="ask-input"
              name="input"
              rows="14"
              spellcheck="false"
              placeholder="Ask a question, paste Acton code, or paste compiler output..."
            ></textarea>
          </label>

          <div class="task-row" aria-label="Common tasks">
            <button type="button" class="task-button active" data-mode="ask" aria-pressed="true">
              Ask anything
            </button>
            <button type="button" class="task-button" data-mode="error" aria-pressed="false">
              Explain error
            </button>
            <button type="button" class="task-button" data-mode="code" aria-pressed="false">
              Review code
            </button>
            <button type="button" class="task-button" data-mode="concept" aria-pressed="false">
              Explain concept
            </button>
          </div>

          <div class="task-instruction" aria-live="polite">
            <span>Task</span>
            <p id="task-instruction">Answer the question or request directly.</p>
          </div>

          <div class="actions">
            <button id="ask-button" type="submit">Ask Acton</button>
            <p id="status" role="status" aria-live="polite"></p>
          </div>
        </form>
      </section>

      <section id="progress-panel" class="card progress-card" aria-live="polite" hidden>
        <div class="spinner" aria-hidden="true"></div>
        <div>
          <h2>Working on it</h2>
          <p id="progress-message">Preparing the request...</p>
          <p id="elapsed-time">0 seconds elapsed</p>
        </div>
      </section>

      <section id="answer-panel" class="card answer-card" aria-live="polite" hidden>
        <h2>Answer</h2>
        <div id="answer-text" class="markdown-body"></div>
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
  font-weight: 700;
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
  font-weight: 450;
  line-height: 1.5;
  resize: vertical;
}

textarea:focus {
  border-color: rgba(29, 122, 71, 0.72);
  box-shadow: 0 0 0 4px rgba(29, 122, 71, 0.15);
  outline: none;
}

#ask-input {
  font-family:
    "SFMono-Regular",
    "Cascadia Code",
    "Liberation Mono",
    ui-monospace,
    monospace;
}

.task-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 0.9rem;
  border: 1px solid var(--border);
  border-radius: 1.15rem;
  padding: 0.45rem;
  background: rgba(255, 255, 255, 0.38);
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

.task-button {
  min-height: 2.45rem;
  border: 1px solid transparent;
  padding: 0 1rem;
  color: var(--accent-strong);
  background: transparent;
  font-size: 0.92rem;
  font-weight: 720;
}

.task-button:hover {
  background: rgba(29, 122, 71, 0.09);
}

.task-button.active {
  border-color: rgba(29, 122, 71, 0.45);
  color: var(--accent-strong);
  background: var(--bg-soft);
  box-shadow: 0 8px 24px rgba(31, 68, 45, 0.12);
}

.task-button.active::before {
  content: "✓";
  margin-right: 0.4rem;
}

.task-instruction {
  margin-top: 0.8rem;
  border: 1px solid rgba(29, 122, 71, 0.2);
  border-radius: 1rem;
  padding: 0.85rem 1rem;
  background: rgba(29, 122, 71, 0.07);
}

.task-instruction span {
  display: block;
  margin-bottom: 0.25rem;
  color: var(--accent-strong);
  font-size: 0.72rem;
  font-weight: 850;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.task-instruction p {
  margin: 0;
  color: var(--text);
  font-size: 0.96rem;
  line-height: 1.45;
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

.progress-card,
.answer-card {
  margin-top: 1.5rem;
}

.progress-card {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.progress-card h2 {
  margin-bottom: 0.35rem;
}

.progress-card p {
  margin: 0;
}

#elapsed-time {
  margin-top: 0.25rem;
  font-size: 0.92rem;
}

.spinner {
  width: 2.75rem;
  height: 2.75rem;
  flex: 0 0 auto;
  border: 4px solid rgba(29, 122, 71, 0.16);
  border-top-color: var(--accent);
  border-radius: 999px;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

#answer-text {
  font-size: 1rem;
  line-height: 1.6;
}

.markdown-body > *:first-child {
  margin-top: 0;
}

.markdown-body > *:last-child {
  margin-bottom: 0;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3 {
  margin: 1.35rem 0 0.55rem;
  letter-spacing: -0.025em;
  line-height: 1.15;
}

.markdown-body h1 {
  font-size: 1.55rem;
}

.markdown-body h2 {
  font-size: 1.3rem;
}

.markdown-body h3 {
  font-size: 1.1rem;
}

.markdown-body p,
.markdown-body ul,
.markdown-body ol {
  margin: 0.7rem 0;
}

.markdown-body ul,
.markdown-body ol {
  padding-left: 1.35rem;
}

.markdown-body li + li {
  margin-top: 0.3rem;
}

.markdown-body pre {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 1rem;
  margin: 0.9rem 0;
  padding: 1rem;
  background: var(--bg-soft);
  line-height: 1.5;
}

.markdown-body code {
  border-radius: 0.35rem;
  padding: 0.13rem 0.32rem;
  background: rgba(29, 122, 71, 0.1);
  font-family:
    "SFMono-Regular",
    "Cascadia Code",
    "Liberation Mono",
    ui-monospace,
    monospace;
  font-size: 0.92em;
}

.markdown-body pre code {
  display: block;
  padding: 0;
  background: transparent;
  font-size: 0.92rem;
}

.markdown-body blockquote {
  margin: 0.9rem 0;
  border-left: 4px solid rgba(29, 122, 71, 0.32);
  padding-left: 1rem;
  color: var(--muted);
}

.markdown-body a {
  display: inline;
  min-height: 0;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent;
  text-decoration: underline;
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

  .task-row {
    background: rgba(12, 24, 17, 0.5);
  }

  .task-button.active {
    background: rgba(71, 201, 121, 0.12);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
  }
}
`.trim();

const askPageJs = `
const form = document.querySelector("#ask-form");
const askInput = document.querySelector("#ask-input");
const askButton = document.querySelector("#ask-button");
const statusText = document.querySelector("#status");
const taskInstruction = document.querySelector("#task-instruction");
const progressPanel = document.querySelector("#progress-panel");
const progressMessage = document.querySelector("#progress-message");
const elapsedTime = document.querySelector("#elapsed-time");
const answerPanel = document.querySelector("#answer-panel");
const answerText = document.querySelector("#answer-text");
const sourcesPanel = document.querySelector("#sources-panel");
const sourcesList = document.querySelector("#sources");
let selectedMode = "ask";
let progressTimer;
let progressStartedAt = 0;
const progressMessages = [
  "Reading your prompt...",
  "Searching the Acton material...",
  "Preparing an answer...",
  "Still working..."
];
const taskInstructions = {
  ask: "Answer the question or request directly.",
  error: "Explain this Acton error and show the smallest useful fix.",
  code: "Review this Acton code and point out likely issues.",
  concept: "Explain this Acton concept with a small example."
};

document.querySelectorAll(".task-button").forEach((button) => {
  button.addEventListener("click", () => {
    setSelectedMode(button.dataset.mode || "ask");
    askInput.focus();
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = readPayload();
  if (!payload.question && !payload.code && !payload.error) {
    setStatus("Ask a question, paste Acton code, or paste compiler output first.", true);
    return;
  }

  setLoading(true);
  setStatus("Asking Acton...");
  showProgress();
  answerPanel.hidden = true;
  answerText.replaceChildren();
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
    hideProgress();
    setLoading(false);
  }
});

function readPayload() {
  const formData = new FormData(form);
  const input = String(formData.get("input") ?? "").trim();

  if (!input) {
    return {};
  }

  if (selectedMode === "error") {
    return {
      question: taskInstructions.error,
      error: input
    };
  }

  if (selectedMode === "code") {
    return {
      question: taskInstructions.code,
      code: input
    };
  }

  if (selectedMode === "concept") {
    return {
      question: taskInstructions.concept + "\\n\\n" + input
    };
  }

  return { question: input };
}

function setSelectedMode(mode) {
  selectedMode = taskInstructions[mode] ? mode : "ask";
  document.querySelectorAll(".task-button").forEach((taskButton) => {
    const active = taskButton.dataset.mode === selectedMode;
    taskButton.classList.toggle("active", active);
    taskButton.setAttribute("aria-pressed", active ? "true" : "false");
  });
  taskInstruction.textContent = taskInstructions[selectedMode];
}

function showProgress() {
  progressStartedAt = Date.now();
  progressPanel.hidden = false;
  updateProgress();
  progressTimer = window.setInterval(updateProgress, 1000);
}

function hideProgress() {
  if (progressTimer) {
    window.clearInterval(progressTimer);
    progressTimer = undefined;
  }
  progressPanel.hidden = true;
}

function updateProgress() {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - progressStartedAt) / 1000));
  const messageIndex = Math.min(progressMessages.length - 1, Math.floor(elapsedSeconds / 6));
  progressMessage.textContent = progressMessages[messageIndex];
  elapsedTime.textContent = elapsedSeconds === 1 ? "1 second elapsed" : elapsedSeconds + " seconds elapsed";
}

function renderAnswer(data) {
  answerText.innerHTML = renderMarkdown(data.answer || "Ask Acton did not return an answer.");
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

function renderMarkdown(markdown) {
  const codeFencePattern = /\\x60\\x60\\x60([\\w-]*)\\n?([\\s\\S]*?)\\x60\\x60\\x60/g;
  const html = [];
  let lastIndex = 0;
  let match;

  while ((match = codeFencePattern.exec(markdown)) !== null) {
    html.push(renderMarkdownBlocks(markdown.slice(lastIndex, match.index)));
    html.push(renderCodeBlock(match[2], match[1]));
    lastIndex = match.index + match[0].length;
  }

  html.push(renderMarkdownBlocks(markdown.slice(lastIndex)));
  return html.join("");
}

function renderMarkdownBlocks(markdown) {
  return markdown
    .replace(/\\r\\n/g, "\\n")
    .split(/\\n{2,}/)
    .map((block) => renderMarkdownBlock(block.trim()))
    .join("");
}

function renderMarkdownBlock(block) {
  if (!block) {
    return "";
  }

  const lines = block.split("\\n").map((line) => line.trimEnd());
  const firstLine = lines[0].trim();
  const heading = /^(#{1,3})\\s+(.+)$/.exec(firstLine);

  if (heading && lines.length === 1) {
    const level = heading[1].length;
    return "<h" + level + ">" + renderInlineMarkdown(heading[2]) + "</h" + level + ">";
  }

  if (lines.every((line) => /^\\s*[-*]\\s+/.test(line))) {
    return "<ul>" + lines.map((line) => "<li>" + renderInlineMarkdown(line.replace(/^\\s*[-*]\\s+/, "")) + "</li>").join("") + "</ul>";
  }

  if (lines.every((line) => /^\\s*\\d+\\.\\s+/.test(line))) {
    return "<ol>" + lines.map((line) => "<li>" + renderInlineMarkdown(line.replace(/^\\s*\\d+\\.\\s+/, "")) + "</li>").join("") + "</ol>";
  }

  if (lines.every((line) => /^\\s*>\\s?/.test(line))) {
    const quote = lines.map((line) => line.replace(/^\\s*>\\s?/, "")).join(" ");
    return "<blockquote>" + renderInlineMarkdown(quote) + "</blockquote>";
  }

  return "<p>" + renderInlineMarkdown(lines.join(" ")) + "</p>";
}

function renderInlineMarkdown(markdown) {
  const codeSpans = [];
  const withCodePlaceholders = markdown.replace(/\\x60([^\\x60]+)\\x60/g, (_match, code) => {
    const index = codeSpans.push(code) - 1;
    return "%%CODE" + index + "%%";
  });

  let html = escapeHtml(withCodePlaceholders);
  html = html.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
  html = html.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g, (_match, label, url) => {
    return '<a href="' + escapeHtml(url) + '" rel="noreferrer" target="_blank">' + label + "</a>";
  });
  html = html.replace(/%%CODE(\\d+)%%/g, (_match, index) => {
    return "<code>" + escapeHtml(codeSpans[Number(index)] || "") + "</code>";
  });
  return html;
}

function renderCodeBlock(code, language) {
  const languageClass = /^[a-z0-9_-]+$/i.test(language) && language ? " class=\\"language-" + language + "\\"" : "";
  return "<pre><code" + languageClass + ">" + escapeHtml(code.trimEnd()) + "</code></pre>";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
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
