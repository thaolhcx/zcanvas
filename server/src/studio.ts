import type { FastifyInstance } from "fastify";
import {
  migrateRecipe,
  STUDIO_KINDS,
  STUDIO_NODE_ID,
  STUDIO_NODE_TYPES,
  validate,
  type Asset,
  type HistoryEntry,
  type HistoryResponse,
  type MediaHistoryItem,
  type MediaHistoryResponse,
  type Recipe,
  type StudioCanvas,
  type StudioKind,
} from "../../contracts/index.ts";
import { db } from "./db.ts";
import { registry } from "./registry.ts";
import { models } from "./catalog.ts";
import { ApiProblem, notFound, personalSpaceId, readableSpaceIds, requireCanvas, type Actor } from "./access.ts";
import { toAsset } from "./assets.ts";
import type { StoredRequest } from "./gen.ts";
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const check = (value: unknown, what: string) => {
  if (typeof value !== "string" || !ID.test(value)) throw new ApiProblem(400, "VALIDATION", `Invalid ${what}`);
  return value;
};
const kindOf = (value: unknown): StudioKind => {
  if (!STUDIO_KINDS.includes(value as StudioKind))
    throw new ApiProblem(404, "NOT_FOUND", "No such Studio page");
  return value as StudioKind;
};
/** Drafts may be incomplete; only structural problems are refused. */
const DRAFT_OK = new Set(["PARAM_REQUIRED", "INPUT_REQUIRED", "MODE", "MODEL", "REFERENCE"]);
const ASSET_COLUMNS = `id, space_id, creator_id, source_type, source_canvas_id, source_run_id, source_node_id,
  name, kind, mime, bytes, meta, status, preview_status, description, tags, generation, revision,
  created_at, updated_at, deleted_at, kept`;
function studioRecipe(id: string, kind: StudioKind): Recipe {
  const type = STUDIO_NODE_TYPES[kind];
  const entry = registry.get(type)!;
  return {
    schema: "recipe/v1",
    meta: { id, name: `Studio · ${kind}`, version: 0, registryVersion: "2026.09.1" },
    nodes: [{ id: STUDIO_NODE_ID, type, typeVersion: entry.version, position: { x: 0, y: 0 }, params: { model: "auto" } }],
    edges: [],
    groups: [],
  };
}
/** The user's hidden canvas for one Studio page, created on first use. */
export async function studioCanvas(actor: Actor, kind: StudioKind): Promise<StudioCanvas> {
  const spaceId = personalSpaceId(actor.id);
  const id = `cnv_studio_${kind}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  await db.query(
    `INSERT INTO canvases(id, name, snapshot, space_id, kind, studio_kind, owner_id)
     VALUES($1,$2,$3,$4,'studio',$5,$6) ON CONFLICT (owner_id, studio_kind) WHERE kind='studio' DO NOTHING`,
    [id, `Studio · ${kind}`, studioRecipe(id, kind), spaceId, kind, actor.id],
  );
  const { rows } = await db.query(
    "SELECT id, snapshot, space_id FROM canvases WHERE owner_id=$1 AND studio_kind=$2 AND kind='studio'",
    [actor.id, kind],
  );
  const recipe = migrateRecipe(rows[0].snapshot as Recipe);
  return { kind, canvasId: rows[0].id, spaceId: rows[0].space_id, nodeId: STUDIO_NODE_ID, recipe };
}
async function assetsById(ids: string[]) {
  if (!ids.length) return new Map<string, Asset>();
  const { rows } = await db.query(
    `SELECT ${ASSET_COLUMNS} FROM assets WHERE id = ANY($1) AND catalog_version=1`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id as string, toAsset(r)]));
}
const usable = (a?: Asset) => a && a.status === "ready";
type JobRecord = {
  id: string;
  run_id: string;
  node_id: string;
  data: HistoryEntry & { phase?: string; outputs?: Record<string, unknown> };
  request: StoredRequest | null;
  created_at: Date;
  replaced_at: Date | null;
  recipe: Recipe;
};
const assetIdsIn = (outputs: unknown) =>
  Object.values((outputs as Record<string, unknown>) ?? {})
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((v): v is { id: string } => Boolean(v && typeof v === "object" && "id" in v))
    .map((v) => v.id);
/** One node's runs across all runs of a canvas, newest first. */
export async function nodeHistory(canvasId: string, nodeId: string, before?: string, limit = 30): Promise<HistoryResponse> {
  const { rows } = await db.query<JobRecord>(
    `SELECT j.id, j.run_id, j.node_id, j.data, j.request, j.created_at, j.replaced_at, r.recipe
     FROM jobs j JOIN runs r ON r.id=j.run_id
     WHERE r.canvas_id=$1 AND j.node_id=$2 AND NOT j.hidden AND j.request IS NOT NULL
       AND ($3::timestamptz IS NULL OR j.created_at < $3)
     ORDER BY j.created_at DESC, j.id DESC LIMIT $4`,
    [canvasId, nodeId, before ?? null, limit + 1],
  );
  const page = rows.slice(0, limit);
  const ids = page.flatMap((r) => [...assetIdsIn(r.data.outputs), ...(r.request?.refs ?? []).map((x) => x.assetId)]);
  const assets = await assetsById([...new Set(ids)]);
  const items: HistoryEntry[] = page.map((r) => {
    const node = r.recipe.nodes.find((n) => n.id === nodeId)!;
    const nodes = new Map(r.recipe.nodes.map((n) => [n.id, n]));
    const inputs = r.recipe.edges
      .filter((e) => e.target === nodeId && nodes.get(e.source)?.type === "input.asset")
      .map((edge) => ({ node: nodes.get(edge.source)!, edge }));
    const done = r.data.status === "done";
    const outputs = done ? assetIdsIn(r.data.outputs).map((id) => assets.get(id)).filter(usable) as Asset[] : [];
    const text = done
      ? Object.values(r.data.outputs ?? {}).map((v) => (v && typeof v === "object" && "value" in v ? String((v as { value: unknown }).value) : undefined)).find(Boolean)
      : undefined;
    const d = r.data;
    return {
      jobId: r.id,
      runId: r.run_id,
      nodeId,
      ...(d.itemIndex !== undefined ? { itemIndex: d.itemIndex } : {}),
      status: d.status,
      createdAt: new Date(r.created_at).toISOString(),
      replaced: Boolean(r.replaced_at),
      ...(d.model ? { model: d.model } : {}),
      ...(d.queuePosition ? { queuePosition: d.queuePosition } : {}),
      ...(d.eta && !done ? { eta: d.eta } : {}),
      ...(d.stage && (d.status === "queued" || d.status === "running") ? { stage: d.stage } : {}),
      ...(d.intent ?? r.request?.intent ? { intent: d.intent ?? r.request?.intent } : {}),
      ...(d.finalPrompt !== undefined ? { finalPrompt: d.finalPrompt } : {}),
      ...(d.error ? { error: d.error } : {}),
      node: node ?? { id: nodeId, type: r.request?.nodeType ?? "", typeVersion: 1, position: { x: 0, y: 0 }, params: {} },
      inputs,
      refs: (r.request?.refs ?? []).map((ref) => {
        const a = assets.get(ref.assetId);
        return {
          assetId: ref.assetId,
          role: ref.role,
          name: a?.name ?? ref.name,
          kind: ref.kind,
          ...(a && usable(a) ? { url: a.url, ...(a.thumbUrl ? { thumbUrl: a.thumbUrl } : {}) } : {}),
          available: Boolean(usable(a)),
        };
      }),
      outputs,
      ...(text ? { text } : {}),
      params: node?.params ?? {},
    };
  });
  return { items, nextBefore: rows.length > limit ? new Date(page[page.length - 1].created_at).toISOString() : null };
}
export function registerStudioRoutes(app: FastifyInstance, actor: Actor) {
  app.get<{ Params: { kind: string } }>("/studio/:kind", async (request) =>
    studioCanvas(actor, kindOf(request.params.kind)),
  );
  /** Saves the page's draft (prompt, model, params, references) so it survives a reload. */
  app.put<{ Params: { kind: string }; Body: { recipe: Recipe } }>("/studio/:kind", async (request) => {
    const studio = await studioCanvas(actor, kindOf(request.params.kind));
    const recipe = migrateRecipe(request.body?.recipe);
    if (!recipe || recipe.meta?.id !== studio.canvasId)
      throw new ApiProblem(400, "VALIDATION", "This recipe is not the Studio canvas");
    const issues = validate(recipe, registry, models).filter((i) => !DRAFT_OK.has(i.code));
    if (issues.length) throw new ApiProblem(422, "VALIDATION", issues[0].message, { issues });
    if (!recipe.nodes.some((n) => n.id === STUDIO_NODE_ID && n.type === STUDIO_NODE_TYPES[studio.kind]))
      throw new ApiProblem(422, "VALIDATION", "The Studio node is missing");
    await db.query("UPDATE canvases SET snapshot=$2, version=$3, updated_at=now() WHERE id=$1", [studio.canvasId, recipe, recipe.meta.version]);
    return { ...studio, recipe };
  });
  app.get<{ Params: { id: string; nodeId: string }; Querystring: { before?: string; limit?: string } }>(
    "/canvases/:id/nodes/:nodeId/history",
    async (request) => {
      const canvasId = check(request.params.id, "canvas ID");
      await requireCanvas(actor, canvasId, "read");
      const limit = request.query.limit === undefined ? 30 : Number(request.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new ApiProblem(400, "VALIDATION", "limit must be an integer from 1 to 100");
      const before = request.query.before;
      if (before !== undefined && Number.isNaN(Date.parse(before)))
        throw new ApiProblem(400, "VALIDATION", "Invalid before");
      return nodeHistory(canvasId, check(request.params.nodeId, "node ID"), before, limit);
    },
  );
  /** Delete from the feed. The job and its results stay (lineage); the entry is hidden. */
  app.delete<{ Params: { id: string; nodeId: string; jobId: string } }>(
    "/canvases/:id/nodes/:nodeId/history/:jobId",
    async (request) => {
      const canvasId = check(request.params.id, "canvas ID");
      await requireCanvas(actor, canvasId, "write");
      const { rowCount } = await db.query(
        "UPDATE jobs j SET hidden=true FROM runs r WHERE j.id=$1 AND j.node_id=$2 AND r.id=j.run_id AND r.canvas_id=$3",
        [check(request.params.jobId, "job ID"), check(request.params.nodeId, "node ID"), canvasId],
      );
      if (!rowCount) throw notFound("No such entry");
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string; nodeId: string; jobId: string } }>(
    "/canvases/:id/nodes/:nodeId/history/:jobId/restore",
    async (request) => {
      const canvasId = check(request.params.id, "canvas ID");
      await requireCanvas(actor, canvasId, "write");
      await db.query(
        "UPDATE jobs j SET hidden=false FROM runs r WHERE j.id=$1 AND j.node_id=$2 AND r.id=j.run_id AND r.canvas_id=$3",
        [check(request.params.jobId, "job ID"), check(request.params.nodeId, "node ID"), canvasId],
      );
      return { ok: true };
    },
  );
  /** History dock: results (media only) across Studio pages and canvases, newest first. */
  app.get<{ Querystring: { kind?: string; q?: string; since?: string; before?: string; limit?: string } }>(
    "/history",
    async (request): Promise<MediaHistoryResponse> => {
      const { kind, q, since, before } = request.query;
      const limit = request.query.limit === undefined ? 60 : Number(request.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ApiProblem(400, "VALIDATION", "Invalid limit");
      if (kind !== undefined && !["image", "video", "audio"].includes(kind)) throw new ApiProblem(400, "VALIDATION", "kind must be image, video or audio");
      for (const t of [since, before]) if (t !== undefined && Number.isNaN(Date.parse(t))) throw new ApiProblem(400, "VALIDATION", "Invalid time");
      if (q !== undefined && q.length > 200) throw new ApiProblem(400, "VALIDATION", "q is too long");
      const params: unknown[] = [await readableSpaceIds(actor)];
      const where = ["a.space_id = ANY($1)", "a.status='ready'", "a.catalog_version=1", "a.source_type='generated'"];
      const add = (sql: (n: string) => string, value: unknown) => {
        params.push(value);
        where.push(sql(`$${params.length}`));
      };
      if (kind) add((n) => `a.kind=${n}`, kind);
      if (since) add((n) => `a.created_at >= ${n}`, since);
      if (before) add((n) => `a.created_at < ${n}`, before);
      for (const word of (q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8))
        add((n) => `lower(coalesce(a.generation->>'intent','') || ' ' || coalesce(a.generation->>'prompt','') || ' ' || coalesce(a.name,'')) LIKE ${n}`, `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      params.push(limit + 1);
      const { rows } = await db.query(
        `SELECT ${ASSET_COLUMNS.split(",").map((c) => `a.${c.trim()}`).join(", ")}, a.source_job_id AS job_id, c.studio_kind, c.kind AS canvas_kind
         FROM assets a LEFT JOIN canvases c ON c.id=a.source_canvas_id
         WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC, a.id DESC LIMIT $${params.length}`,
        params,
      );
      const page = rows.slice(0, limit);
      const items: MediaHistoryItem[] = page.map((r) => ({
        asset: toAsset(r),
        ...(r.source_canvas_id ? { canvasId: r.source_canvas_id } : {}),
        ...(r.source_node_id ? { nodeId: r.source_node_id } : {}),
        ...(r.job_id ? { jobId: r.job_id } : {}),
        ...(r.canvas_kind === "studio" && r.studio_kind ? { studio: r.studio_kind } : {}),
      }));
      return { items, nextBefore: rows.length > limit ? new Date(page[page.length - 1].created_at).toISOString() : null };
    },
  );
  app.get<{ Params: { id: string; nodeId: string; jobId: string } }>(
    "/canvases/:id/nodes/:nodeId/history/:jobId",
    async (request) => {
      const canvasId = check(request.params.id, "canvas ID");
      await requireCanvas(actor, canvasId, "read");
      const nodeId = check(request.params.nodeId, "node ID");
      const jobId = check(request.params.jobId, "job ID");
      const { rows } = await db.query("SELECT created_at FROM jobs WHERE id=$1", [jobId]);
      if (!rows.length) throw notFound("No such entry");
      const after = new Date(new Date(rows[0].created_at).getTime() + 1).toISOString();
      const entry = (await nodeHistory(canvasId, nodeId, after, 5)).items.find((i) => i.jobId === jobId);
      if (!entry) throw notFound("No such entry");
      return entry;
    },
  );
}
