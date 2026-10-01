import pg from "pg";
import { config } from "./config.ts";
export const db = new pg.Pool({ connectionString: config.databaseUrl });
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
}
