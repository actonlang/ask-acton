const runButton = document.querySelector("#run");
const showTypesButton = document.querySelector("#show-types");
const shareButton = document.querySelector("#share");
const code = document.querySelector("#code");
const lineNumbers = document.querySelector("#line-numbers");
const output = document.querySelector("#output");
const typesOutput = document.querySelector("#types-output");
const outputTab = document.querySelector("#output-tab");
const typesTab = document.querySelector("#types-tab");
const status = document.querySelector("#status");
const progressBar = document.querySelector("#progress-bar");

const stageLabels = {
  preparing: "Preparing workspace",
  starting: "Starting sandbox",
  typing: "Inferring types",
  compiling: "Compiling",
  running: "Running",
  complete: "Complete"
};

const stageProgress = {
  preparing: 8,
  starting: 18,
  typing: 36,
  compiling: 58,
  running: 82,
  complete: 100
};

code.addEventListener("input", updateLineNumbers);
code.addEventListener("scroll", syncLineNumberScroll);
runButton.addEventListener("click", () => runCode("output"));
showTypesButton.addEventListener("click", () => runCode("types"));
shareButton.addEventListener("click", shareCode);
outputTab.addEventListener("click", () => showResultView("output"));
typesTab.addEventListener("click", () => showResultView("types"));
updateLineNumbers();
void loadSharedGist();

async function runCode(preferredView) {
  setButtonsDisabled(true);
  showResultView(preferredView);
  setStage("preparing");
  output.textContent = "";
  typesOutput.textContent = "";

  try {
    const response = await fetch("/api/run/stream", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        code: code.value
      })
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("playground_busy");
      }

      throw new Error(`Playground returned ${response.status}`);
    }

    const result = await readRunStream(response);

    if (!result) {
      throw new Error("Playground stream ended without a result");
    }

    finishRun(result);
  } catch (error) {
    status.textContent = "Failed";
    progressBar.style.width = "100%";
    const message =
      error instanceof Error && error.message === "playground_busy"
        ? "The playground is busy. Runs are not queued, so try again in a few seconds."
        : "The playground is unavailable right now.";
    output.textContent = message;
    typesOutput.textContent = message;
    console.error(error);
  } finally {
    setButtonsDisabled(false);
  }
}

async function readRunStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }

      const event = JSON.parse(line);

      if (event.type === "result") {
        result = event.result;
      } else {
        handleRunEvent(event);
      }
    }
  }

  const tail = buffer + decoder.decode();

  if (tail.trim().length > 0) {
    const event = JSON.parse(tail);

    if (event.type === "result") {
      result = event.result;
    } else {
      handleRunEvent(event);
    }
  }

  return result;
}

function handleRunEvent(event) {
  if (event.type === "status") {
    setStage(event.stage, event.elapsedMs);
    return;
  }

  if (event.type === "stdout" || event.type === "stderr") {
    appendOutput(output, event.text);
    return;
  }

  if (event.type === "error") {
    throw new Error(event.error);
  }
}

function finishRun(result) {
  setStage("complete", result.durationMs);
  status.textContent = `${result.status} in ${result.durationMs} ms`;
  output.textContent = formatOutput(result);
  typesOutput.textContent = formatTypes(result);
}

function formatOutput(result) {
  const sections = [];

  if (result.stdout) {
    sections.push(result.stdout.trimEnd());
  }

  if (result.stderr) {
    sections.push(result.stderr.trimEnd());
  }

  if (result.exitCode !== 0 && result.exitCode !== null) {
    sections.push(`exit code: ${result.exitCode}`);
  }

  if (result.truncated) {
    sections.push("output truncated");
  }

  return sections.join("\n\n");
}

function formatTypes(result) {
  if (result.signatures) {
    return result.signatures.trimEnd();
  }

  return "No inferred signatures were produced.";
}

function setStage(stage, elapsedMs) {
  const label = stageLabels[stage] ?? "Running";
  const suffix = Number.isFinite(elapsedMs) ? ` (${elapsedMs} ms)` : "";
  status.textContent = `${label}${suffix}`;
  progressBar.style.width = `${stageProgress[stage] ?? 30}%`;
}

function appendOutput(element, text) {
  element.textContent += text;
  element.scrollTop = element.scrollHeight;
}

function showResultView(view) {
  const showTypes = view === "types";

  output.hidden = showTypes;
  typesOutput.hidden = !showTypes;
  output.classList.toggle("is-active", !showTypes);
  typesOutput.classList.toggle("is-active", showTypes);
  outputTab.classList.toggle("is-active", !showTypes);
  typesTab.classList.toggle("is-active", showTypes);
  outputTab.setAttribute("aria-selected", showTypes ? "false" : "true");
  typesTab.setAttribute("aria-selected", showTypes ? "true" : "false");
}

function setButtonsDisabled(disabled) {
  runButton.disabled = disabled;
  showTypesButton.disabled = disabled;
  shareButton.disabled = disabled;
}

function updateLineNumbers() {
  const lineCount = Math.max(1, code.value.split("\n").length);
  lineNumbers.textContent = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n");
  syncLineNumberScroll();
}

function syncLineNumberScroll() {
  lineNumbers.scrollTop = code.scrollTop;
}

async function shareCode() {
  setButtonsDisabled(true);
  showResultView("output");
  status.textContent = "Creating share link";

  try {
    const response = await fetch("/api/gists", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        code: code.value
      })
    });
    const gist = await parseJsonResponse(response);
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set("gist", gist.id);
    window.history.replaceState(null, "", shareUrl);

    const copied = await copyShareUrl(shareUrl.toString());
    status.textContent = copied ? "Share link copied" : "Share link ready";
    output.textContent = `Share link:\n${shareUrl.toString()}\n\nGitHub gist:\n${gist.htmlUrl}`;
  } catch (error) {
    status.textContent = "Failed";
    output.textContent = shareErrorMessage(error);
    console.error(error);
  } finally {
    setButtonsDisabled(false);
  }
}

async function loadSharedGist() {
  const gistId = new URLSearchParams(window.location.search).get("gist");

  if (!gistId) {
    return;
  }

  setButtonsDisabled(true);
  status.textContent = "Loading shared snippet";

  try {
    const response = await fetch(`/api/gists/${encodeURIComponent(gistId)}`);
    const gist = await parseJsonResponse(response);
    code.value = gist.code;
    code.scrollTop = 0;
    updateLineNumbers();
    status.textContent = "Shared snippet loaded";
  } catch (error) {
    status.textContent = "Failed";
    output.textContent = shareErrorMessage(error);
    console.error(error);
  } finally {
    setButtonsDisabled(false);
  }
}

async function parseJsonResponse(response) {
  let payload;

  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  return payload;
}

async function copyShareUrl(url) {
  if (!navigator.clipboard || !window.isSecureContext) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

function shareErrorMessage(error) {
  if (!(error instanceof Error)) {
    return "Sharing is unavailable right now.";
  }

  switch (error.message) {
    case "gist_unavailable":
      return "Sharing is not configured on this playground.";
    case "gist_not_found":
      return "That shared snippet could not be found.";
    case "gist_too_large":
      return "That shared snippet is too large for the playground.";
    case "invalid_gist_id":
      return "That shared snippet link is invalid.";
    default:
      return "Sharing is unavailable right now.";
  }
}
