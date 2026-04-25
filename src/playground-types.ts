export interface PlaygroundRunRequest {
  code: string;
  stdin?: string;
  args?: string[];
}

export interface PlaygroundRunResponse {
  id: string;
  status: "ok" | "error" | "timeout";
  exitCode: number | null;
  compilerOutput: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

export type PlaygroundRunStage = "preparing" | "starting" | "compiling" | "running" | "complete";

export type PlaygroundRunEvent =
  | {
      type: "status";
      stage: PlaygroundRunStage;
      elapsedMs: number;
    }
  | {
      type: "compiler";
      text: string;
    }
  | {
      type: "stdout" | "stderr";
      text: string;
    };
