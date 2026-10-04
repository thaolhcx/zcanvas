import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { createApp } from "../src/app.ts";
import { migrate } from "../src/db.ts";
import { startQueue, boss } from "../src/queue.ts";
import { type App, png, upload } from "./helpers.ts";
// Keeps contracts/examples/assets in step with the live API so FE, storage
// and search work can build against the fixtures.
const dir = new URL("../../contracts/examples/assets/", import.meta.url);
const load = async (name: string) =>
  JSON.parse(await readFile(new URL(name, dir), "utf8"));
const ASSET_REQUIRED = [
  "id",
  "kind",
  "mime",
  "bytes",
  "url",
  "meta",
  "createdAt",
];
const ASSET_KEYS = new Set([
  ...ASSET_REQUIRED,
  "thumbUrl",
  "createdBy",
  "name",
  "spaceId",
  "creatorId",
  "source",
  "status",
  "previewStatus",
  "description",
  "tags",
  "generation",
  "updatedAt",
  "deletedAt",
  "kept",
]);
function checkAsset(asset: Record<string, unknown>) {
  for (const key of ASSET_REQUIRED) expect(asset, key).toHaveProperty(key);
  for (const key of Object.keys(asset))
    expect(ASSET_KEYS.has(key), `unexpected ${key}`).toBe(true);
  expect(["image", "video", "audio"]).toContain(asset.kind);
  if (asset.status)
    expect(["uploading", "processing", "ready", "failed", "deleted"]).toContain(
      asset.status,
    );
  if (asset.previewStatus)
    expect(["none", "pending", "ready", "failed"]).toContain(
      asset.previewStatus,
    );
}
let app: App;
beforeAll(async () => {
  await migrate();
  await startQueue();
  app = await createApp();
});
afterAll(async () => {
  await app?.close();
  await boss.stop({ graceful: false });
});
describe("asset API fixtures", () => {
  it("every fixture has a valid shape", async () => {
    const names = await readdir(dir);
    expect(names.length).toBeGreaterThanOrEqual(15);
    for (const name of names.filter(
      (n) => n.startsWith("asset-") && !n.includes("410"),
    ))
      checkAsset(await load(name));
    for (const name of ["list.json", "list-empty.json"]) {
      const list = await load(name);
      expect(Object.keys(list).sort()).toEqual([
        "items",
        "nextCursor",
        "spaceId",
      ]);
      list.items.forEach(checkAsset);
    }
    for (const name of names.filter((n) => n.startsWith("search-"))) {
      const result = await load(name);
      expect(Object.keys(result).sort()).toEqual([
        "items",
        "limit",
        "mode",
        "query",
        "semantic",
        "spaceId",
      ]);
      expect([
        "ok",
        "disabled",
        "unavailable",
        "timeout",
        "indexing",
      ]).toContain(result.semantic.state);
      expect(result.mode === "hybrid").toBe(
        ["ok", "indexing"].includes(result.semantic.state),
      );
      for (const hit of result.items) checkAsset(hit.asset);
    }
    for (const name of names.filter(
      (n) => n.startsWith("error-") || n.includes("410"),
    ))
      expect(Object.keys(await load(name))).toEqual(
        expect.arrayContaining(["error", "code"]),
      );
    // Legacy assets may lack every optional catalog field except the ones the migration fills.
    const legacy = await load("asset-legacy-missing-metadata.json");
    expect(legacy.generation).toBeUndefined();
    expect(legacy.thumbUrl).toBeUndefined();
  });
  it("matches live responses", async () => {
    const live = (await upload(app, await png("fixture-check.png"))).json();
    checkAsset(live);
    const list = (await app.inject("/assets?limit=1")).json();
    expect(Object.keys(list).sort()).toEqual([
      "items",
      "nextCursor",
      "spaceId",
    ]);
    const search = (await app.inject("/assets/search?q=fixture")).json();
    expect(Object.keys(search).sort()).toEqual([
      "items",
      "limit",
      "mode",
      "query",
      "semantic",
      "spaceId",
    ]);
    const deleted = (
      await app.inject({ method: "DELETE", url: `/assets/${live.id}` })
    ).json();
    expect(Object.keys(deleted).sort()).toEqual(
      Object.keys(await load("delete.json")).sort(),
    );
    const gone = (await app.inject(`/assets/${live.id}`)).json();
    expect(Object.keys(gone.details.asset).sort()).toEqual(
      Object.keys((await load("asset-deleted-410.json")).details.asset).sort(),
    );
  });
});
