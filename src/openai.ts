import OpenAI from "openai";
import type { ResponseCreateParamsBase } from "openai/resources/responses/responses";
import { config } from "./config.js";
import { buildUserInput, systemPrompt } from "./prompt.js";
import type { AskRequest, AskResponse, ChatMessage, SourceCitation } from "./types.js";

const client = new OpenAI({
  apiKey: config.openaiApiKey
});

const guideBaseUrl = "https://acton.guide/";
const actonRepoBaseUrl = "https://github.com/actonlang/acton/blob/main/";
const changelogSource = "acton-changelog";
const citationMetadataCache = new Map<string, Promise<Partial<SourceCitation>>>();

export async function answerQuestion(request: AskRequest, requestId: string): Promise<AskResponse> {
  const response = await client.responses.create({
    ...responseParams(request),
    stream: false
  });

  return {
    answer: response.output_text.trim(),
    model: config.openaiModel,
    requestId,
    citations: await collectCitations(response)
  };
}

export async function* streamQuestion(
  request: AskRequest,
  requestId: string
): AsyncGenerator<
  | { type: "delta"; delta: string }
  | { type: "done"; answer: string; model: string; requestId: string; citations: SourceCitation[] }
> {
  const stream = client.responses.stream(responseParams(request));
  let answer = "";

  for await (const event of stream) {
    if (event.type === "response.output_text.delta" && event.delta) {
      answer += event.delta;
      yield {
        type: "delta",
        delta: event.delta
      };
    }
  }

  const response = await stream.finalResponse();

  yield {
    type: "done",
    answer: answer.trim(),
    model: config.openaiModel,
    requestId,
    citations: await collectCitations(response)
  };
}

function responseParams(request: AskRequest): Omit<ResponseCreateParamsBase, "stream"> {
  const history = sanitizeHistory(request.history ?? []);
  const input: OpenAI.Responses.ResponseInput = [
    {
      type: "message",
      role: "system",
      content: systemPrompt
    },
    ...history.map((message) => ({
      type: "message" as const,
      role: message.role,
      content: message.content
    })),
    {
      type: "message",
      role: "user",
      content: buildUserInput(request)
    }
  ];

  const tools = config.openaiVectorStoreId
    ? [
        {
          type: "file_search" as const,
          vector_store_ids: [config.openaiVectorStoreId],
          max_num_results: 8
        }
      ]
    : undefined;

  return {
    model: config.openaiModel,
    max_output_tokens: config.openaiMaxOutputTokens,
    input,
    tools
  };
}

function sanitizeHistory(history: ChatMessage[]): ChatMessage[] {
  return history
    .slice(-config.maxHistoryMessages)
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, config.maxContextChars)
    }));
}

async function collectCitations(response: OpenAI.Responses.Response): Promise<SourceCitation[]> {
  const citations: SourceCitation[] = [];

  for (const item of response.output) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content) {
      if (content.type !== "output_text") {
        continue;
      }

      for (const annotation of content.annotations ?? []) {
        if (annotation.type !== "file_citation") {
          continue;
        }

        citations.push({
          fileId: annotation.file_id,
          filename: annotation.filename,
          index: annotation.index
        });
      }
    }
  }

  return enrichCitations(dedupeCitations(citations));
}

function dedupeCitations(citations: SourceCitation[]): SourceCitation[] {
  const seen = new Set<string>();
  const deduped: SourceCitation[] = [];

  for (const citation of citations) {
    const key = `${citation.fileId ?? ""}:${citation.filename ?? ""}:${citation.index ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(citation);
  }

  return deduped;
}

async function enrichCitations(citations: SourceCitation[]): Promise<SourceCitation[]> {
  return Promise.all(
    citations.map(async (citation) => {
      const metadata = citation.fileId ? await citationMetadata(citation.fileId) : {};
      const sourcePath = metadata.path ?? citation.filename;
      const source = metadata.source;
      const citationUrl =
        typeof sourcePath === "string" &&
        (isChangelogSource(sourcePath, source) || isLinkableSourcePath(sourcePath, metadata.path))
          ? urlForSourcePath(sourcePath, source)
          : undefined;
      const citationLabel =
        typeof sourcePath === "string" ? labelForSourcePath(sourcePath, source) : undefined;

      return {
        ...citation,
        ...metadata,
        label: citationLabel ?? metadata.label ?? citation.filename ?? citation.fileId,
        url: citationUrl ?? metadata.url
      };
    })
  );
}

function citationMetadata(fileId: string): Promise<Partial<SourceCitation>> {
  const cached = citationMetadataCache.get(fileId);
  if (cached) {
    return cached;
  }

  const metadata = loadCitationMetadata(fileId);
  citationMetadataCache.set(fileId, metadata);
  return metadata;
}

async function loadCitationMetadata(fileId: string): Promise<Partial<SourceCitation>> {
  if (!config.openaiVectorStoreId) {
    return {};
  }

  try {
    const vectorFile = await client.vectorStores.files.retrieve(fileId, {
      vector_store_id: config.openaiVectorStoreId
    });
    const sourcePath = vectorFile.attributes?.path;
    const source = vectorFile.attributes?.source;

    if (typeof sourcePath !== "string" || sourcePath.length === 0) {
      return {};
    }

    const normalizedSource = typeof source === "string" && source.length > 0 ? source : undefined;

    return {
      path: sourcePath,
      ...(normalizedSource ? { source: normalizedSource } : {}),
      label: labelForSourcePath(sourcePath, normalizedSource),
      url: urlForSourcePath(sourcePath, normalizedSource)
    };
  } catch (error) {
    console.warn(`Could not resolve citation metadata for ${fileId}:`, error);
    return {};
  }
}

function urlForSourcePath(sourcePath: string, source?: string): string | undefined {
  if (isChangelogSource(sourcePath, source)) {
    return new URL("CHANGELOG.md", actonRepoBaseUrl).toString();
  }

  return guideUrlForSourcePath(sourcePath);
}

function labelForSourcePath(sourcePath: string, source?: string): string | undefined {
  if (isChangelogSource(sourcePath, source)) {
    return "CHANGELOG.md";
  }

  return guideLabelForSourcePath(sourcePath);
}

function guideUrlForSourcePath(sourcePath: string): string | undefined {
  const normalizedPath = normalizeSourcePath(sourcePath);

  if (normalizedPath === "SUMMARY.md") {
    return undefined;
  }

  if (!normalizedPath.endsWith(".md")) {
    return undefined;
  }

  return new URL(normalizedPath.replace(/\.md$/, ".html"), guideBaseUrl).toString();
}

function guideLabelForSourcePath(sourcePath: string): string | undefined {
  const normalizedPath = normalizeSourcePath(sourcePath);
  const guidePath = normalizedPath.endsWith(".md") ? normalizedPath.replace(/\.md$/, ".html") : normalizedPath;

  if (guidePath === "SUMMARY.html") {
    return undefined;
  }

  return guidePath;
}

function isLinkableSourcePath(sourcePath: string, metadataPath: unknown): boolean {
  return typeof metadataPath === "string" || sourcePath.includes("/") || sourcePath.includes("\\");
}

function isChangelogSource(sourcePath: string, source?: string): boolean {
  return source === changelogSource || normalizeSourcePath(sourcePath) === "CHANGELOG.md";
}

function normalizeSourcePath(sourcePath: string): string {
  return sourcePath
    .replace(/\\/g, "/")
    .replace(/^.*\/docs\/acton-guide\/src\//, "")
    .replace(/^.*\/acton-guide\/src\//, "")
    .replace(/^\/+/, "");
}
