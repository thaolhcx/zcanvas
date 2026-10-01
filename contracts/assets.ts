import type { Asset, AssetKind } from "./types.ts";
/**
 * Asset catalog, space and search contracts shared by the server, the web app
 * and future agent/MCP clients. See docs/asset-platform.md for the rules.
 */
export type SpaceKind = "personal" | "team";
export type SpaceRole = "owner" | "editor" | "viewer";
export interface Project {
  id: string;
  spaceId: string;
  name: string;
}
export interface Space {
  id: string;
  kind: SpaceKind;
  name: string;
  /** The caller's role, resolved by the server from its configured identity. */
  role: SpaceRole;
  projects: Project[];
}
export interface SpacesResponse {
  /** The caller's personal space. */
  defaultSpaceId: string;
  spaces: Space[];
}
export type AssetSourceType = "upload" | "generated";
export interface AssetSource {
  type: AssetSourceType;
  canvasId?: string;
  runId?: string;
  nodeId?: string;
}
/**
 * uploading/processing: bytes are being written or a run has not published
 * the output yet. ready: usable. failed: never usable; cleanup is scheduled.
 * deleted: hidden from browsing, search and new use; history is kept.
 */
export type AssetStatus =
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | "deleted";
export type PreviewStatus = "none" | "pending" | "ready" | "failed";
/** Plain-text history captured from the run snapshot when the asset was made. */
export interface GenerationInfo {
  nodeType: string;
  typeVersion: number;
  prompt?: string;
  model?: string;
  settings?: Record<string, unknown>;
  /** Input file names as plain text at run time. Never re-resolved. */
  references?: string[];
}
export type AssetSort = "created_desc" | "created_asc" | "name_asc";
export interface AssetListQuery {
  spaceId?: string;
  /** Case-insensitive file-name match. */
  q?: string;
  kind?: AssetKind;
  source?: AssetSourceType;
  sort?: AssetSort;
  /** Opaque value from a previous `nextCursor`. Only valid with the same filters and sort. */
  cursor?: string;
  /** 1–100, default 50. */
  limit?: number;
}
export interface AssetListResponse {
  spaceId: string;
  items: Asset[];
  nextCursor: string | null;
}
export interface AssetPatch {
  name?: string;
  description?: string | null;
  tags?: string[];
}
export interface AssetUsageNode {
  nodeId: string;
  type: string;
  label?: string;
  paramKey: string;
}
export interface AssetUsageResponse {
  assetId: string;
  canvasId: string;
  nodes: AssetUsageNode[];
}
export interface AssetDeleteResponse {
  assetId: string;
  status: "deleted";
  deletedAt: string;
  /** Nodes on `canvasId` (when given) that will now report INPUT_REQUIRED. */
  affected: AssetUsageResponse | null;
}
/** Minimal body of a 410 response for a deleted asset the caller may still see. */
export interface DeletedAssetTombstone {
  id: string;
  name?: string;
  kind: AssetKind;
  status: "deleted";
  deletedAt: string;
}
export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "ASSET_DELETED"
  | "UNSUPPORTED_MEDIA"
  | "TOO_LARGE"
  | "UPLOAD_INTERRUPTED"
  | "RANGE_NOT_SATISFIABLE"
  | "PREVIEW_PENDING"
  | "PREVIEW_FAILED"
  | "STORAGE_UNAVAILABLE"
  | "CONFLICT";
/** `error` stays a readable string so existing clients keep working. */
export interface ApiError {
  error: string;
  code: ApiErrorCode;
  details?: Record<string, unknown>;
}
export type SemanticState =
  | "ok"
  | "disabled"
  | "unavailable"
  | "timeout"
  | "indexing";
export interface AssetSearchQuery {
  q: string;
  spaceId?: string;
  kind?: AssetKind;
  source?: AssetSourceType;
  /** 1–50, default 20. */
  limit?: number;
}
export interface AssetSearchHit {
  asset: Asset;
  /** Fused rank score in (0, 1]; only comparable within one response. */
  score: number;
  matchedBy: ("name" | "semantic")[];
  /** Cosine similarity of the semantic match, when there was one. */
  semanticScore?: number;
}
export interface AssetSearchResponse {
  query: string;
  spaceId: string;
  limit: number;
  /** "name" when semantic search could not contribute; results are still usable. */
  mode: "hybrid" | "name";
  semantic: {
    state: SemanticState;
    model?: string;
    /** Ready assets in scope without a current index entry. */
    pending?: number;
    message?: string;
  };
  items: AssetSearchHit[];
}
