import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { playgroundConfig } from "./playground-config.js";
import type { PlaygroundRunEvent, PlaygroundRunRequest, PlaygroundRunResponse, PlaygroundRunStage } from "./playground-types.js";

let activeRuns = 0;

type PlaygroundRunEventHandler = (event: PlaygroundRunEvent) => void;

const compileMarker = "__ACTON_PLAYGROUND_STAGE__:compile\n";
const runMarker = "__ACTON_PLAYGROUND_STAGE__:run\n";
const stageMarkers = [compileMarker, runMarker] as const;

export async function runActonSnippet(
  request: PlaygroundRunRequest,
  onEvent?: PlaygroundRunEventHandler
): Promise<PlaygroundRunResponse> {
  if (activeRuns >= playgroundConfig.maxConcurrentRuns) {
    throw new Error("playground_busy");
  }

  activeRuns += 1;

  try {
    return await runInDocker(request, onEvent);
  } finally {
    activeRuns -= 1;
  }
}

async function runInDocker(
  request: PlaygroundRunRequest,
  onEvent?: PlaygroundRunEventHandler
): Promise<PlaygroundRunResponse> {
  const id = randomUUID();
  const workspace = path.join(playgroundConfig.workspaceRoot, id);
  const sourcePath = path.join(workspace, "main.act");
  const started = Date.now();
  let stage: PlaygroundRunStage = "preparing";
  const outputState: { target: "compiler" | "program" } = {
    target: "program"
  };

  const setStage = (nextStage: PlaygroundRunStage) => {
    stage = nextStage;
    onEvent?.({
      type: "status",
      stage,
      elapsedMs: Date.now() - started
    });
  };

  setStage("preparing");
  await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
  await fs.mkdir(playgroundConfig.cacheRoot, { recursive: true, mode: 0o700 });
  await fs.writeFile(sourcePath, request.code, { mode: 0o600 });

  const containerName = `acton-playground-${id}`;
  const args = dockerArgs(containerName, workspace, request.args ?? []);
  setStage("starting");
  const child = spawn(playgroundConfig.dockerBin, args, {
    stdio: ["pipe", "pipe", "pipe"]
  });

  let compilerOutput = "";
  let stdout = "";
  let stderr = "";
  let pendingStderr = "";
  let truncated = false;
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    void killContainer(containerName);
  }, (playgroundConfig.timeoutSeconds + 2) * 1000);

  child.stdin.end(request.stdin ?? "");

  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");

    if (outputState.target === "compiler") {
      const next = appendLimited(compilerOutput, text);
      compilerOutput = next.value;
      truncated = truncated || next.truncated;
      onEvent?.({ type: "compiler", text });
      return;
    }

    const next = appendLimited(stdout, text);
    stdout = next.value;
    truncated = truncated || next.truncated;
    onEvent?.({ type: "stdout", text });
  });

  child.stderr.on("data", (chunk: Buffer) => {
    pendingStderr = processStderr(chunk.toString("utf8"), pendingStderr, (nextStage) => {
      outputState.target = nextStage === "compiling" ? "compiler" : "program";
      setStage(nextStage);
    }, (text) => {
      if (outputState.target === "compiler") {
        const next = appendLimited(compilerOutput, text);
        compilerOutput = next.value;
        truncated = truncated || next.truncated;
        onEvent?.({ type: "compiler", text });
        return;
      }

      const next = appendLimited(stderr, text);
      stderr = next.value;
      truncated = truncated || next.truncated;
      onEvent?.({ type: "stderr", text });
    });
  });

  try {
    const exitCode = await waitForChild(child);
    if (pendingStderr.length > 0) {
      if (outputState.target === "compiler") {
        const next = appendLimited(compilerOutput, pendingStderr);
        compilerOutput = next.value;
        truncated = truncated || next.truncated;
        onEvent?.({ type: "compiler", text: pendingStderr });
      } else {
        const next = appendLimited(stderr, pendingStderr);
        stderr = next.value;
        truncated = truncated || next.truncated;
        onEvent?.({ type: "stderr", text: pendingStderr });
      }
    }

    setStage("complete");
    const durationMs = Date.now() - started;
    return {
      id,
      status: timedOut ? "timeout" : exitCode === 0 ? "ok" : "error",
      exitCode,
      compilerOutput,
      stdout,
      stderr: timedOut ? withTimeoutMessage(stderr) : stderr,
      durationMs,
      truncated
    };
  } finally {
    clearTimeout(timer);
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

function dockerArgs(containerName: string, workspace: string, scriptArgs: string[]): string[] {
  return [
    "run",
    "--rm",
    "--name",
    containerName,
    "--network",
    "none",
    "--cpus",
    playgroundConfig.cpuLimit,
    "--memory",
    playgroundConfig.memoryLimit,
    "--pids-limit",
    String(playgroundConfig.pidsLimit),
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,exec,nosuid,nodev,size=256m",
    "--tmpfs",
    "/home/acton:rw,exec,nosuid,nodev,size=512m",
    "-e",
    "HOME=/home/acton",
    "-e",
    "XDG_CACHE_HOME=/home/acton/.cache",
    "-v",
    `${playgroundConfig.cacheRoot}:/home/acton/.cache:rw`,
    "-v",
    `${workspace}:/workspace:rw`,
    "-w",
    "/workspace",
    playgroundConfig.actonImage,
    "sh",
    "-lc",
    runnerCommand(scriptArgs)
  ];
}

function runnerCommand(scriptArgs: string[]): string {
  const quotedArgs = scriptArgs.map(shellQuote).join(" ");
  const timeout = playgroundConfig.timeoutSeconds;
  const script = [
    `printf ${shellQuote(compileMarker)} >&2`,
    "acton --color never --timing /workspace/main.act >&2",
    "compile_status=$?",
    "if [ \"$compile_status\" -ne 0 ]; then exit \"$compile_status\"; fi",
    `printf ${shellQuote(runMarker)} >&2`,
    `exec /workspace/main ${quotedArgs}`
  ].join("\n");

  return `timeout -s KILL ${timeout}s sh -lc ${shellQuote(script)}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function appendLimited(current: string, chunk: string): { value: string; truncated: boolean } {
  const max = playgroundConfig.maxOutputChars;
  if (current.length >= max) {
    return { value: current, truncated: true };
  }

  const combined = current + chunk;
  if (combined.length <= max) {
    return { value: combined, truncated: false };
  }

  return {
    value: combined.slice(0, max),
    truncated: true
  };
}

function waitForChild(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

function processStderr(
  chunk: string,
  pending: string,
  setStage: (stage: PlaygroundRunStage) => void,
  appendText: (text: string) => void
): string {
  let text = pending + chunk;

  while (text.length > 0) {
    const next = nextMarker(text);

    if (!next) {
      const keepLength = markerPrefixSuffixLength(text);
      const output = text.slice(0, text.length - keepLength);

      if (output.length > 0) {
        appendText(output);
      }

      return text.slice(text.length - keepLength);
    }

    const before = text.slice(0, next.index);

    if (before.length > 0) {
      appendText(before);
    }

    setStage(next.marker === compileMarker ? "compiling" : "running");
    text = text.slice(next.index + next.marker.length);
  }

  return "";
}

function nextMarker(text: string): { index: number; marker: typeof stageMarkers[number] } | undefined {
  const matches = stageMarkers
    .map((marker) => ({
      marker,
      index: text.indexOf(marker)
    }))
    .filter((match) => match.index >= 0)
    .sort((left, right) => left.index - right.index);

  return matches[0];
}

function markerPrefixSuffixLength(text: string): number {
  const maxLength = Math.min(text.length, Math.max(...stageMarkers.map((marker) => marker.length - 1)));

  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = text.slice(text.length - length);

    if (stageMarkers.some((marker) => marker.startsWith(suffix))) {
      return length;
    }
  }

  return 0;
}

async function killContainer(containerName: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const killer = spawn(playgroundConfig.dockerBin, ["kill", containerName], {
      stdio: "ignore"
    });
    killer.on("close", () => resolve());
    killer.on("error", () => resolve());
  });
}

function withTimeoutMessage(stderr: string): string {
  const message = `\nExecution timed out after ${playgroundConfig.timeoutSeconds} seconds.\n`;
  return appendLimited(stderr, message).value;
}
