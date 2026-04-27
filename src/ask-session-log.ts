import { promises as fs } from "node:fs";
import path from "node:path";
import type { AskRequest, SourceCitation } from "./types.js";

export type LoggedAskTurn = {
  requestId: string;
  startedAt: string;
  completedAt: string;
  outcome: "answered" | "blocked" | "failed";
  request: LoggedAskRequest;
  response?: {
    answer?: string;
    model?: string;
    citations?: SourceCitation[];
  };
  error?: {
    code: string;
    message?: string;
  };
};

type LoggedAskRequest = {
  question?: string;
  code?: string;
  error?: string;
  page?: {
    url?: string;
    title?: string;
  };
  historyMessages?: number;
};

type AskSession = {
  sessionId: string;
  startedAt: string;
  lastInteractionAt: string;
  turns: LoggedAskTurn[];
};

type SessionState = {
  session: AskSession;
  idleTimer?: NodeJS.Timeout;
  flushing?: Promise<void>;
};

export type AskSessionLoggerOptions = {
  enabled: boolean;
  logDir: string;
  idleSeconds: number;
};

export class AskSessionLogger {
  private readonly sessions = new Map<string, SessionState>();
  private readonly idleMs: number;

  constructor(private readonly options: AskSessionLoggerOptions) {
    this.idleMs = Math.max(1, options.idleSeconds) * 1000;
  }

  record(sessionId: string, turn: LoggedAskTurn): void {
    if (!this.options.enabled) {
      return;
    }

    const now = turn.completedAt;
    const state = this.stateFor(sessionId, turn.startedAt);
    state.session.lastInteractionAt = now;
    state.session.turns.push(turn);
    this.scheduleFlush(sessionId, state);
  }

  async flushAll(): Promise<void> {
    const flushes = [...this.sessions.keys()].map((sessionId) => this.flush(sessionId));
    await Promise.allSettled(flushes);
  }

  private stateFor(sessionId: string, startedAt: string): SessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const state: SessionState = {
      session: {
        sessionId,
        startedAt,
        lastInteractionAt: startedAt,
        turns: []
      }
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  private scheduleFlush(sessionId: string, state: SessionState): void {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
    }

    state.idleTimer = setTimeout(() => {
      void this.flush(sessionId);
    }, this.idleMs);

    state.idleTimer.unref();
  }

  private async flush(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return;
    }

    if (state.flushing) {
      return state.flushing;
    }

    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = undefined;
    }

    state.flushing = this.writeSession(state.session)
      .then(() => {
        this.sessions.delete(sessionId);
      })
      .catch((error) => {
        console.error("Could not write Ask Acton session log:", error);
        this.scheduleFlush(sessionId, state);
      })
      .finally(() => {
        state.flushing = undefined;
      });

    return state.flushing;
  }

  private async writeSession(session: AskSession): Promise<void> {
    if (session.turns.length === 0) {
      return;
    }

    const day = session.startedAt.slice(0, 10);
    const sessionDir = path.join(this.options.logDir, day);
    const file = path.join(
      sessionDir,
      `${safeFilePart(session.startedAt)}-${safeFilePart(session.sessionId)}.json`
    );
    const tempFile = `${file}.${process.pid}.tmp`;
    const payload = JSON.stringify(session, null, 2) + "\n";

    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(tempFile, payload, { mode: 0o600 });
    await fs.rename(tempFile, file);
  }
}

export function loggedRequest(request: AskRequest): LoggedAskRequest {
  return {
    question: request.question,
    code: request.code,
    error: request.error,
    page: request.page
      ? {
          url: request.page.url,
          title: request.page.title
        }
      : undefined,
    historyMessages: request.history?.length
  };
}

export function sessionIdFor(request: AskRequest, requestId: string): string {
  return request.sessionId ?? `request-${requestId}`;
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "session";
}
