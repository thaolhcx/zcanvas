import sharp from "sharp";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type {
  Asset,
  AssetDeleteResponse,
  AssetKind,
  AssetListQuery,
  AssetListResponse,
  AssetPatch,
  AssetSource,
  AssetUsageResponse,
  GenerationInfo,
  Recipe,
} from "../../contracts/index.ts";
import { capabilities, db } from "./db.ts";
import { config } from "./config.ts";
import { boss } from "./queue.ts";
import { StorageError, newKey, storeFor, writeStore } from "./storage.ts";
import {
  ApiProblem,
  type Access,
  type Actor,
  notFound,
  personalSpaceId,
  readableSpaceIds,
  requireCanvas,
  requireSpace,
} from "./access.ts";
const exec = promisify(execFile);
const KINDS = ["image", "video", "audio"] as const;
const MIME = /^(image|video|audio)\/[a-z0-9][a-z0-9.+-]{0,60}$/;
const COLUMNS = `id, space_id, creator_id, source_type, source_canvas_id, source_run_id, source_node_id,
  name, kind, mime, bytes, meta, status, preview_status, description, tags, generation, revision,
  created_at, updated_at, deleted_at`;
type Row = Record<string, any>;
const iso = (value: Date | string | null) =>
  value ? new Date(value).toISOString() : undefined;
export function toAsset(row: Row): Asset {
  const source: AssetSource = {
    type: row.source_type ?? "upload",
    ...(row.source_canvas_id ? { canvasId: row.source_canvas_id } : {}),
    ...(row.source_run_id ? { runId: row.source_run_id } : {}),
    ...(row.source_node_id ? { nodeId: row.source_node_id } : {}),
  };
  const asset: Asset = {
    id: row.id,
    kind: row.kind,
    mime: row.mime,
    bytes: Number(row.bytes ?? 0),
    url: `${config.publicUrl}/assets/${row.id}/file`,
    ...(row.kind !== "audio" && row.preview_status !== "none"
      ? { thumbUrl: `${config.publicUrl}/assets/${row.id}/thumbnail` }
      : {}),
    meta: row.meta ?? {},
    ...(row.source_run_id && row.source_node_id
      ? { createdBy: { runId: row.source_run_id, nodeId: row.source_node_id } }
      : {}),
    createdAt: iso(row.created_at)!,
    ...(row.name ? { name: row.name } : {}),
    ...(row.space_id ? { spaceId: row.space_id } : {}),
    ...(row.creator_id ? { creatorId: row.creator_id } : {}),
    source,
    status: row.status,
    previewStatus: row.preview_status,
    ...(row.description ? { description: row.description } : {}),
    ...(row.tags?.length ? { tags: row.tags } : {}),
    ...(row.generation ? { generation: row.generation } : {}),
    updatedAt: iso(row.updated_at),
    ...(row.deleted_at ? { deletedAt: iso(row.deleted_at) } : {}),
  };
  return asset;
}
async function row(id: string): Promise<Row | undefined> {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM assets WHERE id=$1 AND catalog_version=1`,
    [id],
  );
  return rows[0];
}
/** Unscoped lookup for server internals only. Never return this to a client without a check. */
export async function getAsset(id: string): Promise<Asset> {
  const found = await row(id);
  if (!found) throw new Error(`Asset ${id} not found`);
  return toAsset(found);
}
export async function assetRow(id: string) {
  return row(id);
}
/**
 * Scoped lookup for API callers. Unknown, unmapped and other-space assets
 * are indistinguishable (404). A deleted asset the caller can see is 410.
 */
export async function getAssetFor(
  actor: Actor,
  id: string,
  access: Access = "read",
  options: { allowDeleted?: boolean } = {},
) {
  const found = await row(id);
  if (!found) throw notFound("Asset not found");
  await requireSpace(actor, found.space_id, access, "Asset not found");
  if (found.status === "deleted" && !options.allowDeleted)
    throw new ApiProblem(410, "ASSET_DELETED", "This asset was deleted", {
      asset: {
        id: found.id,
        ...(found.name ? { name: found.name } : {}),
        kind: found.kind,
        status: "deleted",
        deletedAt: iso(found.deleted_at),
      },
    });
  if (found.status === "uploading" || found.status === "failed")
    throw notFound("Asset not found");
  return found;
}
export class AssetUnavailable extends Error {}
/** Run path: the asset must be ready and owned by the run's space. */
export async function getAssetInSpace(id: string, spaceId: string) {
  const found = await row(id);
  if (!found || found.space_id !== spaceId)
    throw new AssetUnavailable(`Asset ${id} is not available in this space`);
  if (found.status === "deleted")
    throw new AssetUnavailable(`Asset ${found.name ?? id} was deleted`);
  if (found.status !== "ready")
    throw new AssetUnavailable(`Asset ${found.name ?? id} is not ready`);
  return toAsset(found);
}
/** IDs in `ids` that are not ready in `spaceId` (deleted, missing, other space). */
export async function unavailableAssets(ids: string[], spaceId: string) {
  if (!ids.length) return [];
  const { rows } = await db.query(
    "SELECT id FROM assets WHERE id = ANY($1) AND space_id=$2 AND status IN ('ready','processing') AND catalog_version=1",
    [ids, spaceId],
  );
  const ok = new Set(rows.map((r) => r.id));
  return ids.filter((id) => !ok.has(id));
}
export async function objectFor(assetId: string, role: string) {
  const { rows } = await db.query(
    "SELECT profile, key, bytes, mime, sha256, state FROM asset_objects WHERE asset_id=$1 AND role=$2",
    [assetId, role],
  );
  return rows[0] as
    | {
        profile: string;
        key: string;
        bytes: string | null;
        mime: string | null;
        sha256: string | null;
        state: string;
      }
    | undefined;
}
/** Streams an original into a local file (for ffmpeg) with bounded memory. */
export async function copyAssetToFile(id: string, path: string) {
  const object = await objectFor(id, "original");
  if (!object || object.state !== "stored")
    throw new Error(`Asset ${id} has no stored file`);
  await pipeline(
    await storeFor(object.profile).read(object.key),
    createWriteStream(path),
  );
}
export async function assetBytes(id: string) {
  const object = await objectFor(id, "original");
  if (!object) throw new Error(`Asset ${id} has no stored file`);
  const chunks: Buffer[] = [];
  for await (const chunk of await storeFor(object.profile).read(object.key))
    chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
// ---------------------------------------------------------------- ingest
export interface Spooled {
  dir: string;
  path: string;
  bytes: number;
  sha256: string;
  truncated?: boolean;
}
/** Writes a stream to a private temp file, hashing it and enforcing the size limit. */
export async function spool(
  source: Readable,
  maxBytes = config.storage.maxUploadBytes,
): Promise<Spooled> {
  const dir = await mkdtemp(join(config.storage.tmpDir ?? tmpdir(), "zcanvas-upload-"));
  const path = join(dir, "data");
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    await pipeline(
      source,
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          bytes += chunk.length;
          if (bytes > maxBytes)
            return done(
              new ApiProblem(413, "TOO_LARGE", `Files are limited to ${Math.floor(maxBytes / 1024 / 1024)} MB`),
            );
          hash.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(path, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return { dir, path, bytes, sha256: hash.digest("hex") };
}
export interface NewAsset {
  spaceId: string;
  creatorId: string | null;
  name: string;
  mime: string;
  kind?: AssetKind;
  meta?: Record<string, unknown>;
  source: AssetSource & { jobId?: string };
  generation?: GenerationInfo;
  /** generated outputs wait in "processing" until their job publishes them. */
  publish: "ready" | "processing";
}
export function cleanName(value: unknown, fallback: string) {
  const name =
    typeof value === "string"
      ? value
          .normalize("NFC")
          .replace(/[\u0000-\u001f\u007f/\\]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200)
      : "";
  return name || fallback;
}
/** Step 1: record the intent so an interrupted upload is visible and cleanable. */
export async function beginAsset(input: NewAsset) {
  const id = `ast_${crypto.randomUUID()}`;
  const kind = input.kind ?? (input.mime.split("/")[0] as AssetKind);
  if (!KINDS.includes(kind as AssetKind) || !MIME.test(input.mime))
    throw new ApiProblem(415, "UNSUPPORTED_MEDIA", "Choose an image, video or audio");
  const store = writeStore();
  await db.query(
    `INSERT INTO assets(id, catalog_version, space_id, creator_id, source_type, source_canvas_id, source_run_id, source_node_id, source_job_id,
       name, kind, mime, bytes, meta, status, preview_status, generation)
     VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,'uploading',$13,$14)`,
    [
      id,
      input.spaceId,
      input.creatorId,
      input.source.type,
      input.source.canvasId ?? null,
      input.source.runId ?? null,
      input.source.nodeId ?? null,
      input.source.jobId ?? null,
      input.name,
      kind,
      input.mime,
      input.meta ?? {},
      kind === "audio" ? "none" : "pending",
      input.generation ?? null,
    ],
  );
  await db.query(
    "INSERT INTO asset_objects(asset_id,role,profile,key,mime) VALUES($1,'original',$2,$3,$4)",
    [id, store.profile, newKey(), input.mime],
  );
  return { id, kind };
}
async function probe(path: string, kind: AssetKind, mime: string) {
  if (kind === "image") {
    const info = await sharp(path).metadata();
    if (!info.format) throw new Error("Unreadable image");
    const mapped: Record<string, string> = {
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      avif: "image/avif",
      tiff: "image/tiff",
      svg: "image/svg+xml",
      heif: "image/heif",
    };
    if (info.format === "svg") throw new Error("SVG images are not supported");
    return {
      mime: mapped[info.format] ?? mime,
      meta: { width: info.width, height: info.height },
    };
  }
  const result = await exec("ffprobe", [
    "-v",
    "error",
    "-protocol_whitelist",
    "file,pipe",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    path,
  ]);
  const info = JSON.parse(result.stdout);
  const streams: { codec_type: string; width?: number; height?: number }[] =
    info.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  if (kind === "video" ? !video : !audio)
    throw new Error(`No ${kind} stream found`);
  return {
    mime,
    meta: {
      durationSec: Number(info.format?.duration),
      ...(video ? { width: video.width, height: video.height } : {}),
    },
  };
}
/** Step 2: validate, store, then mark ready/processing. Fails the asset on any error. */
export async function finishAsset(
  id: string,
  spooled: Spooled,
  publish: "ready" | "processing",
) {
  try {
    const current = await row(id);
    if (!current || current.status !== "uploading")
      throw new Error("Upload was cancelled");
    let probed;
    try {
      probed = await probe(spooled.path, current.kind, current.mime);
    } catch (error) {
      throw new ApiProblem(
        400,
        "UNSUPPORTED_MEDIA",
        error instanceof Error ? `Unreadable media: ${error.message}` : "Unreadable media",
      );
    }
    const object = (await objectFor(id, "original"))!;
    await storeFor(object.profile).put(object.key, createReadStream(spooled.path), {
      bytes: spooled.bytes,
      contentType: probed.mime,
    });
    await db.query(
      "UPDATE asset_objects SET state='stored', bytes=$2, sha256=$3, mime=$4 WHERE asset_id=$1 AND role='original'",
      [id, spooled.bytes, spooled.sha256, probed.mime],
    );
    const { rows } = await db.query(
      `UPDATE assets SET status=$2, bytes=$3, mime=$4, meta=meta || $5::jsonb, updated_at=now()
       WHERE id=$1 AND status='uploading' RETURNING ${COLUMNS}`,
      [id, publish, spooled.bytes, probed.mime, probed.meta],
    );
    if (!rows.length) throw new Error("Upload was cancelled");
    if (rows[0].preview_status === "pending")
      await boss.send("asset-derive", { assetId: id });
    if (publish === "ready") await afterReady([id]);
    return toAsset(rows[0]);
  } catch (error) {
    await failAsset(id, error);
    throw error;
  } finally {
    await rm(spooled.dir, { recursive: true, force: true });
  }
}
export async function failAsset(id: string, reason?: unknown) {
  await db.query(
    "UPDATE assets SET status='failed', meta=meta || $2::jsonb, updated_at=now() WHERE id=$1 AND status IN ('uploading','processing')",
    [
      id,
      {
        failure:
          reason instanceof Error ? reason.message.slice(0, 300) : "Write failed",
      },
    ],
  );
  await scheduleCleanup(id, 0).catch(() => {});
}
/** Convenience for internal producers (workers, debug fixtures). */
export async function putAsset(
  file: Blob | ReadableStream,
  input: Omit<NewAsset, "mime"> & { mime?: string },
): Promise<Asset> {
  const mime =
    input.mime ?? (file instanceof Blob ? file.type : "application/octet-stream");
  const { id } = await beginAsset({ ...input, mime });
  let spooled: Spooled;
  try {
    const stream = file instanceof Blob ? file.stream() : file;
    spooled = await spool(Readable.fromWeb(stream as any));
  } catch (error) {
    await failAsset(id, error);
    throw error;
  }
  return finishAsset(id, spooled, input.publish);
}
/** A job finished and its run is still current: its outputs become visible. */
export async function publishJobAssets(jobId: string) {
  const { rows } = await db.query(
    "UPDATE assets SET status='ready', updated_at=now() WHERE source_job_id=$1 AND status='processing' RETURNING id",
    [jobId],
  );
  await afterReady(rows.map((r) => r.id));
}
/** A job failed, was cancelled or superseded: its partial outputs never become ready. */
export async function failJobAssets(jobId: string, reason = "Job did not finish") {
  const { rows } = await db.query(
    "SELECT id FROM assets WHERE source_job_id=$1 AND status IN ('uploading','processing')",
    [jobId],
  );
  for (const r of rows) await failAsset(r.id, new Error(reason));
}
type ReadyHook = (ids: string[]) => Promise<void>;
const readyHooks: ReadyHook[] = [];
export const onAssetsChanged = (hook: ReadyHook) => readyHooks.push(hook);
async function afterReady(ids: string[]) {
  if (!ids.length) return;
  for (const hook of readyHooks)
    await hook(ids).catch((error) => console.error("Asset hook:", error));
}
// ---------------------------------------------------------------- catalog API
const LIMIT_MAX = 100;
function encodeCursor(values: unknown[]) {
  return Buffer.from(JSON.stringify(values)).toString("base64url");
}
function decodeCursor(cursor: string, length: number) {
  try {
    const values = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (
      Array.isArray(values) &&
      values.length === length &&
      values.every((v) => typeof v === "string")
    )
      return values as string[];
  } catch {}
  throw new ApiProblem(400, "VALIDATION", "Invalid cursor");
}
export function parseListQuery(query: Record<string, unknown>): AssetListQuery {
  const out: AssetListQuery = {};
  const bad = (message: string) => new ApiProblem(400, "VALIDATION", message);
  if (query.spaceId !== undefined) {
    if (typeof query.spaceId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(query.spaceId))
      throw bad("Invalid spaceId");
    out.spaceId = query.spaceId;
  }
  if (query.q !== undefined) {
    if (typeof query.q !== "string" || query.q.length > 200)
      throw bad("q must be at most 200 characters");
    if (query.q.trim()) out.q = query.q.trim();
  }
  if (query.kind !== undefined) {
    if (!KINDS.includes(query.kind as AssetKind)) throw bad("kind must be image, video or audio");
    out.kind = query.kind as AssetKind;
  }
  if (query.source !== undefined) {
    if (query.source !== "upload" && query.source !== "generated")
      throw bad("source must be upload or generated");
    out.source = query.source;
  }
  if (query.sort !== undefined) {
    if (!["created_desc", "created_asc", "name_asc"].includes(String(query.sort)))
      throw bad("sort must be created_desc, created_asc or name_asc");
    out.sort = query.sort as AssetListQuery["sort"];
  }
  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX)
      throw bad(`limit must be an integer from 1 to ${LIMIT_MAX}`);
    out.limit = limit;
  }
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== "string" || query.cursor.length > 500)
      throw bad("Invalid cursor");
    out.cursor = query.cursor;
  }
  return out;
}
/** Escapes LIKE wildcards so a typed % or _ matches literally. */
export const likePattern = (q: string) =>
  `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
export async function listAssets(
  actor: Actor,
  query: AssetListQuery,
): Promise<AssetListResponse> {
  const spaceId = query.spaceId ?? personalSpaceId(actor.id);
  await requireSpace(actor, spaceId, "read", "Space not found");
  const limit = query.limit ?? 50;
  const sort = query.sort ?? "created_desc";
  const params: unknown[] = [spaceId];
  const where = ["space_id=$1", "status='ready'", "catalog_version=1"];
  const add = (sql: (n: string) => string, value: unknown) => {
    params.push(value);
    where.push(sql(`$${params.length}`));
  };
  if (query.kind) add((n) => `kind=${n}`, query.kind);
  if (query.source) add((n) => `source_type=${n}`, query.source);
  if (query.q) add((n) => `lower(name) LIKE ${n}`, likePattern(query.q));
  // Stable keyset pagination: the ID breaks ties between equal sort values.
  const order =
    sort === "name_asc"
      ? { sql: "lower(name) ASC, id ASC", cursor: (r: Row) => [String(r.name).toLowerCase(), r.id], cmp: ">", expr: "(lower(name), id)" }
      : sort === "created_asc"
        ? { sql: "created_at ASC, id ASC", cursor: (r: Row) => [r.created_at_text, r.id], cmp: ">", expr: "(created_at, id)" }
        : { sql: "created_at DESC, id DESC", cursor: (r: Row) => [r.created_at_text, r.id], cmp: "<", expr: "(created_at, id)" };
  if (query.cursor) {
    const [value, id] = decodeCursor(query.cursor, 2);
    params.push(value, id);
    const a = `$${params.length - 1}`,
      b = `$${params.length}`;
    where.push(
      sort === "name_asc"
        ? `${order.expr} ${order.cmp} (${a}::text, ${b}::text)`
        : `${order.expr} ${order.cmp} (${a}::timestamptz, ${b}::text)`,
    );
  }
  params.push(limit + 1);
  const { rows } = await db.query(
    // created_at is sent as text with microseconds so cursors never lose precision.
    `SELECT ${COLUMNS}, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_text
     FROM assets WHERE ${where.join(" AND ")} ORDER BY ${order.sql} LIMIT $${params.length}`,
    params,
  );
  const page = rows.slice(0, limit);
  return {
    spaceId,
    items: page.map(toAsset),
    nextCursor:
      rows.length > limit ? encodeCursor(order.cursor(page[page.length - 1])) : null,
  };
}
export function parsePatch(body: unknown): AssetPatch {
  const bad = (message: string) => new ApiProblem(400, "VALIDATION", message);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("Send a JSON object");
  const input = body as Record<string, unknown>;
  const unknown = Object.keys(input).filter((k) => !["name", "description", "tags"].includes(k));
  if (unknown.length) throw bad(`Unknown fields: ${unknown.join(", ")}`);
  const patch: AssetPatch = {};
  if (input.name !== undefined) {
    const name = cleanName(input.name, "");
    if (!name) throw bad("name must be 1–200 visible characters");
    patch.name = name;
  }
  if (input.description !== undefined) {
    if (input.description !== null && (typeof input.description !== "string" || input.description.length > 2000))
      throw bad("description must be at most 2000 characters");
    patch.description = input.description === null ? null : String(input.description).trim() || null;
  }
  if (input.tags !== undefined) {
    if (
      !Array.isArray(input.tags) ||
      input.tags.length > 20 ||
      input.tags.some((t) => typeof t !== "string" || !t.trim() || t.length > 40)
    )
      throw bad("tags must be up to 20 strings of 1–40 characters");
    patch.tags = [...new Set(input.tags.map((t: string) => t.trim()))];
  }
  if (!Object.keys(patch).length) throw bad("Nothing to change");
  return patch;
}
/** Renames never touch storage or recipes: canvases reference the stable ID. */
export async function patchAsset(actor: Actor, id: string, patch: AssetPatch) {
  await getAssetFor(actor, id, "write");
  const { rows } = await db.query(
    `UPDATE assets SET
       name=COALESCE($2,name),
       description=CASE WHEN $3::boolean THEN $4 ELSE description END,
       tags=COALESCE($5,tags),
       revision=revision+1, updated_at=now()
     WHERE id=$1 AND status='ready' RETURNING ${COLUMNS}`,
    [id, patch.name ?? null, patch.description !== undefined, patch.description ?? null, patch.tags ?? null],
  );
  if (!rows.length) throw new ApiProblem(409, "CONFLICT", "Asset changed; reload and try again");
  await afterReady([id]);
  return toAsset(rows[0]);
}
export function usageIn(recipe: Recipe | null | undefined, assetId: string) {
  const nodes: AssetUsageResponse["nodes"] = [];
  for (const node of recipe?.nodes ?? [])
    for (const [paramKey, value] of Object.entries(node.params ?? {}))
      if (value === assetId)
        nodes.push({
          nodeId: node.id,
          type: node.type,
          ...(node.label ? { label: node.label } : {}),
          paramKey,
        });
  return nodes;
}
export async function assetUsage(
  actor: Actor,
  id: string,
  canvasId: string,
): Promise<AssetUsageResponse> {
  const asset = await getAssetFor(actor, id, "read", { allowDeleted: true });
  const spaceId = await requireCanvas(actor, canvasId, "read");
  if (spaceId !== asset.space_id) return { assetId: id, canvasId, nodes: [] };
  const { rows } = await db.query("SELECT snapshot FROM canvases WHERE id=$1", [canvasId]);
  return { assetId: id, canvasId, nodes: usageIn(rows[0]?.snapshot, id) };
}
export async function deleteAsset(
  actor: Actor,
  id: string,
  canvasId?: string,
): Promise<AssetDeleteResponse> {
  await getAssetFor(actor, id, "write");
  const affected = canvasId ? await assetUsage(actor, id, canvasId) : null;
  const client = await db.connect();
  let deletedAt: string;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "UPDATE assets SET status='deleted', deleted_at=now(), revision=revision+1, updated_at=now() WHERE id=$1 AND status='ready' RETURNING deleted_at",
      [id],
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      throw new ApiProblem(409, "CONFLICT", "Asset is no longer available");
    }
    deletedAt = new Date(rows[0].deleted_at).toISOString();
    // Out of search immediately, in the same transaction as the state change.
    if (capabilities.vector)
      await client.query("DELETE FROM asset_search_index WHERE asset_id=$1", [id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await scheduleCleanup(id, config.storage.cleanupDelaySec);
  return { assetId: id, status: "deleted", deletedAt, affected };
}
// ---------------------------------------------------------------- background jobs
export async function scheduleCleanup(assetId: string, delaySec: number) {
  await boss.send(
    "asset-cleanup",
    { assetId },
    delaySec > 0 ? { startAfter: delaySec } : {},
  );
}
/** Builds a 300 px preview. Retry-safe: a finished preview is not rebuilt. */
export async function deriveAsset(assetId: string, finalAttempt = true) {
  const current = await row(assetId);
  if (
    !current ||
    !["ready", "processing"].includes(current.status) ||
    current.preview_status !== "pending"
  )
    return;
  const dir = await mkdtemp(join(config.storage.tmpDir ?? tmpdir(), "zcanvas-derive-"));
  try {
    const source = join(dir, "source");
    await copyAssetToFile(assetId, source);
    let thumb: Buffer;
    if (current.kind === "image")
      thumb = await sharp(source)
        .resize({ width: 300, height: 300, fit: "inside", withoutEnlargement: true })
        .jpeg()
        .toBuffer();
    else {
      await exec("ffmpeg", [
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        source,
        "-frames:v",
        "1",
        "-vf",
        "scale=300:-1",
        join(dir, "poster.jpg"),
      ]);
      thumb = await readFile(join(dir, "poster.jpg"));
    }
    const store = writeStore();
    const previous = await objectFor(assetId, "thumbnail");
    const key = newKey("thumb");
    await db.query(
      `INSERT INTO asset_objects(asset_id,role,profile,key,mime,state) VALUES($1,'thumbnail',$2,$3,'image/jpeg','pending')
       ON CONFLICT (asset_id,role) DO UPDATE SET profile=EXCLUDED.profile, key=EXCLUDED.key, state='pending'`,
      [assetId, store.profile, key],
    );
    if (previous && previous.key !== key)
      await storeFor(previous.profile).delete(previous.key).catch(() => {});
    await store.put(key, Readable.from(thumb), { bytes: thumb.length, contentType: "image/jpeg" });
    await db.query(
      "UPDATE asset_objects SET state='stored', bytes=$2, sha256=$3 WHERE asset_id=$1 AND role='thumbnail' AND key=$4",
      [assetId, thumb.length, createHash("sha256").update(thumb).digest("hex"), key],
    );
    await db.query(
      "UPDATE assets SET preview_status='ready' WHERE id=$1 AND preview_status='pending'",
      [assetId],
    );
  } catch (error) {
    if (finalAttempt)
      await db.query(
        "UPDATE assets SET preview_status='failed', meta=meta || $2::jsonb WHERE id=$1 AND preview_status='pending'",
        [assetId, { previewError: error instanceof Error ? error.message.slice(0, 300) : "Preview failed" }],
      );
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
/**
 * Removes stored bytes of a deleted or failed asset. Deleted assets wait for
 * the grace period and for running runs in their space that reference them.
 * The catalog row stays as history (status, name, source, timestamps).
 */
export async function cleanupAsset(assetId: string): Promise<"purged" | "deferred" | "skipped"> {
  const { rows } = await db.query(
    `SELECT id, status, space_id, purged_at,
       deleted_at > now() - make_interval(secs => $2) AS in_grace
     FROM assets WHERE id=$1`,
    [assetId, config.storage.cleanupDelaySec],
  );
  const current = rows[0];
  if (!current || current.purged_at || !["deleted", "failed"].includes(current.status))
    return "skipped";
  if (current.status === "deleted") {
    const busy = await db.query(
      "SELECT 1 FROM runs WHERE space_id=$1 AND data->>'status'='running' AND position($2 in recipe::text) > 0 LIMIT 1",
      [current.space_id, assetId],
    );
    if (current.in_grace || busy.rowCount) {
      await scheduleCleanup(assetId, current.in_grace ? config.storage.cleanupDelaySec : 60);
      return "deferred";
    }
  }
  const objects = await db.query(
    "SELECT role, profile, key FROM asset_objects WHERE asset_id=$1 AND state<>'deleted'",
    [assetId],
  );
  for (const object of objects.rows) {
    try {
      await storeFor(object.profile).delete(object.key);
    } catch (error) {
      if (!(error instanceof StorageError && error.code === "NOT_FOUND")) throw error;
    }
    await db.query(
      "UPDATE asset_objects SET state='deleted' WHERE asset_id=$1 AND role=$2",
      [assetId, object.role],
    );
  }
  if (capabilities.vector)
    await db.query("DELETE FROM asset_search_index WHERE asset_id=$1", [assetId]);
  await db.query("UPDATE assets SET purged_at=now() WHERE id=$1", [assetId]);
  return "purged";
}
/** Fails writes that never finished (crash, lost connection) so cleanup can run. */
export async function sweepStaleWrites() {
  const { rows } = await db.query(
    `SELECT a.id FROM assets a
     WHERE a.status IN ('uploading','processing') AND a.updated_at < now() - make_interval(secs => $1)
       AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.id=a.source_run_id AND r.data->>'status'='running')`,
    [config.storage.staleWriteSec],
  );
  for (const r of rows) await failAsset(r.id, new Error("Write did not finish"));
  return rows.length;
}
export async function startAssetWorkers() {
  await boss.work<{ assetId: string }>(
    "asset-derive",
    { batchSize: 2, pollingIntervalSeconds: 0.5, includeMetadata: true },
    async (jobs) => {
      for (const job of jobs)
        await deriveAsset(job.data.assetId, job.retryCount >= job.retryLimit);
    },
  );
  await boss.work<{ assetId: string }>(
    "asset-cleanup",
    { batchSize: 4, pollingIntervalSeconds: 2 },
    async (jobs) => {
      for (const job of jobs) await cleanupAsset(job.data.assetId);
    },
  );
}
