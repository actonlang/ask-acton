const runButton = document.querySelector("#run");
const code = document.querySelector("#code");
const lineNumbers = document.querySelector("#line-numbers");
const output = document.querySelector("#output");
const status = document.querySelector("#status");
const progressBar = document.querySelector("#progress-bar");

const stageLabels = {
  preparing: "Preparing workspace",
  starting: "Starting sandbox",
  compiling: "Compiling",
  running: "Running",
  complete: "Complete"
};

const stageProgress = {
  preparing: 8,
  starting: 18,
  compiling: 58,
  running: 82,
  complete: 100
};

code.addEventListener("input", updateLineNumbers);
code.addEventListener("scroll", syncLineNumberScroll);
runButton.addEventListener("click", runCode);
updateLineNumbers();

async function runCode() {
  runButton.disabled = true;
  setStage("preparing");
  output.textContent = "";

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
    output.textContent =
      error instanceof Error && error.message === "playground_busy"
        ? "The playground is busy. Runs are not queued, so try again in a few seconds."
        : "The playground is unavailable right now.";
    console.error(error);
  } finally {
    runButton.disabled = false;
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

function updateLineNumbers() {
  const lineCount = Math.max(1, code.value.split("\n").length);
  lineNumbers.textContent = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n");
  syncLineNumberScroll();
}

function syncLineNumberScroll() {
  lineNumbers.scrollTop = code.scrollTop;
}
