import { parsePrompt, refToken } from "../../../contracts/index.ts";
/**
 * The Composer shows "@Logo"; the recipe stores "@[Logo](asset:ast_123)".
 * Labels are display only and unique among the node's references, so the
 * conversion is exact; a token whose file was removed reads as "@Label".
 */
export interface MentionRef {
  assetId: string;
  label: string;
}
export function toDisplay(stored: string, refs: MentionRef[]) {
  return parsePrompt(stored)
    .map((p) => {
      if (p.type === "text") return p.text;
      const ref = p.scheme === "asset" ? refs.find((r) => r.assetId === p.id) : undefined;
      return `@${ref?.label ?? p.label}`;
    })
    .join("");
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function toStored(display: string, refs: MentionRef[]) {
  if (!refs.length) return display;
  const sorted = [...refs].sort((a, b) => b.label.length - a.label.length);
  const re = new RegExp(`@(${sorted.map((r) => escape(r.label)).join("|")})(?![\\w-])`, "g");
  return display.replace(re, (_, label: string) => {
    const ref = sorted.find((r) => r.label === label)!;
    return refToken({ scheme: "asset", id: ref.assetId, label: ref.label });
  });
}
/** Unique labels: a file name without its extension, "2", "3"… for repeats. */
export function uniqueLabels<T extends { name: string }>(items: T[]): (T & { label: string })[] {
  const used = new Map<string, number>();
  return items.map((item) => {
    const base = item.name.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[[\]\n@]/g, " ").trim() || "file";
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return { ...item, label: n === 1 ? base : `${base} ${n}` };
  });
}
