/**
 * Search-quality evaluation with a real embedding model.
 *
 *   EMBEDDING_PROVIDER=local pnpm search:eval
 *   EMBEDDING_PROVIDER=openai EMBEDDING_API_KEY=… pnpm search:eval
 *
 * Loads fixtures/search-eval.json into an isolated space, indexes it, runs
 * every query through the same hybrid search the API uses and writes
 * recall@10 to docs/evidence/search-eval-<provider>.json. Hash embeddings are
 * refused: they are not evidence of search quality.
 */
import { readFile, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { db, migrate } from "../server/src/db.ts";
import { ensureActor } from "../server/src/access.ts";
import { configuredProvider } from "../server/src/embeddings.ts";
import {
  indexAsset,
  searchAssets,
  setEmbeddingProvider,
} from "../server/src/search.ts";
type Fixture = {
  assets: {
    id: string;
    name: string;
    kind: string;
    description?: string;
    tags?: string[];
    prompt?: string;
    references?: string[];
  }[];
  queries: { q: string; lang: string; relevant: string[] }[];
};
const provider = configuredProvider();
if (!provider || provider.id.startsWith("hash"))
  throw new Error(
    "Set EMBEDDING_PROVIDER=local or openai: hash embeddings are not quality evidence",
  );
await migrate();
setEmbeddingProvider(provider);
const fixture: Fixture = JSON.parse(
  await readFile(
    new URL("../fixtures/search-eval.json", import.meta.url),
    "utf8",
  ),
);
const actor = { id: "usr_search_eval" };
await ensureActor(actor.id, "Search evaluation");
const spaceId = "spc_search_eval";
await db.query(
  "DELETE FROM asset_search_index WHERE asset_id IN (SELECT id FROM assets WHERE space_id=$1)",
  [spaceId],
);
await db.query("DELETE FROM assets WHERE space_id=$1", [spaceId]);
for (const a of fixture.assets) {
  await db.query(
    `INSERT INTO assets(id, catalog_version, space_id, source_type, name, kind, mime, bytes, status, preview_status, description, tags, generation)
     VALUES($1,1,$2,$3,$4,$5,$6,0,'ready','none',$7,$8,$9)`,
    [
      a.id,
      spaceId,
      a.prompt ? "generated" : "upload",
      a.name,
      a.kind,
      `${a.kind}/${a.name.split(".").pop()}`,
      a.description ?? null,
      a.tags ?? [],
      a.prompt || a.references
        ? {
            nodeType: `${a.kind}.generate`,
            typeVersion: 1,
            ...(a.prompt ? { prompt: a.prompt } : {}),
            ...(a.references ? { references: a.references } : {}),
          }
        : null,
    ],
  );
}
const indexStart = Date.now();
for (const a of fixture.assets) await indexAsset(a.id);
const indexMs = Date.now() - indexStart;
// Warm the model and query path once.
await searchAssets(actor, { q: "warm up", spaceId, limit: 10 });
const results = [];
for (const query of fixture.queries) {
  const started = performance.now();
  const response = await searchAssets(actor, {
    q: query.q,
    spaceId,
    limit: 10,
  });
  const ms = performance.now() - started;
  const ranked = response.items.map((h) => h.asset.id);
  const rank = ranked.findIndex((id) => query.relevant.includes(id));
  results.push({
    q: query.q,
    lang: query.lang,
    relevant: query.relevant,
    hit: rank >= 0,
    rank: rank >= 0 ? rank + 1 : null,
    top3: response.items
      .slice(0, 3)
      .map((h) => ({
        id: h.asset.id,
        name: h.asset.name,
        by: h.matchedBy,
        similarity: h.semanticScore,
      })),
    semanticState: response.semantic.state,
    endToEndMs: Number(ms.toFixed(1)),
  });
}
const hits = results.filter((r) => r.hit).length;
const recall = (lang?: string) => {
  const subset = results.filter((r) => !lang || r.lang === lang);
  return Number(
    (subset.filter((r) => r.hit).length / subset.length).toFixed(3),
  );
};
const times = results.map((r) => r.endToEndMs).sort((a, b) => a - b);
const report = {
  generatedAt: new Date().toISOString(),
  provider: provider.id,
  dims: provider.dims,
  remote: provider.remote,
  machine: {
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    node: process.version,
  },
  assets: fixture.assets.length,
  queries: results.length,
  recallAt10: recall(),
  recallAt10En: recall("en"),
  recallAt10Vi: recall("vi"),
  mrr: Number(
    (
      results.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) /
      results.length
    ).toFixed(3),
  ),
  target: "relevant asset in top 10 for at least 80% of queries",
  passed: hits / results.length >= 0.8,
  failures: results.filter((r) => !r.hit),
  endToEndMs: {
    note: "query embedding + hybrid retrieval, in process",
    p50: times[Math.floor(times.length / 2)],
    p95: times[Math.floor(times.length * 0.95)],
  },
  indexMs,
  results,
};
const slug = provider.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
const path = new URL(
  `../docs/evidence/search-eval-${slug}.json`,
  import.meta.url,
);
await writeFile(path, JSON.stringify(report, null, 1) + "\n");
console.log(
  `${provider.id}: recall@10 ${report.recallAt10} (en ${report.recallAt10En}, vi ${report.recallAt10Vi}), MRR ${report.mrr}`,
);
for (const failure of report.failures)
  console.log(
    `  miss: "${failure.q}" → ${failure.top3.map((t) => t.name).join(", ")}`,
  );
await db.end();
