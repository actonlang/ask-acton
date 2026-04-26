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
const typeMarker = "__ACTON_PLAYGROUND_STAGE__:types\n";
const stageMarkers = [typeMarker, compileMarker, runMarker] as const;

export function isPlaygroundAtCapacity(): boolean {
  return activeRuns >= playgroundConfig.maxConcurrentRuns;
}

export async function runActonSnippet(
  request: PlaygroundRunRequest,
  onEvent?: PlaygroundRunEventHandler
): Promise<PlaygroundRunResponse> {
  if (isPlaygroundAtCapacity()) {
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
  const signaturesPath = path.join(workspace, ".acton-playground-sigs");
  const started = Date.now();

  const setStage = (nextStage: PlaygroundRunStage) => {
    onEvent?.({
      type: "status",
      stage: nextStage,
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
    const next = appendLimited(stdout, text);
    stdout = next.value;
    truncated = truncated || next.truncated;
    onEvent?.({ type: "stdout", text });
  });

  child.stderr.on("data", (chunk: Buffer) => {
    pendingStderr = processStderr(chunk.toString("utf8"), pendingStderr, setStage, (text) => {
      const next = appendLimited(stderr, text);
      stderr = next.value;
      truncated = truncated || next.truncated;
      onEvent?.({ type: "stderr", text });
    });
  });

  try {
    const exitCode = await waitForChild(child);
    const timeout = timedOut || isTimeoutExit(exitCode);
    const signatures = await readLimitedFile(signaturesPath);
    if (pendingStderr.length > 0) {
      const next = appendLimited(stderr, pendingStderr);
      stderr = next.value;
      truncated = truncated || next.truncated;
      onEvent?.({ type: "stderr", text: pendingStderr });
    }

    setStage("complete");
    const durationMs = Date.now() - started;
    return {
      id,
      status: timeout ? "timeout" : exitCode === 0 ? "ok" : "error",
      exitCode,
      stdout,
      stderr: timeout ? withTimeoutMessage(stderr) : stderr,
      signatures: signatures.value,
      durationMs,
      truncated: truncated || signatures.truncated
    };
  } finally {
    clearTimeout(timer);
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

function dockerArgs(containerName: string, workspace: string, scriptArgs: string[]): string[] {
  const networkArgs = playgroundConfig.dockerNetwork.length > 0 ? ["--network", playgroundConfig.dockerNetwork] : [];

  return [
    "run",
    "--rm",
    "--name",
    containerName,
    ...networkArgs,
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
    `printf ${shellQuote(typeMarker)} >&2`,
    "acton --quiet --color never --sigs /workspace/main.act > /workspace/.acton-playground-sigs",
    "sigs_status=$?",
    "if [ \"$sigs_status\" -ne 0 ]; then exit \"$sigs_status\"; fi",
    `printf ${shellQuote(compileMarker)} >&2`,
    "acton --quiet --color never --tempdir /tmp/acton-build /workspace/main.act >&2",
    "compile_status=$?",
    "if [ \"$compile_status\" -ne 0 ]; then exit \"$compile_status\"; fi",
    "if [ ! -x /workspace/main ]; then exit 1; fi",
    `printf ${shellQuote(runMarker)} >&2`,
    `exec /workspace/main ${quotedArgs}`
  ].join("\n");

  return `timeout -s TERM -k 2s ${timeout}s sh -lc ${shellQuote(script)}`;
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

async function readLimitedFile(filePath: string): Promise<{ value: string; truncated: boolean }> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return appendLimited("", content);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { value: "", truncated: false };
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function waitForChild(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

function isTimeoutExit(exitCode: number | null): boolean {
  return exitCode === 124 || exitCode === 137 || exitCode === 143;
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

    setStage(markerStage(next.marker));
    text = text.slice(next.index + next.marker.length);
  }

  return "";
}

function markerStage(marker: typeof stageMarkers[number]): PlaygroundRunStage {
  if (marker === typeMarker) {
    return "typing";
  }

  return marker === compileMarker ? "compiling" : "running";
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
