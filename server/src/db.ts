import pg from "pg";
import { config } from "./config.ts";
export const db = new pg.Pool({ connectionString: config.databaseUrl });
/** Set by migrate(): whether the pgvector extension could be enabled. */
export const capabilities = { vector: false };
export async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS canvases (id text PRIMARY KEY, name text NOT NULL, ydoc bytea, snapshot jsonb, version integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS presets (id text PRIMARY KEY, name text NOT NULL, recipe jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS assets (id text PRIMARY KEY, data jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id text PRIMARY KEY, canvas_id text NOT NULL, recipe jsonb NOT NULL, data jsonb NOT NULL, generation integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS runs_canvas ON runs(canvas_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS jobs (id text PRIMARY KEY, run_id text NOT NULL REFERENCES runs(id), node_id text NOT NULL, data jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS output_cache (key text PRIMARY KEY, outputs jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS usage (id bigserial PRIMARY KEY, run_id text NOT NULL, job_id text NOT NULL, node_id text NOT NULL, user_id text, project_id text, credits numeric NOT NULL, model text, at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS run_events (id bigserial PRIMARY KEY, run_id text NOT NULL REFERENCES runs(id), data jsonb NOT NULL);
    CREATE INDEX IF NOT EXISTS run_events_run ON run_events(run_id, id);
    CREATE TABLE IF NOT EXISTS mock_failures (run_id text NOT NULL, node_id text NOT NULL, PRIMARY KEY (run_id, node_id));
  `);
  // Catalog schema (docs/asset-platform.md). Every statement is idempotent.
  await db.query(`
    SELECT pg_advisory_lock(hashtext('zcanvas.migrate'));
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS spaces (id text PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('personal','team')), name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS space_members (space_id text NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES users(id), role text NOT NULL CHECK (role IN ('owner','editor','viewer')), PRIMARY KEY (space_id, user_id));
    CREATE INDEX IF NOT EXISTS space_members_user ON space_members(user_id);
    CREATE TABLE IF NOT EXISTS projects (id text PRIMARY KEY, space_id text NOT NULL REFERENCES spaces(id), name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS projects_space ON projects(space_id);
    ALTER TABLE canvases ADD COLUMN IF NOT EXISTS space_id text REFERENCES spaces(id);
    ALTER TABLE canvases ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id);
    CREATE INDEX IF NOT EXISTS canvases_space ON canvases(space_id, updated_at DESC);
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS space_id text;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS actor_id text;
    ALTER TABLE assets ALTER COLUMN data DROP NOT NULL;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS catalog_version integer NOT NULL DEFAULT 0;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS space_id text REFERENCES spaces(id);
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS creator_id text;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS source_type text;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS source_canvas_id text;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS source_run_id text;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS source_node_id text;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS source_job_id text;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS name text;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS kind text;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS mime text;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS bytes bigint;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS preview_status text NOT NULL DEFAULT 'none';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS description text;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS generation jsonb;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS purged_at timestamptz;
    CREATE INDEX IF NOT EXISTS assets_list_created ON assets(space_id, created_at DESC, id DESC) WHERE status = 'ready';
    CREATE INDEX IF NOT EXISTS assets_list_kind ON assets(space_id, kind, created_at DESC, id DESC) WHERE status = 'ready';
    CREATE INDEX IF NOT EXISTS assets_list_source ON assets(space_id, source_type, created_at DESC, id DESC) WHERE status = 'ready';
    CREATE INDEX IF NOT EXISTS assets_list_name ON assets(space_id, lower(name), id) WHERE status = 'ready';
    CREATE INDEX IF NOT EXISTS assets_name_trgm ON assets USING gin (lower(name) gin_trgm_ops) WHERE status = 'ready';
    CREATE INDEX IF NOT EXISTS assets_job ON assets(source_job_id) WHERE status = 'processing';
    CREATE INDEX IF NOT EXISTS assets_lifecycle ON assets(status, updated_at) WHERE status <> 'ready' AND purged_at IS NULL;
    CREATE TABLE IF NOT EXISTS asset_objects (asset_id text NOT NULL REFERENCES assets(id), role text NOT NULL, profile text NOT NULL, key text NOT NULL, bytes bigint, mime text, sha256 text, state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','stored','deleted')), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (asset_id, role));
    CREATE TABLE IF NOT EXISTS catalog_migration_issues (record_type text NOT NULL, record_id text NOT NULL, reason text NOT NULL, detected_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (record_type, record_id));
    SELECT pg_advisory_unlock(hashtext('zcanvas.migrate'));
  `);
  try {
    await db.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    capabilities.vector = true;
  } catch {
    capabilities.vector = false;
  }
  if (capabilities.vector)
    await db.query(`
      CREATE TABLE IF NOT EXISTS asset_search_index (asset_id text NOT NULL REFERENCES assets(id) ON DELETE CASCADE, model text NOT NULL, revision integer NOT NULL, state text NOT NULL CHECK (state IN ('indexed','failed')), embedding vector, content_hash text, error text, attempts integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (asset_id, model));
      CREATE INDEX IF NOT EXISTS asset_search_model ON asset_search_index(model, asset_id) WHERE state = 'indexed';
    `);
  const { ensureActor } = await import("./access.ts");
  await ensureActor(config.actorId, "Local user");
  const { migrateLegacyCatalog } = await import("./catalog-migration.ts");
  await migrateLegacyCatalog();
}
