import pg from "pg";
import { config } from "./config.ts";
export const db = new pg.Pool({ connectionString: config.databaseUrl });
/** Set by migrate(): whether the pgvector extension could be enabled. */
export const capabilities = { vector: false };
export async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS canvases (id text PRIMARY KEY, name text NOT NULL, ydoc bytea, snapshot jsonb, version integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS presets (id text PRIMARY KEY, name text NOT NULL, recipe jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE presets ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
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
    -- Reference names were saved as plain strings before IDs and ports were kept.
    UPDATE assets SET generation = jsonb_set(generation, '{references}',
      (SELECT jsonb_agg(CASE WHEN jsonb_typeof(r) = 'string' THEN jsonb_build_object('name', r #>> '{}') ELSE r END)
         FROM jsonb_array_elements(generation->'references') r))
    WHERE jsonb_typeof(generation->'references') = 'array'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(generation->'references') r WHERE jsonb_typeof(r) = 'string');
    -- #25: kept assets, per-node job history, the model queue, Studio canvases, provider caches.
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS kept boolean;
    UPDATE assets SET kept = (COALESCE(source_type, 'upload') <> 'generated') WHERE kept IS NULL;
    -- Rows that do not say (scripts, older paths) are kept; results set false explicitly.
    ALTER TABLE assets ALTER COLUMN kept SET DEFAULT true;
    ALTER TABLE assets ALTER COLUMN kept SET NOT NULL;
    CREATE INDEX IF NOT EXISTS assets_list_kept ON assets(space_id, kept, created_at DESC, id DESC) WHERE status = 'ready';
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS request jsonb;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS replaced_at timestamptz;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
    CREATE INDEX IF NOT EXISTS jobs_run ON jobs(run_id);
    CREATE INDEX IF NOT EXISTS jobs_node_history ON jobs(node_id, created_at DESC);
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS target text;
    ALTER TABLE canvases ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'canvas';
    ALTER TABLE canvases ADD COLUMN IF NOT EXISTS studio_kind text;
    ALTER TABLE canvases ADD COLUMN IF NOT EXISTS owner_id text;
    CREATE UNIQUE INDEX IF NOT EXISTS canvases_studio ON canvases(owner_id, studio_kind) WHERE kind = 'studio';
    CREATE TABLE IF NOT EXISTS gen_tasks (
      id text PRIMARY KEY, job_id text NOT NULL, attempt integer NOT NULL, run_id text NOT NULL, node_id text NOT NULL,
      actor_id text, provider text NOT NULL, model text NOT NULL, provider_task_id text,
      state text NOT NULL CHECK (state IN ('submitting','submitted','done','failed','cancelled','dropped')),
      eta_at timestamptz, deadline_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
      submitted_at timestamptz, finished_at timestamptz, fetches integer NOT NULL DEFAULT 0, error text,
      UNIQUE (job_id, attempt));
    CREATE INDEX IF NOT EXISTS gen_tasks_active ON gen_tasks(model, state) WHERE state IN ('submitting','submitted','dropped');
    CREATE INDEX IF NOT EXISTS gen_tasks_actor ON gen_tasks(actor_id, state) WHERE state IN ('submitting','submitted');
    CREATE INDEX IF NOT EXISTS gen_tasks_run ON gen_tasks(run_id);
    CREATE TABLE IF NOT EXISTS gen_stats (id bigserial PRIMARY KEY, model text NOT NULL, bucket text NOT NULL, ms integer NOT NULL, at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS gen_stats_model ON gen_stats(model, bucket, id DESC);
    CREATE TABLE IF NOT EXISTS provider_media (sha256 text NOT NULL, provider text NOT NULL, object_key text, provider_asset_id text, real_person boolean, asset_type text, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (provider, sha256));
    CREATE TABLE IF NOT EXISTS provider_state (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS mock_tasks (id text PRIMARY KEY, ready_at timestamptz NOT NULL, request jsonb NOT NULL, state text NOT NULL DEFAULT 'queued', created_at timestamptz NOT NULL DEFAULT now());
    SELECT pg_advisory_unlock(hashtext('zcanvas.migrate'));
  `);
  // Under the same lock: two processes starting together would otherwise race
  // on CREATE EXTENSION, and the loser would wrongly turn semantic search off.
  const client = await db.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('zcanvas.migrate'))");
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);
      capabilities.vector = true;
    } catch {
      capabilities.vector = false;
    }
    if (capabilities.vector)
      await client.query(`
      CREATE TABLE IF NOT EXISTS asset_search_index (asset_id text NOT NULL REFERENCES assets(id) ON DELETE CASCADE, model text NOT NULL, revision integer NOT NULL, state text NOT NULL CHECK (state IN ('indexed','failed')), embedding vector, content_hash text, error text, attempts integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (asset_id, model));
      CREATE INDEX IF NOT EXISTS asset_search_model ON asset_search_index(model, asset_id) WHERE state = 'indexed';
    `);
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('zcanvas.migrate'))")
      .catch(() => {});
    client.release();
  }
  const { ensureActor } = await import("./access.ts");
  await ensureActor(config.actorId, "Local user");
  const { migrateLegacyCatalog } = await import("./catalog-migration.ts");
  await migrateLegacyCatalog();
}
