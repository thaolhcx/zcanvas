/**
 * Operator commands for the asset catalog and search index.
 *
 *   pnpm assets migrate                    # rerunnable; prints unmapped records
 *   pnpm assets assign <spaceId> [ids…]    # explicitly adopt reported assets
 *   pnpm assets sweep                      # fail stuck writes, queue cleanup
 *   pnpm assets reindex [--all] [--prune]  # backfill / rebuild semantic index
 *   pnpm assets search-status              # index coverage for the current model
 */
import { db, migrate, capabilities } from "../server/src/db.ts";
import {
  assignUnmappedAssets,
  migrateLegacyCatalog,
} from "../server/src/catalog-migration.ts";
import { sweepStaleWrites } from "../server/src/assets.ts";
import { embeddingProvider, reindex } from "../server/src/search.ts";
import { boss, startQueue } from "../server/src/queue.ts";
import { config } from "../server/src/config.ts";
const [command, ...args] = process.argv.slice(2);
await migrate();
await startQueue();
try {
  switch (command) {
    case "migrate": {
      const report = await migrateLegacyCatalog();
      console.log(JSON.stringify(report, null, 2));
      if (report.unmapped.length)
        console.log(
          `\n${report.unmapped.length} record(s) have no owner and stay hidden. Assign them with: pnpm assets assign <spaceId> [ids…]`,
        );
      break;
    }
    case "assign": {
      const [spaceId, ...ids] = args;
      if (!spaceId)
        throw new Error("Usage: pnpm assets assign <spaceId> [assetIds…]");
      const exists = await db.query("SELECT 1 FROM spaces WHERE id=$1", [
        spaceId,
      ]);
      if (!exists.rowCount) throw new Error(`Space ${spaceId} does not exist`);
      console.log(
        `Assigned ${await assignUnmappedAssets(spaceId, ids.length ? ids : undefined)} asset(s) to ${spaceId}`,
      );
      break;
    }
    case "sweep":
      console.log(
        `Failed ${await sweepStaleWrites()} stuck write(s); cleanup is queued`,
      );
      break;
    case "reindex": {
      if (!embeddingProvider() || !capabilities.vector)
        throw new Error(
          !capabilities.vector
            ? "pgvector is not installed in this database"
            : `Semantic search is disabled (SEARCH_SEMANTIC=${config.search.enabled ? 1 : 0}, EMBEDDING_PROVIDER=${config.search.provider})`,
        );
      const result = await reindex({
        all: args.includes("--all"),
        prune: args.includes("--prune"),
      });
      console.log(
        `Queued ${result.queued} asset(s) for ${result.model}; pruned ${result.pruned} entr(ies) of other models. The runner processes the queue.`,
      );
      break;
    }
    case "search-status": {
      const model = embeddingProvider()?.id;
      if (!model || !capabilities.vector) {
        console.log("Semantic search is disabled or unavailable");
        break;
      }
      const { rows } = await db.query(
        `SELECT count(*) FILTER (WHERE s.state='indexed' AND s.revision=a.revision)::int AS indexed,
                count(*) FILTER (WHERE s.state='failed')::int AS failed,
                count(*) FILTER (WHERE s.asset_id IS NULL OR s.revision<a.revision)::int AS pending
         FROM assets a LEFT JOIN asset_search_index s ON s.asset_id=a.id AND s.model=$1
         WHERE a.status='ready' AND a.catalog_version=1`,
        [model],
      );
      console.log({ model, ...rows[0] });
      break;
    }
    default:
      console.log(
        "Commands: migrate | assign <spaceId> [ids…] | sweep | reindex [--all] [--prune] | search-status",
      );
      process.exitCode = command ? 1 : 0;
  }
} finally {
  await boss.stop({ graceful: true });
  await db.end();
}
