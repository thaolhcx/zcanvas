import type { Asset, AssetKind } from "./types.ts";
import type { Job, Params, Recipe, RecipeEdge, RecipeNode } from "./types.ts";
/**
 * Studio: one generation page per kind. Each user has one hidden canvas per
 * kind holding a single generate node (`studio`) plus the input.asset nodes
 * and edges its references need, so the runner reads references one way only.
 */
export type StudioKind = "image" | "video" | "audio" | "text";
export const STUDIO_KINDS: StudioKind[] = ["image", "video", "audio", "text"];
export const STUDIO_NODE_TYPES: Record<StudioKind, string> = {
  image: "image.generate",
  video: "video.generate",
  audio: "audio.generate",
  text: "text.generate",
};
export const STUDIO_NODE_ID = "studio";
/** `GET /studio/:kind` */
export interface StudioCanvas {
  kind: StudioKind;
  canvasId: string;
  spaceId: string;
  nodeId: string;
  recipe: Recipe;
}
export interface HistoryRef {
  assetId: string;
  /** Role (target port) the file filled. */
  role: string;
  name: string;
  kind: AssetKind;
  url?: string;
  thumbUrl?: string;
  /** False once the file was deleted (Re-edit then leaves it out). */
  available: boolean;
}
/** One run of a node: `GET /canvases/:id/nodes/:nodeId/history` */
export interface HistoryEntry {
  jobId: string;
  runId: string;
  nodeId: string;
  itemIndex?: number;
  status: Job["status"];
  createdAt: string;
  /** Replaced by a retry: kept as history, no longer the node's result. */
  replaced: boolean;
  model?: string;
  /** Waiting for a slot: position in that model's line. */
  queuePosition?: number;
  /** Expected finish (ISO) while running. */
  eta?: string;
  /** What the user typed, and what was sent after Auto prompt. */
  intent?: string;
  finalPrompt?: string;
  error?: { code: string; message: string };
  /** The node as it ran (params with @ tokens): Re-edit and Regenerate start from it. */
  node: RecipeNode;
  /** The input.asset nodes and edges that fed it. */
  inputs: { node: RecipeNode; edge: RecipeEdge }[];
  refs: HistoryRef[];
  /** Media results that still exist. */
  outputs: Asset[];
  /** Text results (text.generate). */
  text?: string;
  params: Params;
}
export interface HistoryResponse {
  items: HistoryEntry[];
  /** Pass as `before` for older entries. */
  nextBefore: string | null;
}
/** One result in the History dock (media only): `GET /history` */
export interface MediaHistoryItem {
  asset: Asset;
  canvasId?: string;
  nodeId?: string;
  jobId?: string;
  /** Set when it was made in a Studio page. */
  studio?: StudioKind;
}
export interface MediaHistoryResponse {
  items: MediaHistoryItem[];
  nextBefore: string | null;
}
