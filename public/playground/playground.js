const runButton = document.querySelector("#run");
const code = document.querySelector("#code");
const output = document.querySelector("#output");
const status = document.querySelector("#status");

runButton.addEventListener("click", runCode);

async function runCode() {
  runButton.disabled = true;
  status.textContent = "Running";
  output.textContent = "";

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        code: code.value
      })
    });

    if (!response.ok) {
      throw new Error(`Playground returned ${response.status}`);
    }

    const result = await response.json();
    status.textContent = `${result.status} in ${result.durationMs} ms`;
    output.textContent = formatOutput(result);
  } catch (error) {
    status.textContent = "Failed";
    output.textContent = "The playground is unavailable right now.";
    console.error(error);
  } finally {
    runButton.disabled = false;
  }
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
