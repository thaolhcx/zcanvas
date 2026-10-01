import { createHash } from "node:crypto";
import type {
  AssetKind,
  AssetSearchHit,
  AssetSearchQuery,
  AssetSearchResponse,
  AssetSourceType,
  GenerationInfo,
} from "../../contracts/index.ts";
import { capabilities, db } from "./db.ts";
import { config } from "./config.ts";
import { boss } from "./queue.ts";
import {
  ApiProblem,
  type Actor,
  personalSpaceId,
  requireSpace,
} from "./access.ts";
import {
  likePattern,
  onAssetsChanged,
  parseListQuery,
  toAsset,
} from "./assets.ts";
import { configuredProvider, type EmbeddingProvider } from "./embeddings.ts";
const COLUMNS = `a.id, a.space_id, a.creator_id, a.source_type, a.source_canvas_id, a.source_run_id, a.source_node_id,
  a.name, a.kind, a.mime, a.bytes, a.meta, a.status, a.preview_status, a.description, a.tags, a.generation, a.revision,
  a.created_at, a.updated_at, a.deleted_at`;
let provider: EmbeddingProvider | undefined = configuredProvider();
/** Tests and scripts may swap the provider; vectors stay separated by provider id. */
export function setEmbeddingProvider(next: EmbeddingProvider | undefined) {
  provider = next;
  queryCache.clear();
}
export const embeddingProvider = () => provider;
const semanticReady = () => Boolean(provider && capabilities.vector);
/**
 * The only text that is embedded (and, for a remote provider, the only text
 * that leaves the server). Media bytes are never sent.
 */
export function searchText(asset: {
  name?: string | null;
  kind?: string;
  description?: string | null;
  tags?: string[] | null;
  generation?: GenerationInfo | null;
}) {
  const name = asset.name ?? "";
  const stem = name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_\-.]+/g, " ");
  return [
    stem && `${stem}`,
    asset.kind && `${asset.kind}`,
    asset.description,
    asset.tags?.length ? asset.tags.join(", ") : "",
    asset.generation?.prompt,
    asset.generation?.references?.length
      ? asset.generation.references.map((r) => r.name).join(", ")
      : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
}
// ---------------------------------------------------------------- indexing
export async function enqueueIndex(ids: string[], force = false) {
  if (!semanticReady() || !ids.length) return;
  // Batched; duplicates of an already queued job are dropped by the queue policy.
  await boss.insert(
    ids.map((assetId) => ({
      name: "asset-index",
      data: { assetId, force },
      singletonKey: assetId,
    })),
  );
}
onAssetsChanged((ids) => enqueueIndex(ids));
/**
 * Lands only if the asset still has `revision` and is ready, and never
 * replaces an entry for a newer revision. Returns whether it was written.
 */
export async function writeIndexEntry(
  assetId: string,
  model: string,
  revision: number,
  vector: number[],
  contentHash: string,
) {
  const written = await db.query(
    `INSERT INTO asset_search_index(asset_id, model, revision, state, embedding, content_hash, attempts, updated_at)
     SELECT $1, $2, $3, 'indexed', $4::vector, $5, 0, now()
     WHERE EXISTS (SELECT 1 FROM assets WHERE id=$1 AND revision=$3 AND status='ready')
     ON CONFLICT (asset_id, model) DO UPDATE SET revision=EXCLUDED.revision, state='indexed',
       embedding=EXCLUDED.embedding, content_hash=EXCLUDED.content_hash, error=NULL, attempts=0, updated_at=now()
     WHERE asset_search_index.revision <= EXCLUDED.revision`,
    [assetId, model, revision, JSON.stringify(vector), contentHash],
  );
  return Boolean(written.rowCount);
}
/**
 * Retry-safe and order-safe: the write only lands when the asset still has
 * the revision the text was built from, and never replaces a newer revision.
 */
export async function indexAsset(
  assetId: string,
  options: { force?: boolean; finalAttempt?: boolean } = {},
): Promise<"indexed" | "unchanged" | "removed" | "stale" | "skipped"> {
  if (!semanticReady()) return "skipped";
  const model = provider!;
  const { rows } = await db.query(
    "SELECT id, name, kind, description, tags, generation, revision, status FROM assets WHERE id=$1",
    [assetId],
  );
  const asset = rows[0];
  if (!asset || asset.status !== "ready") {
    await db.query("DELETE FROM asset_search_index WHERE asset_id=$1", [
      assetId,
    ]);
    return "removed";
  }
  const text = searchText(asset);
  const contentHash = createHash("sha256")
    .update(`${model.id}\n${text}`)
    .digest("hex");
  const existing = (
    await db.query(
      "SELECT revision, state, content_hash FROM asset_search_index WHERE asset_id=$1 AND model=$2",
      [assetId, model.id],
    )
  ).rows[0];
  if (existing && existing.revision > asset.revision) return "stale";
  if (
    !options.force &&
    existing?.state === "indexed" &&
    existing.content_hash === contentHash
  ) {
    // Same text (e.g. a revision bump without searchable change): no new embedding.
    await db.query(
      `UPDATE asset_search_index s SET revision=a.revision, updated_at=now() FROM assets a
       WHERE s.asset_id=$1 AND s.model=$2 AND a.id=s.asset_id AND a.revision=$3 AND s.revision < a.revision`,
      [assetId, model.id, asset.revision],
    );
    return "unchanged";
  }
  try {
    const [vector] = await model.embed([text], "document");
    return (await writeIndexEntry(
      assetId,
      model.id,
      asset.revision,
      vector,
      contentHash,
    ))
      ? "indexed"
      : "stale";
  } catch (error) {
    if (options.finalAttempt !== false)
      await db.query(
        `INSERT INTO asset_search_index(asset_id, model, revision, state, error, attempts)
         SELECT $1, $2, $3, 'failed', $4, 1 WHERE EXISTS (SELECT 1 FROM assets WHERE id=$1 AND revision=$3 AND status='ready')
         ON CONFLICT (asset_id, model) DO UPDATE SET state=CASE WHEN asset_search_index.revision < EXCLUDED.revision THEN 'failed' ELSE asset_search_index.state END,
           error=EXCLUDED.error, attempts=asset_search_index.attempts+1, updated_at=now()`,
        [
          assetId,
          model.id,
          asset.revision,
          error instanceof Error
            ? error.message.slice(0, 300)
            : "Embedding failed",
        ],
      );
    throw error;
  }
}
/**
 * Backfill: queue ready assets whose current-model entry is missing or older
 * than the asset. `all` re-embeds everything; `prune` drops other models.
 */
export async function reindex(
  options: { all?: boolean; prune?: boolean } = {},
) {
  if (!semanticReady()) return { queued: 0, pruned: 0, model: undefined };
  const model = provider!.id;
  const pruned = options.prune
    ? ((
        await db.query("DELETE FROM asset_search_index WHERE model<>$1", [
          model,
        ])
      ).rowCount ?? 0)
    : 0;
  const { rows } = await db.query(
    `SELECT a.id FROM assets a LEFT JOIN asset_search_index s ON s.asset_id=a.id AND s.model=$1
     WHERE a.status='ready' AND a.catalog_version=1 AND a.space_id IS NOT NULL
       AND ($2::boolean OR s.asset_id IS NULL OR s.revision < a.revision)`,
    [model, Boolean(options.all)],
  );
  for (let i = 0; i < rows.length; i += 500)
    await enqueueIndex(
      rows.slice(i, i + 500).map((r) => r.id),
      Boolean(options.all),
    );
  return { queued: rows.length, pruned, model };
}
export async function startSearchWorkers() {
  await boss.work<{ assetId: string; force?: boolean }>(
    "asset-index",
    { batchSize: 8, pollingIntervalSeconds: 0.5, includeMetadata: true },
    async (jobs) => {
      for (const job of jobs)
        await indexAsset(job.data.assetId, {
          force: job.data.force,
          finalAttempt: job.retryCount >= job.retryLimit,
        });
    },
  );
  // Backfill in the background so startup is not delayed by a large catalog.
  void reindex().catch((error) => console.error("Search backfill:", error));
}
// ---------------------------------------------------------------- query
const queryCache = new Map<string, number[]>();
function untilAborted<T>(work: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
/** Caches query vectors only. Results are always fetched with current scope and state. */
async function embedQuery(q: string, signal: AbortSignal) {
  const key = `${provider!.id}\n${q}`;
  const cached = queryCache.get(key);
  if (cached) return cached;
  // In-process models cannot be interrupted, so stop waiting at the deadline.
  const [vector] = await untilAborted(
    provider!.embed([q], "query", signal),
    signal,
  );
  queryCache.set(key, vector);
  if (queryCache.size > 500) queryCache.delete(queryCache.keys().next().value!);
  return vector;
}
export function parseSearchQuery(
  query: Record<string, unknown>,
): AssetSearchQuery {
  const { q, limit, ...rest } = query;
  if (typeof q !== "string" || !q.trim() || q.length > 200)
    throw new ApiProblem(400, "VALIDATION", "q is required (1–200 characters)");
  const limitValue = limit === undefined ? 20 : Number(limit);
  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 50)
    throw new ApiProblem(
      400,
      "VALIDATION",
      "limit must be an integer from 1 to 50",
    );
  const unknown = Object.keys(rest).filter(
    (k) => !["spaceId", "kind", "source"].includes(k),
  );
  if (unknown.length)
    throw new ApiProblem(
      400,
      "VALIDATION",
      `Unknown parameters: ${unknown.join(", ")}`,
    );
  const filters = parseListQuery(rest);
  return { q: q.trim(), limit: limitValue, ...filters } as AssetSearchQuery;
}
function filters(
  params: unknown[],
  kind?: AssetKind,
  source?: AssetSourceType,
) {
  const where: string[] = [];
  if (kind) {
    params.push(kind);
    where.push(`a.kind=$${params.length}`);
  }
  if (source) {
    params.push(source);
    where.push(`a.source_type=$${params.length}`);
  }
  return where.map((w) => ` AND ${w}`).join("");
}
export async function searchAssets(
  actor: Actor,
  query: AssetSearchQuery,
): Promise<AssetSearchResponse> {
  const spaceId = query.spaceId ?? personalSpaceId(actor.id);
  await requireSpace(actor, spaceId, "read", "Space not found");
  const limit = query.limit ?? 20;
  const q = query.q;
  // 1. Name matches: exact names first, then substring/prefix, then fuzzy.
  const nameParams: unknown[] = [spaceId, q.toLowerCase(), likePattern(q)];
  const nameRows = (
    await db.query(
      `SELECT ${COLUMNS},
         (lower(a.name)=$2 OR lower(regexp_replace(a.name, '\\.[A-Za-z0-9]{1,5}$', ''))=$2) AS exact
       FROM assets a
       WHERE a.space_id=$1 AND a.status='ready' AND a.catalog_version=1
         AND (lower(a.name) LIKE $3 OR lower(a.name) % $2)${filters(nameParams, query.kind, query.source)}
       ORDER BY exact DESC, (lower(a.name) LIKE $3) DESC, similarity(lower(a.name), $2) DESC, a.id
       LIMIT ${limit}`,
      nameParams,
    )
  ).rows;
  // 2. Semantic matches, filtered by scope inside candidate retrieval.
  let semantic: AssetSearchResponse["semantic"];
  let semanticRows: Record<string, any>[] = [];
  if (!config.search.enabled || !provider) semantic = { state: "disabled" };
  else if (!capabilities.vector)
    semantic = {
      state: "unavailable",
      message: "The pgvector extension is not installed",
    };
  else {
    const started = Date.now();
    try {
      const signal = AbortSignal.timeout(config.search.queryTimeoutMs);
      const vector = await embedQuery(q, signal);
      const remaining = Math.max(
        100,
        config.search.queryTimeoutMs - (Date.now() - started),
      );
      const params: unknown[] = [spaceId, provider.id, JSON.stringify(vector)];
      const extra = filters(params, query.kind, query.source);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `SET LOCAL statement_timeout = ${Math.floor(remaining)}`,
        );
        semanticRows = (
          await client.query(
            `SELECT ${COLUMNS}, 1 - (s.embedding <=> $3::vector) AS similarity
             FROM asset_search_index s JOIN assets a ON a.id=s.asset_id
             WHERE s.model=$2 AND s.state='indexed' AND s.revision=a.revision
               AND a.space_id=$1 AND a.status='ready' AND a.catalog_version=1${extra}
             ORDER BY s.embedding <=> $3::vector, a.id
             LIMIT ${limit}`,
            params,
          )
        ).rows;
        const pending = await client.query(
          `SELECT count(*)::int AS n FROM assets a
           WHERE a.space_id=$1 AND a.status='ready' AND a.catalog_version=1
             AND NOT EXISTS (SELECT 1 FROM asset_search_index s WHERE s.asset_id=a.id AND s.model=$2 AND s.state='indexed' AND s.revision=a.revision)`,
          [spaceId, provider.id],
        );
        await client.query("COMMIT");
        const n = pending.rows[0].n;
        semantic = {
          state: n ? "indexing" : "ok",
          model: provider.id,
          ...(n ? { pending: n } : {}),
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      semanticRows = [];
      const timedOut =
        (error as Error)?.name === "TimeoutError" ||
        (error as Error)?.name === "AbortError" ||
        (error as { code?: string })?.code === "57014";
      semantic = timedOut
        ? {
            state: "timeout",
            model: provider.id,
            message: "Semantic search took too long",
          }
        : {
            state: "unavailable",
            model: provider.id,
            message: "Semantic search is unavailable",
          };
    }
  }
  // 3. Reciprocal-rank fusion; exact names stay on top.
  const hits = new Map<
    string,
    {
      row: Record<string, any>;
      score: number;
      matchedBy: Set<"name" | "semantic">;
      semanticScore?: number;
      exact: boolean;
    }
  >();
  const add = (
    row: Record<string, any>,
    rank: number,
    by: "name" | "semantic",
  ) => {
    const hit = hits.get(row.id) ?? {
      row,
      score: 0,
      matchedBy: new Set(),
      exact: false,
    };
    hit.score += 1 / (60 + rank);
    hit.matchedBy.add(by);
    if (by === "name" && row.exact) hit.exact = true;
    if (by === "semantic") hit.semanticScore = Number(row.similarity);
    hits.set(row.id, hit);
  };
  nameRows.forEach((row, i) => add(row, i + 1, "name"));
  semanticRows.forEach((row, i) => add(row, i + 1, "semantic"));
  const ranked = [...hits.values()]
    .sort(
      (a, b) =>
        Number(b.exact) - Number(a.exact) ||
        b.score - a.score ||
        (a.row.id < b.row.id ? -1 : 1),
    )
    .slice(0, limit);
  // 4. Final hydration rechecks scope and state at response time.
  const current = ranked.length
    ? new Map(
        (
          await db.query(
            `SELECT ${COLUMNS} FROM assets a WHERE a.id = ANY($1) AND a.space_id=$2 AND a.status='ready'`,
            [ranked.map((h) => h.row.id), spaceId],
          )
        ).rows.map((r) => [r.id, r]),
      )
    : new Map();
  const top = ranked[0]?.score || 1;
  const items: AssetSearchHit[] = ranked
    .filter((hit) => current.has(hit.row.id))
    .map((hit) => ({
      asset: toAsset(current.get(hit.row.id)),
      score: Math.min(1, Number((hit.score / top).toFixed(4))),
      matchedBy: [...hit.matchedBy].sort() as AssetSearchHit["matchedBy"],
      ...(hit.semanticScore !== undefined
        ? { semanticScore: Number(hit.semanticScore.toFixed(4)) }
        : {}),
    }));
  return {
    query: q,
    spaceId,
    limit,
    mode:
      semantic.state === "ok" || semantic.state === "indexing"
        ? "hybrid"
        : "name",
    semantic,
    items,
  };
}
