import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { playgroundConfig } from "./playground-config.js";
import type { PlaygroundRunRequest, PlaygroundRunResponse } from "./playground-types.js";

let activeRuns = 0;

export async function runActonSnippet(request: PlaygroundRunRequest): Promise<PlaygroundRunResponse> {
  if (activeRuns >= playgroundConfig.maxConcurrentRuns) {
    throw new Error("playground_busy");
  }

  activeRuns += 1;

  try {
    return await runInDocker(request);
  } finally {
    activeRuns -= 1;
  }
}

async function runInDocker(request: PlaygroundRunRequest): Promise<PlaygroundRunResponse> {
  const id = randomUUID();
  const workspace = path.join(playgroundConfig.workspaceRoot, id);
  const sourcePath = path.join(workspace, "main.act");
  const started = Date.now();

  await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
  await fs.mkdir(playgroundConfig.cacheRoot, { recursive: true, mode: 0o700 });
  await fs.writeFile(sourcePath, request.code, { mode: 0o600 });

  const containerName = `acton-playground-${id}`;
  const args = dockerArgs(containerName, workspace, request.args ?? []);
  const child = spawn(playgroundConfig.dockerBin, args, {
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  let truncated = false;
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    void killContainer(containerName);
  }, (playgroundConfig.timeoutSeconds + 2) * 1000);

  child.stdin.end(request.stdin ?? "");

  child.stdout.on("data", (chunk: Buffer) => {
    const next = appendLimited(stdout, chunk.toString("utf8"));
    stdout = next.value;
    truncated = truncated || next.truncated;
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const next = appendLimited(stderr, chunk.toString("utf8"));
    stderr = next.value;
    truncated = truncated || next.truncated;
  });

  try {
    const exitCode = await waitForChild(child);
    const durationMs = Date.now() - started;
    return {
      id,
      status: timedOut ? "timeout" : exitCode === 0 ? "ok" : "error",
      exitCode,
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
  return `timeout -s KILL ${timeout}s runacton /workspace/main.act ${quotedArgs}`;
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
