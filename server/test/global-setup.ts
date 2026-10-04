import pg from "pg";
import { TEST_DATABASE_URL } from "../../vitest.config.ts";

/**
 * Tests run on their own database so a running dev runner never picks up their
 * pg-boss jobs and their runs never show in the dev user's Studio (#25 review).
 * Creates it on first use; migrate() in each suite builds the tables.
 */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[\w-]+$/.test(name))
    throw new Error(`Unexpected test database name: ${name}`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT 1 FROM pg_database WHERE datname=$1",
      [name],
    );
    if (!rows.length) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}
