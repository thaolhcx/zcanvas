import { beforeAll, afterAll, describe, it, expect, afterEach } from "vitest";
import { createApp } from "../src/app.ts";
import { migrate, db } from "../src/db.ts";
import { checkStorage } from "../src/storage.ts";
import { boss, startQueue } from "../src/queue.ts";
import { putAsset } from "../src/assets.ts";
import { config } from "../src/config.ts";
import { personalSpaceId } from "../src/access.ts";
import { hashProvider, type EmbeddingProvider } from "../src/embeddings.ts";
import {
  indexAsset,
  reindex,
  searchAssets,
  searchText,
  setEmbeddingProvider,
  writeIndexEntry,
} from "../src/search.ts";
import type { Asset, AssetSearchResponse } from "../../contracts/index.ts";
import { type App, fixture, teamSpace } from "./helpers.ts";
// Deterministic hash embeddings: they prove plumbing, ordering and access
// rules only. Search quality is measured with real embeddings in
// scripts/search-eval.ts (docs/evidence/search-eval.json).
let app: App, other: App, space: string, otherSpace: string;
const otherId = `usr_search_${crypto.randomUUID().slice(0, 8)}`;
const base = hashProvider();
const make = async (
  spaceId: string,
  name: string,
  extra: {
    description?: string;
    prompt?: string;
    kind?: "image" | "audio";
    unkept?: boolean;
  } = {},
) => {
  const audio = extra.kind === "audio";
  const data = await fixture(audio ? "voice.wav" : "portrait.png");
  const asset = await putAsset(
    new Blob([new Uint8Array(data)], {
      type: audio ? "audio/wav" : "image/png",
    }),
    {
      spaceId,
      creatorId: "usr_local",
      name,
      source: extra.prompt ? { type: "generated" } : { type: "upload" },
      ...(extra.prompt
        ? {
            generation: {
              nodeType: "image.generate",
              typeVersion: 1,
              prompt: extra.prompt,
            },
          }
        : {}),
      publish: "ready",
    },
  );
  // Search covers the library: results there are kept ones (D5).
  if (extra.prompt && !extra.unkept)
    await db.query("UPDATE assets SET kept=true WHERE id=$1", [asset.id]);
  if (extra.description)
    await db.query("UPDATE assets SET description=$2 WHERE id=$1", [
      asset.id,
      extra.description,
    ]);
  await indexAsset(asset.id);
  return asset;
};
const search = async (target: App, query: string) => {
  const response = await target.inject(`/assets/search?${query}`);
  expect(response.statusCode).toBe(200);
  return response.json<AssetSearchResponse>();
};
const ids = (response: AssetSearchResponse) =>
  response.items.map((h) => h.asset.id);
beforeAll(async () => {
  await migrate();
  await checkStorage();
  await startQueue();
  setEmbeddingProvider(base);
  app = await createApp();
  other = await createApp({ actorId: otherId });
  space = await teamSpace({ usr_local: "owner" });
  otherSpace = personalSpaceId(otherId);
});
afterEach(() => setEmbeddingProvider(base));
afterAll(async () => {
  await app?.close();
  await other?.close();
  await boss.stop({ graceful: false });
});
describe("revoked access", () => {
  it("hides a space from a removed member everywhere, even with a cached query", async () => {
    const shared = await teamSpace({ usr_local: "owner", [otherId]: "viewer" });
    const asset = await make(shared, "IMG_7001.png", {
      prompt: "harbour lights reflected in the rain",
    });
    const canvasId = `rcp_${crypto.randomUUID()}`;
    await db.query(
      "INSERT INTO canvases(id,name,space_id) VALUES($1,'Shared',$2)",
      [canvasId, shared],
    );
    const before = await search(other, `spaceId=${shared}&q=harbour`);
    expect(ids(before)).toContain(asset.id);
    expect(
      (await other.inject(`/assets/${asset.id}/thumbnail`)).statusCode,
    ).toBe(200);
    await db.query(
      "DELETE FROM space_members WHERE space_id=$1 AND user_id=$2",
      [shared, otherId],
    );
    // Same query again: its vector is cached, but results never are.
    for (const path of [
      `/assets/search?spaceId=${shared}&q=harbour`,
      `/assets?spaceId=${shared}`,
      `/assets/${asset.id}`,
      `/assets/${asset.id}/file`,
      `/assets/${asset.id}/thumbnail`,
      `/assets/${asset.id}/usage?canvasId=${canvasId}`,
      `/canvases/${canvasId}`,
    ]) {
      const response = await other.inject(path);
      expect(response.statusCode, path).toBe(404);
      expect(response.body, path).not.toContain("harbour");
      expect(response.body, path).not.toContain("IMG_7001");
    }
    await expect(
      searchAssets({ id: otherId }, { q: "harbour", spaceId: shared }),
    ).rejects.toMatchObject({ status: 404 });
    // The owner still sees it.
    expect(ids(await search(app, `spaceId=${shared}&q=harbour`))).toContain(
      asset.id,
    );
  });
});
describe("semantic search", () => {
  let lighthouse: Asset, cat: Asset, exact: Asset, sound: Asset;
  beforeAll(async () => {
    lighthouse = await make(space, "IMG_0042.png", {
      prompt: "lighthouse on a cliff at sunrise, ocean waves",
    });
    cat = await make(space, "IMG_0043.png", {
      description: "Con mèo đen ngủ trên ghế sofa",
    });
    exact = await make(space, "sunrise.png");
    sound = await make(space, "track01.wav", {
      kind: "audio",
      description: "ocean waves ambience",
    });
    await make(otherSpace, "IMG_9999.png", {
      prompt: "lighthouse on a cliff at sunrise",
    });
  });
  it("matches prompts and descriptions when the file name does not contain the query", async () => {
    const result = await search(app, `spaceId=${space}&q=lighthouse`);
    expect(result.mode).toBe("hybrid");
    expect(result.semantic.state).toBe("ok");
    expect(ids(result)[0]).toBe(lighthouse.id);
    expect(result.items[0]).toMatchObject({ matchedBy: ["semantic"] });
    const vietnamese = await search(
      app,
      `spaceId=${space}&q=${encodeURIComponent("mèo đen")}`,
    );
    expect(ids(vietnamese)[0]).toBe(cat.id);
  });
  it("keeps an exact file-name match first", async () => {
    const result = await search(app, `spaceId=${space}&q=sunrise`);
    expect(ids(result)[0]).toBe(exact.id);
    expect(result.items[0].matchedBy).toContain("name");
    expect(ids(result)).toContain(lighthouse.id);
  });
  it("applies media type and source filters inside retrieval", async () => {
    const audio = await search(app, `spaceId=${space}&q=ocean&kind=audio`);
    expect(ids(audio)).toEqual([sound.id]);
    const generated = await search(
      app,
      `spaceId=${space}&q=ocean&source=generated`,
    );
    expect(ids(generated)).toEqual([lighthouse.id]);
    const narrow = await search(app, `spaceId=${space}&q=lighthouse&limit=1`);
    expect(narrow.items).toHaveLength(1);
  });
  it("never returns other spaces' assets, in results or counts", async () => {
    const result = await search(app, `spaceId=${space}&q=lighthouse&limit=50`);
    for (const hit of result.items) expect(hit.asset.spaceId).toBe(space);
    expect(
      (await other.inject(`/assets/search?spaceId=${space}&q=lighthouse`))
        .statusCode,
    ).toBe(404);
    const theirs = await search(other, "q=lighthouse");
    expect(theirs.items.every((h) => h.asset.spaceId === otherSpace)).toBe(
      true,
    );
    expect(ids(theirs)).not.toContain(lighthouse.id);
  });
  it("drops deleted assets immediately, including after a cached query", async () => {
    const doomed = await make(space, "IMG_0100.png", {
      description: "purple umbrella in the rain",
    });
    expect(ids(await search(app, `spaceId=${space}&q=umbrella`))).toContain(
      doomed.id,
    );
    await app.inject({ method: "DELETE", url: `/assets/${doomed.id}` });
    // Same query again: the cached query vector must not bring the asset back.
    expect(ids(await search(app, `spaceId=${space}&q=umbrella`))).not.toContain(
      doomed.id,
    );
    const { rows } = await db.query(
      "SELECT 1 FROM asset_search_index WHERE asset_id=$1",
      [doomed.id],
    );
    expect(rows).toHaveLength(0);
  });
  it("follows renames and metadata edits; old jobs cannot overwrite newer revisions", async () => {
    const asset = await make(space, "IMG_0200.png", {
      description: "green bicycle",
    });
    expect(ids(await search(app, `spaceId=${space}&q=bicycle`))).toContain(
      asset.id,
    );
    const old = (
      await db.query("SELECT revision FROM assets WHERE id=$1", [asset.id])
    ).rows[0].revision;
    await app.inject({
      method: "PATCH",
      url: `/assets/${asset.id}`,
      payload: { description: "yellow kayak" },
    });
    // Until reindexed the stale entry is not used.
    expect(ids(await search(app, `spaceId=${space}&q=bicycle`))).not.toContain(
      asset.id,
    );
    expect((await search(app, `spaceId=${space}&q=kayak`)).semantic.state).toBe(
      "indexing",
    );
    expect(await indexAsset(asset.id)).toBe("indexed");
    expect(ids(await search(app, `spaceId=${space}&q=kayak`))).toContain(
      asset.id,
    );
    // A late job carrying the old revision is refused.
    const [stale] = await base.embed(["green bicycle"], "document");
    expect(await writeIndexEntry(asset.id, base.id, old, stale, "late")).toBe(
      false,
    );
    expect(ids(await search(app, `spaceId=${space}&q=kayak`))).toContain(
      asset.id,
    );
    // Retrying the same job is harmless.
    expect(await indexAsset(asset.id)).toBe("unchanged");
  });
  it("reindexes after a model change without mixing vectors", async () => {
    const next = hashProvider(128);
    setEmbeddingProvider(next);
    const before = await search(app, `spaceId=${space}&q=lighthouse`);
    expect(before.semantic).toMatchObject({
      state: "indexing",
      model: next.id,
    });
    expect(before.items.every((h) => !h.matchedBy.includes("semantic"))).toBe(
      true,
    );
    const queued = await reindex();
    expect(queued.queued).toBeGreaterThan(0);
    const { rows } = await db.query(
      "SELECT id FROM assets WHERE space_id=$1 AND status='ready'",
      [space],
    );
    for (const row of rows) await indexAsset(row.id);
    const after = await search(app, `spaceId=${space}&q=lighthouse`);
    expect(after.semantic.state).toBe("ok");
    expect(ids(after)[0]).toBe(lighthouse.id);
  });
  it("falls back to usable name search when embeddings fail or time out", async () => {
    const broken: EmbeddingProvider = {
      ...base,
      async embed() {
        throw new Error("provider down");
      },
    };
    setEmbeddingProvider(broken);
    const failed = await search(app, `spaceId=${space}&q=sunrise`);
    expect(failed.mode).toBe("name");
    expect(failed.semantic.state).toBe("unavailable");
    expect(ids(failed)[0]).toBe(exact.id);
    // Browse and upload still work.
    expect((await app.inject(`/assets?spaceId=${space}`)).statusCode).toBe(200);
    const slow: EmbeddingProvider = {
      ...base,
      embed: (_t, _p, signal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(signal.reason)),
        ),
    };
    setEmbeddingProvider(slow);
    const timeout = config.search.queryTimeoutMs;
    config.search.queryTimeoutMs = 150;
    try {
      const timed = await search(app, `spaceId=${space}&q=sunrise`);
      expect(timed.semantic.state).toBe("timeout");
      expect(ids(timed)[0]).toBe(exact.id);
      // An in-process model cannot be interrupted; the query still stops waiting.
      setEmbeddingProvider({
        ...base,
        embed: () => new Promise((resolve) => setTimeout(resolve, 2000)),
      });
      const started = Date.now();
      const stuck = await search(app, `spaceId=${space}&q=sunset glow`);
      expect(stuck.semantic.state).toBe("timeout");
      expect(Date.now() - started).toBeLessThan(1500);
    } finally {
      config.search.queryTimeoutMs = timeout;
    }
    setEmbeddingProvider(undefined);
    const disabled = await search(app, `spaceId=${space}&q=sunrise`);
    expect(disabled).toMatchObject({
      mode: "name",
      semantic: { state: "disabled" },
    });
  });
  it("records index failures without blocking the asset", async () => {
    const broken: EmbeddingProvider = {
      ...base,
      async embed() {
        throw new Error("quota exceeded");
      },
    };
    setEmbeddingProvider(broken);
    const asset = await putAsset(
      new Blob([new Uint8Array(await fixture("portrait.png"))], {
        type: "image/png",
      }),
      {
        spaceId: space,
        creatorId: "usr_local",
        name: "fails.png",
        source: { type: "upload" },
        publish: "ready",
      },
    );
    await expect(indexAsset(asset.id)).rejects.toThrow("quota exceeded");
    const { rows } = await db.query(
      "SELECT state, error FROM asset_search_index WHERE asset_id=$1 AND model=$2",
      [asset.id, broken.id],
    );
    expect(rows[0]).toMatchObject({ state: "failed", error: "quota exceeded" });
    expect((await app.inject(`/assets/${asset.id}`)).json().status).toBe(
      "ready",
    );
  });
  it("validates and bounds queries", async () => {
    for (const bad of [
      "q=",
      `q=${"x".repeat(201)}`,
      "q=a&limit=51",
      "q=a&limit=0",
      "q=a&kind=pdf",
      "q=a&userId=x",
    ])
      expect(
        (await app.inject(`/assets/search?spaceId=${space}&${bad}`)).statusCode,
      ).toBe(400);
  });
  it("builds search text only from metadata, never media", () => {
    expect(
      searchText({
        name: "IMG_0042.png",
        kind: "image",
        description: "A cliff",
        tags: ["coast"],
        generation: {
          nodeType: "image.generate",
          typeVersion: 1,
          prompt: "lighthouse",
          references: [{ name: "ref.png", id: "ast_ref", port: "image" }],
        },
      }),
    ).toBe("IMG 0042\nimage\nA cliff\ncoast\nlighthouse\nref.png");
  });
  it("searches directly through the service with the same rules", async () => {
    const result = await searchAssets(
      { id: "usr_local" },
      { q: "lighthouse", spaceId: space },
    );
    expect(result.items[0].asset.id).toBe(lighthouse.id);
    await expect(
      searchAssets({ id: otherId }, { q: "lighthouse", spaceId: space }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
describe("kept results (D5)", () => {
  it("finds a result that is not kept only with kept=all", async () => {
    const space = await teamSpace({ usr_local: "owner" });
    const loose = await make(space, "IMG_loose.png", {
      prompt: "a lantern floating over a dark lake",
      unkept: true,
    });
    const shown = await search(app, `spaceId=${space}&q=lantern`);
    expect(ids(shown)).not.toContain(loose.id);
    const all = await search(app, `spaceId=${space}&q=lantern&kept=all`);
    expect(ids(all)).toContain(loose.id);
    const listed = (await app.inject(`/assets?spaceId=${space}`)).json();
    expect(listed.items.map((a: { id: string }) => a.id)).not.toContain(
      loose.id,
    );
    const every = (
      await app.inject(`/assets?spaceId=${space}&kept=all`)
    ).json();
    expect(every.items.map((a: { id: string }) => a.id)).toContain(loose.id);
    const kept = await app.inject({
      method: "POST",
      url: `/assets/${loose.id}/keep`,
    });
    expect(kept.json().kept).toBe(true);
    const after = (await app.inject(`/assets?spaceId=${space}`)).json();
    expect(after.items.map((a: { id: string }) => a.id)).toContain(loose.id);
    expect(
      (
        await app.inject({ method: "POST", url: `/assets/${loose.id}/unkeep` })
      ).json().kept,
    ).toBe(false);
  });
});
