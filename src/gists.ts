import { playgroundConfig } from "./playground-config.js";

const gistIdPattern = /^[0-9a-f]+$/i;
const githubApiVersion = "2022-11-28";

interface GithubGistFile {
  filename?: string;
  language?: string | null;
  content?: string;
}

interface GithubGistResponse {
  id?: string;
  html_url?: string;
  files?: Record<string, GithubGistFile>;
}

export interface PlaygroundGist {
  id: string;
  htmlUrl: string;
  code: string;
}

export class GistError extends Error {
  constructor(
    message: "gist_unavailable" | "gist_not_found" | "gist_failed" | "invalid_gist_id",
    readonly statusCode: number
  ) {
    super(message);
  }
}

export function assertValidGistId(id: string): void {
  if (!gistIdPattern.test(id)) {
    throw new GistError("invalid_gist_id", 400);
  }
}

export async function createPlaygroundGist(code: string): Promise<PlaygroundGist> {
  if (!playgroundConfig.githubGistToken) {
    throw new GistError("gist_unavailable", 503);
  }

  const response = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: githubHeaders(),
    body: JSON.stringify({
      description: playgroundConfig.gistDescription,
      public: false,
      files: {
        [playgroundConfig.gistFilename]: {
          content: code
        }
      }
    })
  });

  if (!response.ok) {
    throw new GistError("gist_failed", 502);
  }

  const gist = (await response.json()) as GithubGistResponse;
  const id = gist.id;

  if (!id) {
    throw new GistError("gist_failed", 502);
  }

  return {
    id,
    htmlUrl: gist.html_url ?? `https://gist.github.com/${id}`,
    code
  };
}

export async function fetchPlaygroundGist(id: string): Promise<PlaygroundGist> {
  assertValidGistId(id);

  const response = await fetch(`https://api.github.com/gists/${id}`, {
    headers: githubHeaders()
  });

  if (response.status === 404) {
    throw new GistError("gist_not_found", 404);
  }

  if (!response.ok) {
    throw new GistError("gist_failed", 502);
  }

  const gist = (await response.json()) as GithubGistResponse;
  const file = selectActonFile(gist.files ?? {});

  if (!gist.id || !file?.content) {
    throw new GistError("gist_not_found", 404);
  }

  return {
    id: gist.id,
    htmlUrl: gist.html_url ?? `https://gist.github.com/${gist.id}`,
    code: file.content
  };
}

function selectActonFile(files: Record<string, GithubGistFile>): GithubGistFile | undefined {
  return (
    files[playgroundConfig.gistFilename] ??
    Object.values(files).find((file) => file.filename?.endsWith(".act")) ??
    Object.values(files)[0]
  );
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "acton-playground",
    "X-GitHub-Api-Version": githubApiVersion
  };

  if (playgroundConfig.githubGistToken) {
    headers.Authorization = `Bearer ${playgroundConfig.githubGistToken}`;
  }

  return headers;
}
