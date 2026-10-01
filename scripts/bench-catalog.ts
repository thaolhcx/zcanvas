/**
 * Catalog and search retrieval benchmark on a seeded space.
 *
 *   pnpm bench:catalog            # seeds 10,000 rows once, then measures
 *   ROWS=50000 pnpm bench:catalog
 *
 * Rows are catalog records only (no media), so timings exclude media
 * transfer. Semantic retrieval uses stored 384-dimension vectors; retrieval
 * cost depends on row count and dimensions, not on vector quality, so the
 * deterministic hash model is used for seeding. When EMBEDDING_PROVIDER is
 * local/openai the end-to-end time (query embedding + retrieval) is also
 * reported. Writes docs/evidence/asset-catalog-bench.json.
 */
import { writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { db, migrate } from "../server/src/db.ts";
import { ensureActor } from "../server/src/access.ts";
import { listAssets } from "../server/src/assets.ts";
import { configuredProvider, hashProvider } from "../server/src/embeddings.ts";
import {
  searchAssets,
  searchText,
  setEmbeddingProvider,
} from "../server/src/search.ts";
const ROWS = Number(process.env.ROWS ?? 10000);
const RUNS = Number(process.env.RUNS ?? 60);
await migrate();
const actor = { id: "usr_bench" };
await ensureActor(actor.id, "Benchmark");
const spaceId = "spc_bench";
await db.query(
  "INSERT INTO spaces(id,kind,name) VALUES($1,'team','Benchmark') ON CONFLICT DO NOTHING",
  [spaceId],
);
await db.query(
  "INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING",
  [spaceId, actor.id],
);
// Noise in other spaces makes sure filters, not luck, keep queries fast.
const noiseSpace = "spc_bench_noise";
await db.query(
  "INSERT INTO spaces(id,kind,name) VALUES($1,'team','Noise') ON CONFLICT DO NOTHING",
  [noiseSpace],
);
const seedModel = hashProvider(384);
const words =
  "sunset ocean portrait city night forest rain coffee street mountain river girl warrior castle neon desert snow puppy cat flower market lantern boat bridge temple".split(
    " ",
  );
const pick = (i: number, n: number) =>
  words[(i * 7919 + n * 104729) % words.length];
async function seed(space: string, count: number, prefix: string) {
  const existing = Number(
    (await db.query("SELECT count(*) FROM assets WHERE space_id=$1", [space]))
      .rows[0].count,
  );
  if (existing >= count) return 0;
  const batch = 1000;
  for (let start = existing; start < count; start += batch) {
    const rows = [];
    for (let i = start; i < Math.min(count, start + batch); i++) {
      const kind = ["image", "video", "audio"][i % 3];
      const name = `${pick(i, 1)} ${pick(i, 2)} ${String(i).padStart(5, "0")}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "wav"}`;
      const prompt =
        i % 2
          ? `${pick(i, 3)} ${pick(i, 4)} at ${pick(i, 5)}, cinematic`
          : null;
      rows.push({
        id: `ast_${prefix}_${String(i).padStart(6, "0")}`,
        name,
        kind,
        source: prompt ? "generated" : "upload",
        prompt,
        // Many identical timestamps exercise the ID tie-breaker.
        created: new Date(
          Date.UTC(2026, 0, 1) + Math.floor(i / 10) * 1000,
        ).toISOString(),
      });
    }
    const vectors = await seedModel.embed(
      rows.map((r) =>
        searchText({
          name: r.name,
          kind: r.kind,
          generation: r.prompt
            ? { nodeType: "x", typeVersion: 1, prompt: r.prompt }
            : null,
        }),
      ),
      "document",
    );
    await db.query(
      `INSERT INTO assets(id, catalog_version, space_id, source_type, name, kind, mime, bytes, status, preview_status, generation, created_at, updated_at)
       SELECT r.id, 1, $1, r.source, r.name, r.kind, r.kind || '/x', 1000, 'ready', 'none',
         CASE WHEN r.prompt IS NULL THEN NULL ELSE jsonb_build_object('nodeType','x','typeVersion',1,'prompt',r.prompt) END, r.created::timestamptz, r.created::timestamptz
       FROM jsonb_to_recordset($2) AS r(id text, name text, kind text, source text, prompt text, created text)
       ON CONFLICT DO NOTHING`,
      [space, JSON.stringify(rows)],
    );
    await db.query(
      `INSERT INTO asset_search_index(asset_id, model, revision, state, embedding, content_hash)
       SELECT r.id, $1, 1, 'indexed', r.v::vector, 'bench' FROM jsonb_to_recordset($2) AS r(id text, v text)
       ON CONFLICT DO NOTHING`,
      [
        seedModel.id,
        JSON.stringify(
          rows.map((r, i) => ({ id: r.id, v: JSON.stringify(vectors[i]) })),
        ),
      ],
    );
  }
  return count - existing;
}
const seeded =
  (await seed(spaceId, ROWS, "bench")) +
  (await seed(noiseSpace, ROWS, "noise"));
await db.query("ANALYZE assets; ANALYZE asset_search_index;");
async function measure(label: string, fn: () => Promise<unknown>) {
  for (let i = 0; i < 5; i++) await fn(); // warm
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    await fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const q = (p: number) =>
    Number(
      times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(
        2,
      ),
    );
  return { label, runs: RUNS, p50Ms: q(0.5), p95Ms: q(0.95), maxMs: q(1) };
}
const deepCursor = await (async () => {
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++)
    cursor = (
      await listAssets(actor, {
        spaceId,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      })
    ).nextCursor;
  return cursor!;
})();
const results = [
  await measure("list first page (100, newest first)", () =>
    listAssets(actor, { spaceId, limit: 100 }),
  ),
  await measure("list page 51 via cursor (100)", () =>
    listAssets(actor, { spaceId, limit: 100, cursor: deepCursor }),
  ),
  await measure("list kind=video (100)", () =>
    listAssets(actor, { spaceId, limit: 100, kind: "video" }),
  ),
  await measure("list name_asc (100)", () =>
    listAssets(actor, { spaceId, limit: 100, sort: "name_asc" }),
  ),
  await measure("name search q=lantern (100)", () =>
    listAssets(actor, { spaceId, limit: 100, q: "lantern" }),
  ),
  await measure("name search q=00042 (100)", () =>
    listAssets(actor, { spaceId, limit: 100, q: "00042" }),
  ),
];
// Retrieval only: the query vector is computed once, outside the timer.
const [queryVector] = await seedModel.embed(["lantern at night"], "query");
const retrieval = `SELECT a.id, 1 - (s.embedding <=> $3::vector) AS similarity
  FROM asset_search_index s JOIN assets a ON a.id=s.asset_id
  WHERE s.model=$2 AND s.state='indexed' AND s.revision=a.revision AND a.space_id=$1 AND a.status='ready' AND a.catalog_version=1
  ORDER BY s.embedding <=> $3::vector, a.id LIMIT 20`;
const retrievalParams = [spaceId, seedModel.id, JSON.stringify(queryVector)];
results.push(
  await measure("semantic retrieval top-20 (excl. embedding)", () =>
    db.query(retrieval, retrievalParams),
  ),
);
setEmbeddingProvider(seedModel);
results.push(
  await measure("hybrid search API path, hash query embedding", () =>
    searchAssets(actor, { q: "lantern at night", spaceId, limit: 20 }),
  ),
);
const real = configuredProvider();
let endToEnd;
if (real && !real.id.startsWith("hash")) {
  // Vectors in the index are from the seed model; this measures the cost of a
  // real query embedding plus the same retrieval, not result quality.
  const texts = Array.from(
    { length: RUNS + 5 },
    (_, i) => `${pick(i, 6)} ${pick(i, 7)} scene ${i}`,
  );
  let n = 0;
  await real.embed(["warm up"], "query");
  endToEnd = await measure(
    `query embedding (${real.id}) + retrieval`,
    async () => {
      const [v] = await real.embed([texts[n++ % texts.length]], "query");
      void v;
      await db.query(retrieval, retrievalParams);
    },
  );
}
const explain = async (sql: string, params: unknown[]) =>
  (await db.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, params)).rows.map(
    (r) => r["QUERY PLAN"],
  );
const plans = {
  listFirstPage: await explain(
    `SELECT id FROM assets WHERE space_id=$1 AND status='ready' AND catalog_version=1 ORDER BY created_at DESC, id DESC LIMIT 101`,
    [spaceId],
  ),
  nameSearch: await explain(
    `SELECT id FROM assets WHERE space_id=$1 AND status='ready' AND catalog_version=1 AND lower(name) LIKE $2 ORDER BY created_at DESC, id DESC LIMIT 101`,
    [spaceId, "%lantern%"],
  ),
  semanticRetrieval: await explain(retrieval, retrievalParams),
};
const version = (
  await db.query(
    "SELECT version(), (SELECT extversion FROM pg_extension WHERE extname='vector') AS pgvector",
  )
).rows[0];
const report = {
  generatedAt: new Date().toISOString(),
  rowsInSpace: ROWS,
  rowsInOtherSpace: ROWS,
  seededThisRun: seeded,
  environment: {
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    node: process.version,
    postgres: version.version,
    pgvector: version.pgvector,
    note: "Cloud container, Postgres on the same host, default Postgres settings, warm cache.",
  },
  targets: { listPageP95Ms: 200, retrievalP95Ms: 500 },
  results,
  endToEnd:
    endToEnd ??
    "Set EMBEDDING_PROVIDER=local or openai to measure query embedding + retrieval",
  plans,
};
await writeFile(
  new URL("../docs/evidence/asset-catalog-bench.json", import.meta.url),
  JSON.stringify(report, null, 1) + "\n",
);
for (const r of [...results, ...(endToEnd ? [endToEnd] : [])])
  console.log(`${r.label}: p50 ${r.p50Ms} ms, p95 ${r.p95Ms} ms`);
await db.end();
