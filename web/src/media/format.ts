import { Film, Image as ImageIcon, Music2 } from "lucide-react";
import type { AssetKind } from "../../../contracts/index.ts";
export const kindIcon = (kind: AssetKind) =>
  kind === "video" ? Film : kind === "audio" ? Music2 : ImageIcon;
export const kindLabel = (kind: AssetKind) =>
  kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Image";
/** `0:06`, or `6 sec` in words. */
export function formatDuration(seconds: number, words = false) {
  const total = Math.round(seconds);
  if (words && total < 60) return `${total} sec`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function formatDate(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
