export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface PageContext {
  url?: string;
  title?: string;
  excerpt?: string;
}

export interface AskRequest {
  question: string;
  code?: string;
  error?: string;
  page?: PageContext;
  history?: ChatMessage[];
}

export interface SourceCitation {
  fileId?: string;
  filename?: string;
  index?: number;
}

export interface AskResponse {
  answer: string;
  model: string;
  requestId: string;
  citations: SourceCitation[];
}
