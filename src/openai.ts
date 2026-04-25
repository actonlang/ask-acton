import OpenAI from "openai";
import { config } from "./config.js";
import { buildUserInput, systemPrompt } from "./prompt.js";
import type { AskRequest, AskResponse, ChatMessage, SourceCitation } from "./types.js";

const client = new OpenAI({
  apiKey: config.openaiApiKey
});

export async function answerQuestion(request: AskRequest, requestId: string): Promise<AskResponse> {
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

  const response = await client.responses.create({
    model: config.openaiModel,
    input,
    tools
  });

  return {
    answer: response.output_text.trim(),
    model: config.openaiModel,
    requestId,
    citations: collectCitations(response)
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

function collectCitations(response: OpenAI.Responses.Response): SourceCitation[] {
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

  return dedupeCitations(citations);
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
