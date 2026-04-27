import { promises as fs } from "node:fs";
import path from "node:path";

type AskLogSession = {
  sessionId: string;
  startedAt: string;
  lastInteractionAt: string;
  turns: Array<{
    outcome: "answered" | "blocked" | "failed";
    request: {
      question?: string;
      code?: string;
      error?: string;
      page?: {
        url?: string;
        title?: string;
      };
    };
    response?: {
      answer?: string;
    };
  }>;
};

const logRoot = process.argv[2] ?? process.env.ASK_LOG_DIR ?? "/var/lib/ask-acton/ask-logs";
const sessions = await loadSessions(logRoot);

const totals = {
  sessions: sessions.length,
  turns: 0,
  answered: 0,
  blocked: 0,
  failed: 0,
  withCode: 0,
  withError: 0
};
const pages = new Map<string, number>();
const terms = new Map<string, number>();

for (const session of sessions) {
  for (const turn of session.turns) {
    totals.turns += 1;
    totals[turn.outcome] += 1;

    if (turn.request.code) {
      totals.withCode += 1;
    }

    if (turn.request.error) {
      totals.withError += 1;
    }

    if (turn.request.page?.url) {
      addCount(pages, normalizedPageUrl(turn.request.page.url));
    }

    for (const term of importantTerms(turn.request.question ?? "")) {
      addCount(terms, term);
    }
  }
}

console.log(`Ask Acton logs: ${logRoot}`);
console.log(`Sessions: ${totals.sessions}`);
console.log(`Turns: ${totals.turns}`);
console.log(`Answered: ${totals.answered}`);
console.log(`Blocked: ${totals.blocked}`);
console.log(`Failed: ${totals.failed}`);
console.log(`With code: ${totals.withCode}`);
console.log(`With errors: ${totals.withError}`);

printTop("Top pages", pages);
printTop("Common question terms", terms);

async function loadSessions(root: string): Promise<AskLogSession[]> {
  const files = await findJsonFiles(root);
  const loaded: AskLogSession[] = [];

  for (const file of files) {
    try {
      const content = await fs.readFile(file, "utf8");
      loaded.push(JSON.parse(content) as AskLogSession);
    } catch (error) {
      console.warn(`Could not read ${file}:`, error);
    }
  }

  return loaded;
}

async function findJsonFiles(root: string): Promise<string[]> {
  let entries;

  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findJsonFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }

  return files;
}

function importantTerms(text: string): string[] {
  const stopWords = new Set([
    "about",
    "acton",
    "after",
    "again",
    "answer",
    "code",
    "does",
    "error",
    "explain",
    "from",
    "have",
    "help",
    "this",
    "what",
    "when",
    "where",
    "with"
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 4 && !stopWords.has(term))
    .slice(0, 40);
}

function normalizedPageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function addCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function printTop(title: string, counts: Map<string, number>): void {
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  if (top.length === 0) {
    return;
  }

  console.log("");
  console.log(`${title}:`);

  for (const [label, count] of top) {
    console.log(`  ${count.toString().padStart(4, " ")}  ${label}`);
  }
}
