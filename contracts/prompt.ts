/**
 * Prompt references. A prompt is a plain string in which `@` tokens link to an
 * asset or a node **by id**; the label is only for display, so renaming a file
 * or a node never breaks the link:
 *
 *   @[Logo](asset:ast_123)       an asset (always brought in by an input.asset node + edge)
 *   @[Key visual](node:n_abc)    a node connected to this one
 */
export type RefScheme = "asset" | "node";
export interface PromptRef {
  scheme: RefScheme;
  id: string;
  label: string;
}
export type PromptPart =
  | { type: "text"; text: string }
  | ({ type: "ref"; raw: string } & PromptRef);
const TOKEN = /@\[([^\]\n]{0,120})\]\((asset|node):([A-Za-z0-9_-]{1,100})\)/g;
/** Label text a token can carry: no brackets or line breaks, at most 80 characters. */
export const cleanLabel = (label: string) =>
  label.replace(/[[\]\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "input";
export const refKey = (ref: Pick<PromptRef, "scheme" | "id">) => `${ref.scheme}:${ref.id}`;
export function refToken(ref: PromptRef) {
  return `@[${cleanLabel(ref.label)}](${ref.scheme}:${ref.id})`;
}
export function parsePrompt(text: string): PromptPart[] {
  const parts: PromptPart[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) parts.push({ type: "text", text: text.slice(last, m.index) });
    parts.push({ type: "ref", raw: m[0], label: m[1], scheme: m[2] as RefScheme, id: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}
/** Each referenced asset or node once, in order of first mention. */
export function promptRefs(text: string): PromptRef[] {
  const seen = new Set<string>();
  const refs: PromptRef[] = [];
  for (const part of parsePrompt(text))
    if (part.type === "ref" && !seen.has(refKey(part))) {
      seen.add(refKey(part));
      refs.push({ scheme: part.scheme, id: part.id, label: part.label });
    }
  return refs;
}
/** The prompt with each token replaced: by `names[key]` when given, else "@label". */
export function renderPrompt(text: string, names: Record<string, string> = {}) {
  return parsePrompt(text)
    .map((p) => (p.type === "text" ? p.text : (names[refKey(p)] ?? `@${p.label}`)))
    .join("");
}
/** For search and history: tokens read as "@label". */
export const plainPrompt = (text: string) => renderPrompt(text);
