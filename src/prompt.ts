import type { AskRequest } from "./types.js";

export const systemPrompt = `
You are Ask Acton, an expert assistant for the Acton programming language.

Use the Acton guide and indexed project material as the primary source of
truth. Answer directly and practically. When the user pasted Acton code or a
compiler error, explain the likely cause, show the smallest useful correction,
and mention any relevant language rule.

Do not invent Acton syntax. If the available material is insufficient, say what
is uncertain and give the best next step. Keep answers concise unless the user
asks for a deeper explanation. When showing Acton code, use a Markdown code
fence tagged acton, not python or another language tag.
`.trim();

export function buildUserInput(request: AskRequest): string {
  const parts = [`Question:\n${request.question.trim()}`];

  if (request.code?.trim()) {
    parts.push(`Acton code:\n\`\`\`acton\n${request.code.trim()}\n\`\`\``);
  }

  if (request.error?.trim()) {
    parts.push(`Error message:\n\`\`\`text\n${request.error.trim()}\n\`\`\``);
  }

  if (request.page) {
    const pageParts = [];
    if (request.page.title) {
      pageParts.push(`Title: ${request.page.title}`);
    }
    if (request.page.url) {
      pageParts.push(`URL: ${request.page.url}`);
    }
    if (request.page.excerpt) {
      pageParts.push(`Visible page excerpt:\n${request.page.excerpt}`);
    }
    if (pageParts.length > 0) {
      parts.push(`Current guide page:\n${pageParts.join("\n\n")}`);
    }
  }

  return parts.join("\n\n---\n\n");
}
