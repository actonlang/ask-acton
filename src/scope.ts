import type { AskRequest } from "./types.js";

const strongActonSignals = [
  /\bacton\b/i,
  /\bactonc\b/i,
  /\bbuild\.act\b/i,
  /\bacton\.guide\b/i,
  /\bplay\.acton\.guide\b/i,
  /\bask acton\b/i,
  /\bactor\s+main\b/i,
  /\benv\.exit\b/i,
  /\bacton\s+build\b/i,
  /\bacton\s+run\b/i,
  /\b--sigs\b/i,
  /\b__builtin__\b/i,
  /\bforced unwrapp/i,
  /\boptional chaining\b/i
];

const languageSignals = [
  /\bactor\b/i,
  /\bactors\b/i,
  /\bprotocol\b/i,
  /\bextension\b/i,
  /\btype inference\b/i,
  /\bgeneric\b/i,
  /\bgenerics\b/i,
  /\bcompiler\b/i,
  /\bstdlib\b/i,
  /\bstandard library\b/i,
  /\bruntime\b/i,
  /\brts\b/i,
  /\bcapability\b/i,
  /\bcapabilities\b/i,
  /\bNone\b/,
  /\boptional\b/i,
  /\bmut\b/,
  /\bproc\b/,
  /\bafter\b/,
  /\bawait async\b/i
];

const programmingSignals = [
  /\bcode\b/i,
  /\bcompile\b/i,
  /\bcompiler\b/i,
  /\berror\b/i,
  /\bsyntax\b/i,
  /\btype\b/i,
  /\bfunction\b/i,
  /\bmethod\b/i,
  /\bmodule\b/i,
  /\bpackage\b/i,
  /\bimport\b/i,
  /\bdef\b/,
  /\bclass\b/i,
  /\bdict\b/i,
  /\blist\b/i
];

export function isActonRelated(request: AskRequest): boolean {
  const text = userControlledText(request);

  if (text.length === 0) {
    return false;
  }

  if (strongActonSignals.some((pattern) => pattern.test(text))) {
    return true;
  }

  return languageSignals.some((pattern) => pattern.test(text)) && programmingSignals.some((pattern) => pattern.test(text));
}

function userControlledText(request: AskRequest): string {
  return [request.question, request.code, request.error]
    .filter((part): part is string => typeof part === "string")
    .join("\n")
    .slice(0, 24000);
}
