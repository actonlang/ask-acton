import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { answerQuestion, streamQuestion } from "./openai.js";
import { isActonRelated } from "./scope.js";

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

const assetVersion = "20260426-nav-font";
const askRouteOptions = {
  config: {
    rateLimit: {
      max: config.askRateLimitMax,
      timeWindow: config.askRateLimitWindow
    }
  }
};
const notActonRelatedResponse = {
  error: "not_acton_related",
  message: "Ask Acton can only answer questions about Acton."
};

const askPageHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Ask Acton</title>
    <link rel="stylesheet" href="/ask.css?v=${assetVersion}">
    <script type="module" src="/ask.js?v=${assetVersion}"></script>
  </head>
  <body>
    <header class="app-header">
      <a class="app-mark" href="https://ask.acton.guide/" aria-current="page">Ask Acton</a>
      <nav class="site-nav" aria-label="Acton sites">
        <a href="https://acton.guide/">Guide</a>
        <a href="https://play.acton.guide/">Play</a>
        <a class="is-active" href="https://ask.acton.guide/" aria-current="page">Ask</a>
      </nav>
    </header>

    <main>
      <section class="hero" aria-labelledby="page-title">
        <p class="eyebrow">Ask Acton</p>
        <h1 id="page-title">Get help with Acton code, errors, and concepts.</h1>
        <p>
          Ask a question about Acton, or paste Acton code and compiler output
          for a more specific answer.
        </p>
      </section>

      <section id="ask-form-card" class="card form-card" aria-label="Ask Acton form">
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

      <section id="answer-panel" class="card answer-card" aria-live="polite" hidden>
        <h2>Conversation</h2>
        <div id="messages" class="messages" role="log" aria-live="polite"></div>
        <div id="sources-panel" hidden>
          <h3>Sources for latest answer</h3>
          <ul id="sources"></ul>
        </div>
      </section>

      <div class="after-conversation-actions">
        <button id="new-chat-button" class="secondary-button" type="button">New chat</button>
      </div>
    </main>
  </body>
</html>`;

const askPageCss = `
@font-face {
  font-family: "Open Sans";
  font-style: normal;
  font-weight: 800;
  src:
    local("Open Sans ExtraBold"),
    local("OpenSans-ExtraBold"),
    url("https://acton.guide/fonts/open-sans-v17-all-charsets-800.woff2") format("woff2");
}

:root {
  color-scheme: light dark;
  --bg: #eef0ef;
  --bg-soft: #f7f8f6;
  --panel: rgba(247, 248, 246, 0.92);
  --text: #191b1c;
  --muted: #5f666a;
  --border: rgba(35, 38, 40, 0.16);
  --accent: #ffd42a;
  --accent-soft: #fff3b4;
  --accent-strong: #9c7412;
  --accent-text: #151617;
  --code-bg: #f4f4f1;
  --error: #aa2c2c;
  --chrome-bg: #202326;
  --shadow: 0 18px 45px rgba(21, 22, 23, 0.12);
  font-family:
    "Avenir Next",
    "Neue Haas Grotesk Text",
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
    linear-gradient(120deg, rgba(255, 212, 42, 0.18), transparent 28rem),
    linear-gradient(180deg, var(--bg), var(--bg-soft) 48%, #ececeb);
  color: var(--text);
}

main {
  width: min(72rem, calc(100% - 2rem));
  margin: 0 auto;
  padding: 4rem 0;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 50px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  padding: 0 15px;
  background: var(--chrome-bg);
  color: #f7f8f6;
}

.app-mark {
  color: #f7f8f6;
  font-size: 1.5rem;
  font-weight: 850;
  letter-spacing: -0.03em;
  text-decoration: none;
}

.site-nav {
  display: inline-flex;
  align-self: stretch;
  align-items: stretch;
  gap: 2px;
}

.site-nav a {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 50px;
  padding: 0 10px;
  color: var(--accent);
  font-family: "Open Sans", sans-serif;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-decoration: none;
  text-transform: uppercase;
  white-space: nowrap;
}

.site-nav a:hover,
.site-nav a.is-active {
  color: #f7f8f6;
}

.site-nav a::after {
  position: absolute;
  right: 10px;
  bottom: 0;
  left: 10px;
  height: 3px;
  border-radius: 999px 999px 0 0;
  background: transparent;
  content: "";
}

.site-nav a.is-active::after {
  background: var(--accent);
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
  color: var(--text);
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

.card {
  border: 1px solid var(--border);
  border-radius: 1.1rem;
  padding: clamp(1.25rem, 3vw, 2rem);
  background: var(--panel);
  box-shadow: var(--shadow);
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
  border-color: rgba(255, 212, 42, 0.9);
  box-shadow: 0 0 0 4px rgba(255, 212, 42, 0.24);
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

.form-card.follow-up {
  margin-top: 1.5rem;
}

.form-card.follow-up .task-row,
.form-card.follow-up .task-instruction {
  display: none;
}

.form-card.follow-up textarea {
  min-height: 7rem;
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
  background: var(--accent);
  font: inherit;
  font-weight: 850;
  cursor: pointer;
}

button:hover {
  filter: brightness(1.04);
}

.secondary-button {
  border: 1px solid var(--border);
  color: var(--text);
  background: rgba(255, 255, 255, 0.5);
  font-weight: 750;
}

.secondary-button:hover {
  background: rgba(255, 212, 42, 0.18);
}

.task-button {
  min-height: 2.45rem;
  border: 1px solid transparent;
  padding: 0 1rem;
  color: var(--text);
  background: transparent;
  font-size: 0.92rem;
  font-weight: 720;
}

.task-button:hover {
  background: rgba(255, 212, 42, 0.12);
}

.task-button.active {
  border-color: rgba(156, 116, 18, 0.28);
  color: var(--text);
  background: var(--accent-soft);
  box-shadow: none;
}

.task-button.active::before {
  content: "✓";
  margin-right: 0.4rem;
}

.task-instruction {
  margin-top: 0.8rem;
  border: 1px solid rgba(156, 116, 18, 0.2);
  border-radius: 1rem;
  padding: 0.85rem 1rem;
  background: rgba(255, 212, 42, 0.1);
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

.after-conversation-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
}

.after-conversation-actions[hidden] {
  display: none;
}

.answer-card {
  margin-top: 1.5rem;
}

.progress-message {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-right: clamp(0rem, 8vw, 6rem);
  border: 1px solid var(--border);
  border-radius: 1rem;
  padding: 1rem;
  background: rgba(255, 212, 42, 0.1);
}

.progress-message h3 {
  margin-bottom: 0.35rem;
  font-size: 1rem;
}

.progress-message p {
  margin: 0;
}

.progress-message__elapsed {
  margin-top: 0.25rem;
  color: var(--muted);
  font-size: 0.92rem;
}

.spinner {
  width: 2.75rem;
  height: 2.75rem;
  flex: 0 0 auto;
  border: 4px solid rgba(35, 38, 40, 0.16);
  border-top-color: var(--accent);
  border-radius: 999px;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.messages {
  display: grid;
  gap: 1rem;
}

.message {
  display: grid;
  gap: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  padding: 1rem;
}

.message--user {
  margin-left: clamp(0rem, 8vw, 6rem);
  border-color: rgba(156, 116, 18, 0.22);
  background: linear-gradient(180deg, #fff7cf, var(--accent-soft));
  color: #151617;
}

.message--assistant {
  margin-right: clamp(0rem, 8vw, 6rem);
  background: rgba(255, 255, 255, 0.78);
}

.message__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.message--user,
.message--user .message__body,
.message--user .markdown-body,
.message--user .markdown-body p,
.message--user .markdown-body ul,
.message--user .markdown-body ol,
.message--user .markdown-body li,
.message--user .markdown-body blockquote {
  color: #151617;
}

.message--user .message__header {
  color: #5d4810;
}

.message--user .markdown-body pre {
  border-color: rgba(156, 116, 18, 0.24);
  border-left-color: #9c7412;
  background: rgba(255, 255, 255, 0.42);
  color: #151617;
}

.message--user .markdown-body code {
  color: #151617;
}

.message--user .markdown-body pre code {
  color: inherit;
}

.message__body {
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
  border-left: 0.35rem solid var(--accent);
  border-radius: 1rem;
  margin: 0.9rem 0;
  padding: 1rem;
  background: var(--code-bg);
  color: #151617;
  line-height: 1.5;
}

.markdown-body code {
  border-radius: 0.35rem;
  padding: 0.13rem 0.32rem;
  background: rgba(255, 212, 42, 0.16);
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
  color: inherit;
  font-size: 0.92rem;
}

.markdown-body blockquote {
  margin: 0.9rem 0;
  border-left: 4px solid var(--accent);
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
  display: flex;
}

#sources a,
#sources span {
  display: inline-flex;
  align-items: center;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.35rem 0.7rem;
  color: var(--muted);
  background: rgba(255, 212, 42, 0.12);
  font-size: 0.88rem;
  font-weight: 700;
  text-decoration: none;
}

#sources a:hover {
  border-color: rgba(255, 212, 42, 0.7);
  color: var(--text);
}

[hidden] {
  display: none !important;
}

@media (max-width: 760px) {
  .app-header {
    align-items: stretch;
    flex-direction: column;
    padding: 0.7rem 1rem 0;
  }

  .site-nav {
    min-height: 2.6rem;
  }

  .site-nav a {
    padding: 0 7px;
    font-size: 11px;
    letter-spacing: 0.05em;
  }

  .site-nav a::after {
    right: 7px;
    left: 7px;
  }

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

  .message--user,
  .message--assistant,
  .progress-message {
    margin-left: 0;
    margin-right: 0;
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151617;
    --bg-soft: #202326;
    --panel: rgba(32, 35, 38, 0.9);
    --text: #f2f3ef;
    --muted: #aeb5b9;
    --border: rgba(255, 255, 255, 0.14);
    --accent: #ffd42a;
    --accent-soft: #ffe15d;
    --accent-strong: #ffe15d;
    --accent-text: #151617;
    --code-bg: #1a1c1d;
    --error: #ff8c8c;
    --chrome-bg: #111213;
    --shadow: 0 24px 70px rgba(0, 0, 0, 0.38);
  }

  body {
    background:
      linear-gradient(120deg, rgba(255, 212, 42, 0.1), transparent 28rem),
      linear-gradient(180deg, #151617, #202326 45%, #17191a);
  }

  .card {
    background: var(--panel);
  }

  .task-row {
    background: rgba(21, 22, 23, 0.58);
  }

  .task-button.active {
    color: #151617;
    background: var(--accent-soft);
  }

  .task-instruction,
  .progress-message {
    background: rgba(255, 212, 42, 0.09);
  }

  textarea,
  .message--assistant,
  .markdown-body pre {
    background: #292d30;
    color: var(--text);
  }

  .message--user {
    color: #151617;
    background: var(--accent-soft);
  }

  .markdown-body code {
    color: #151617;
    background: var(--accent-soft);
  }

  .markdown-body pre code {
    color: var(--text);
    background: transparent;
  }
}
`.trim();

const askPageJs = `
const form = document.querySelector("#ask-form");
const formCard = document.querySelector("#ask-form-card");
const askInput = document.querySelector("#ask-input");
const askButton = document.querySelector("#ask-button");
const newChatButton = document.querySelector("#new-chat-button");
const statusText = document.querySelector("#status");
const taskInstruction = document.querySelector("#task-instruction");
const answerPanel = document.querySelector("#answer-panel");
const messages = document.querySelector("#messages");
const sourcesPanel = document.querySelector("#sources-panel");
const sourcesList = document.querySelector("#sources");
const afterConversationActions = document.querySelector(".after-conversation-actions");
let selectedMode = "ask";
let conversationHistory = [];
let progressTimer;
let progressStartedAt = 0;
let activeProgressMessage;
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
const taskPlaceholders = {
  ask: "Ask a question, paste Acton code, or paste compiler output...",
  error: "Paste the error message and preferably relevant source code...",
  code: "Paste the Acton code you want reviewed...",
  concept: "Write the Acton concept you want explained..."
};

afterConversationActions.hidden = true;

document.querySelectorAll(".task-button").forEach((button) => {
  button.addEventListener("click", () => {
    setSelectedMode(button.dataset.mode || "ask");
    askInput.focus();
  });
});

newChatButton.addEventListener("click", () => {
  conversationHistory = [];
  messages.replaceChildren();
  sourcesList.replaceChildren();
  sourcesPanel.hidden = true;
  answerPanel.hidden = true;
  afterConversationActions.hidden = true;
  formCard.classList.remove("follow-up");
  askButton.textContent = "Ask Acton";
  form.querySelector("label span").textContent = "What do you want help with?";
  askInput.value = "";
  askInput.rows = 14;
  setSelectedMode("ask");
  setStatus("");
  askInput.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = readPayload();
  if (!payload.question && !payload.code && !payload.error) {
    setStatus("Ask a question, paste Acton code, or paste compiler output first.", true);
    return;
  }

  const requestPayload = {
    ...payload,
    history: conversationHistory.slice(-8)
  };
  const userHistoryContent = historyContentForPayload(payload);

  appendMessage("user", displayTextForPayload(payload), selectedTaskLabel());
  answerPanel.hidden = false;
  moveFormAfterConversation();
  setLoading(true);
  setStatus("Asking Acton...");
  showProgress();
  sourcesList.replaceChildren();
  sourcesPanel.hidden = true;
  askInput.value = "";

  try {
    const assistantMessage = appendMessage("assistant", "", "Ask Acton");
    const data = await streamAnswer(requestPayload, assistantMessage.body);

    conversationHistory.push({
      role: "user",
      content: userHistoryContent
    });
    conversationHistory.push({
      role: "assistant",
      content: data.answer || ""
    });
    renderSources(data);
    setStatus("Answer ready.");
  } catch (error) {
    appendMessage("assistant", error instanceof Error ? error.message : "Ask Acton failed.", "Error");
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

function moveFormAfterConversation() {
  if (!formCard.classList.contains("follow-up")) {
    answerPanel.after(formCard);
  }

  formCard.classList.add("follow-up");
  selectedMode = "ask";
  afterConversationActions.hidden = false;
  formCard.after(afterConversationActions);
  form.querySelector("label span").textContent = "Follow up";
  askInput.rows = 5;
  askInput.placeholder = "Ask a follow-up, or paste signatures, code, or another error...";
  askButton.textContent = "Send follow-up";
}

async function streamAnswer(payload, assistantBody) {
  const response = await fetch("/api/ask/stream", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    const data = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : {};
    throw new Error(errorMessage(response, data));
  }

  if (!response.body) {
    throw new Error("Ask Acton could not stream a response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let finalData;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\\r\\n/g, "\\n");
    let separatorIndex = buffer.indexOf("\\n\\n");

    while (separatorIndex !== -1) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const event = parseServerSentEvent(block);

      if (event) {
        if (event.name === "delta") {
          answer += event.data.delta || "";
          assistantBody.innerHTML = renderMarkdown(answer);
        } else if (event.name === "done") {
          finalData = event.data;
          answer = finalData.answer || answer;
          assistantBody.innerHTML = renderMarkdown(answer || "Ask Acton did not return an answer.");
        } else if (event.name === "error") {
          throw new Error(errorMessage({ status: 502 }, event.data));
        }
      }

      separatorIndex = buffer.indexOf("\\n\\n");
    }
  }

  if (!finalData) {
    throw new Error("Ask Acton stream ended before the answer was complete.");
  }

  return finalData;
}

function parseServerSentEvent(block) {
  const lines = block.split("\\n");
  let name = "message";
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      name = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  return {
    name,
    data: JSON.parse(dataLines.join("\\n"))
  };
}

function displayTextForPayload(payload) {
  return payload.error || payload.code || payload.question || "";
}

function historyContentForPayload(payload) {
  if (payload.error) {
    return payload.question + "\\n\\nError output:\\n" + payload.error;
  }
  if (payload.code) {
    return payload.question + "\\n\\nActon code:\\n" + payload.code;
  }
  return payload.question || "";
}

function selectedTaskLabel() {
  const activeButton = document.querySelector(".task-button.active");
  return activeButton ? activeButton.textContent.trim().replace(/^✓\\s*/, "") : "You";
}

function setSelectedMode(mode) {
  selectedMode = taskInstructions[mode] ? mode : "ask";
  document.querySelectorAll(".task-button").forEach((taskButton) => {
    const active = taskButton.dataset.mode === selectedMode;
    taskButton.classList.toggle("active", active);
    taskButton.setAttribute("aria-pressed", active ? "true" : "false");
  });
  taskInstruction.textContent = taskInstructions[selectedMode];
  askInput.placeholder = taskPlaceholders[selectedMode];
}

function showProgress() {
  progressStartedAt = Date.now();
  activeProgressMessage = appendProgressMessage();
  updateProgress();
  progressTimer = window.setInterval(updateProgress, 1000);
  window.requestAnimationFrame(() => {
    activeProgressMessage.container.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  });
}

function hideProgress() {
  if (progressTimer) {
    window.clearInterval(progressTimer);
    progressTimer = undefined;
  }
  if (activeProgressMessage) {
    activeProgressMessage.container.remove();
    activeProgressMessage = undefined;
  }
}

function updateProgress() {
  if (!activeProgressMessage) {
    return;
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - progressStartedAt) / 1000));
  const messageIndex = Math.min(progressMessages.length - 1, Math.floor(elapsedSeconds / 6));
  activeProgressMessage.message.textContent = progressMessages[messageIndex];
  activeProgressMessage.elapsed.textContent =
    elapsedSeconds === 1 ? "1 second elapsed" : elapsedSeconds + " seconds elapsed";
}

function renderAnswer(data) {
  appendMessage("assistant", data.answer || "Ask Acton did not return an answer.", "Ask Acton");
  answerPanel.hidden = false;
  renderSources(data);
}

function renderSources(data) {
  const citations = Array.isArray(data.citations) ? data.citations : [];
  const sources = [];
  const seen = new Set();

  for (const citation of citations) {
    const label = citation.label || citation.path || citation.filename || citation.fileId;
    const url = citation.url;

    if (!label) {
      continue;
    }

    const key = url || label;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    sources.push({ label, url });
  }

  for (const source of sources) {
    const item = document.createElement("li");
    if (source.url) {
      const link = document.createElement("a");
      link.href = source.url;
      link.textContent = source.label;
      link.rel = "noopener";
      item.append(link);
    } else {
      const label = document.createElement("span");
      label.textContent = source.label;
      item.append(label);
    }
    sourcesList.append(item);
  }

  sourcesPanel.hidden = sourcesList.childElementCount === 0;
}

function appendMessage(role, content, label) {
  const message = document.createElement("article");
  message.className = "message message--" + role;

  const header = document.createElement("div");
  header.className = "message__header";
  header.textContent = label || (role === "user" ? "You" : "Ask Acton");

  const body = document.createElement("div");
  body.className = "message__body markdown-body";
  body.innerHTML = renderMarkdown(content);

  message.append(header, body);
  messages.append(message);
  return {
    message,
    body
  };
}

function appendProgressMessage() {
  const container = document.createElement("div");
  container.className = "progress-message";

  const spinner = document.createElement("div");
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = "Working on it";
  const message = document.createElement("p");
  const elapsed = document.createElement("p");
  elapsed.className = "progress-message__elapsed";

  body.append(heading, message, elapsed);
  container.append(spinner, body);
  messages.append(container);

  return {
    container,
    message,
    elapsed
  };
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
  if (data && data.error === "not_acton_related") {
    return data.message || "Ask Acton can only answer questions about Acton.";
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

app.get("/", async (_request, reply) =>
  reply.header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(askPageHtml)
);

app.get("/ask.css", async (_request, reply) =>
  reply.header("Cache-Control", "no-store").type("text/css; charset=utf-8").send(askPageCss)
);

app.get("/ask.js", async (_request, reply) =>
  reply.header("Cache-Control", "no-store").type("application/javascript; charset=utf-8").send(askPageJs)
);

app.post("/api/ask/stream", askRouteOptions, async (request, reply) => {
  const requestId = request.id;
  const parsed = askSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "invalid_request",
      requestId,
      details: z.treeifyError(parsed.error)
    });
  }

  if (!isActonRelated(parsed.data)) {
    return reply.code(422).send({
      ...notActonRelatedResponse,
      requestId
    });
  }

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const sendEvent = (event: string, data: unknown) => {
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    for await (const event of streamQuestion(parsed.data, requestId)) {
      sendEvent(event.type, event);
    }
  } catch (error) {
    request.log.error({ err: error, requestId }, "OpenAI stream failed");
    sendEvent("error", {
      error: "ask_acton_failed",
      requestId
    });
  } finally {
    reply.raw.end();
  }
});

app.post("/api/ask", askRouteOptions, async (request, reply) => {
  const requestId = request.id;
  const parsed = askSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "invalid_request",
      requestId,
      details: z.treeifyError(parsed.error)
    });
  }

  if (!isActonRelated(parsed.data)) {
    return reply.code(422).send({
      ...notActonRelatedResponse,
      requestId
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
