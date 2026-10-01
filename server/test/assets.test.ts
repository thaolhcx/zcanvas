import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { request as httpRequest } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createApp } from "../src/app.ts";
import { migrate, db } from "../src/db.ts";
import {
  checkStorage,
  LocalStore,
  registerStore,
  storeFor,
} from "../src/storage.ts";
import { generationInfo, startRunner } from "../src/runner.ts";
import { personalSpaceId } from "../src/access.ts";
import {
  cleanupAsset,
  deriveAsset,
  failJobAssets,
  publishJobAssets,
  putAsset,
  spool,
} from "../src/assets.ts";
import {
  migrateLegacyCatalog,
  assignUnmappedAssets,
} from "../src/catalog-migration.ts";
import type {
  Asset,
  AssetListResponse,
  Recipe,
  Run,
} from "../../contracts/index.ts";
import {
  type App,
  fixture,
  multipart,
  newCanvas,
  png,
  teamSpace,
  until,
  upload,
} from "./helpers.ts";
let app: App, other: App, stop: () => Promise<void>, url: string;
const otherId = `usr_other_${crypto.randomUUID().slice(0, 8)}`;
const recipeWith = (assetId: string, version = 1): Recipe => ({
  schema: "recipe/v1",
  meta: {
    id: `rcp_${crypto.randomUUID()}`,
    name: "Asset flow",
    version,
    registryVersion: "2026.09.1",
  },
  nodes: [
    {
      id: "n_asset",
      type: "input.asset",
      typeVersion: 1,
      position: { x: 0, y: 0 },
      params: { asset: assetId },
    },
    {
      id: "n_edit",
      type: "image.edit",
      typeVersion: 1,
      position: { x: 300, y: 0 },
      params: { mode: "upscale", scale: 2 },
    },
  ],
  edges: [
    {
      id: "e1",
      source: "n_asset",
      sourcePort: "asset",
      target: "n_edit",
      targetPort: "image",
    },
  ],
  groups: [],
});
const promptRecipe = (text: string): Recipe => ({
  schema: "recipe/v1",
  meta: {
    id: `rcp_${crypto.randomUUID()}`,
    name: "Prompt flow",
    version: 1,
    registryVersion: "2026.09.1",
  },
  nodes: [
    {
      id: "n_prompt",
      type: "input.prompt",
      typeVersion: 1,
      position: { x: 0, y: 0 },
      params: { text },
    },
    {
      id: "n_img",
      type: "image.generate",
      typeVersion: 1,
      position: { x: 300, y: 0 },
      params: { model: "flux-2", aspect: "1:1", count: 1 },
    },
  ],
  edges: [
    {
      id: "e1",
      source: "n_prompt",
      sourcePort: "text",
      target: "n_img",
      targetPort: "prompt",
    },
  ],
  groups: [],
});
const startRun = (target: App, recipe: Recipe, canvasId: string) =>
  target.inject({
    method: "POST",
    url: "/runs",
    payload: { recipe, canvasId, graphVersion: recipe.meta.version },
  });
const finish = async (target: App, runId: string) =>
  until(async () => {
    const run = (await target.inject(`/runs/${runId}`)).json<Run>();
    return run.status !== "running" && run;
  }, 30000) as Promise<Run>;
/** Saves a canvas snapshot as the sync server would. */
const saveSnapshot = (canvasId: string, recipe: Recipe) =>
  db.query("UPDATE canvases SET snapshot=$2 WHERE id=$1", [canvasId, recipe]);
beforeAll(async () => {
  await migrate();
  await checkStorage();
  stop = await startRunner();
  app = await createApp();
  other = await createApp({ actorId: otherId });
  url = await app.listen({ host: "127.0.0.1", port: 0 });
});
afterAll(async () => {
  await app?.close();
  await other?.close();
  await stop?.();
});
describe("catalog", () => {
  it("uploads into the personal space with stable ID, name and source", async () => {
    const response = await upload(app, await png("Portrait Ảnh.png"));
    expect(response.statusCode).toBe(201);
    const asset = response.json<Asset>();
    expect(asset).toMatchObject({
      kind: "image",
      mime: "image/png",
      name: "Portrait Ảnh.png",
      spaceId: personalSpaceId("usr_local"),
      creatorId: "usr_local",
      source: { type: "upload" },
      status: "ready",
      meta: { width: 720, height: 1280 },
    });
    expect(asset.id).toMatch(/^ast_/);
    const detail = (await app.inject(`/assets/${asset.id}`)).json<Asset>();
    expect(detail.id).toBe(asset.id);
    const listed = (
      await app.inject(`/assets?q=${encodeURIComponent("ảnh")}`)
    ).json<AssetListResponse>();
    expect(listed.items.map((a) => a.id)).toContain(asset.id);
    // Image thumbnails are made during upload.
    expect(asset.previewStatus).toBe("ready");
    const ready = await app.inject(`/assets/${asset.id}/thumbnail`);
    expect(ready.headers["content-type"]).toBe("image/jpeg");
    expect(ready.headers["x-preview-status"]).toBeUndefined();
    expect(ready.rawPayload.length).toBeLessThan(asset.bytes);
  });
  it("never blocks a valid original behind a missing preview", async () => {
    const image = (await upload(app, await png())).json<Asset>();
    await db.query("UPDATE assets SET preview_status='failed' WHERE id=$1", [
      image.id,
    ]);
    const fallback = await app.inject(`/assets/${image.id}/thumbnail`);
    expect(fallback.statusCode).toBe(200);
    expect(fallback.headers["x-preview-status"]).toBe("failed");
    expect(fallback.headers["content-type"]).toBe("image/png");
    // Video posters are built in the background with a clear status meanwhile.
    const video = (
      await upload(app, {
        name: "clip.mp4",
        type: "video/mp4",
        data: await fixture("clip.mp4"),
      })
    ).json<Asset>();
    expect(video).toMatchObject({ kind: "video", meta: { durationSec: 12 } });
    if (video.previewStatus === "pending") {
      const pending = await app.inject(`/assets/${video.id}/thumbnail`);
      expect([200, 404]).toContain(pending.statusCode);
    }
    await until(
      async () =>
        (await app.inject(`/assets/${video.id}`)).json<Asset>()
          .previewStatus === "ready",
    );
    const poster = await app.inject(`/assets/${video.id}/thumbnail`);
    expect(poster.headers["content-type"]).toBe("image/jpeg");
    await db.query("UPDATE assets SET preview_status='failed' WHERE id=$1", [
      video.id,
    ]);
    expect(
      (await app.inject(`/assets/${video.id}/thumbnail`)).json().code,
    ).toBe("PREVIEW_FAILED");
    expect((await app.inject(`/assets/${video.id}/file`)).statusCode).toBe(200);
  });
  it("uploads into a canvas space and rejects unreadable or unsupported files", async () => {
    const team = await teamSpace({ usr_local: "editor" });
    const { canvasId } = await newCanvas(app, { spaceId: team });
    const asset = (
      await upload(app, await png(), `?canvasId=${canvasId}`)
    ).json<Asset>();
    expect(asset).toMatchObject({
      spaceId: team,
      source: { type: "upload", canvasId },
    });
    const bad = await upload(app, {
      name: "x.png",
      type: "image/png",
      data: Buffer.from("not an image"),
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("UNSUPPORTED_MEDIA");
    const text = await upload(app, {
      name: "x.txt",
      type: "text/plain",
      data: Buffer.from("hello"),
    });
    expect(text.statusCode).toBe(415);
    const mismatch = await upload(
      app,
      await png(),
      `?canvasId=${canvasId}&spaceId=${personalSpaceId("usr_local")}`,
    );
    expect(mismatch.statusCode).toBe(400);
  });
  it("paginates with a stable tie-breaker when timestamps are identical", async () => {
    const team = await teamSpace({ usr_local: "owner" });
    const ids: string[] = [];
    for (let i = 0; i < 7; i++)
      ids.push(
        (
          await upload(
            app,
            await png(i % 2 ? "same.png" : `name ${i}.png`),
            `?spaceId=${team}`,
          )
        ).json<Asset>().id,
      );
    await db.query(
      "UPDATE assets SET created_at='2026-01-01T00:00:00.123456Z' WHERE id = ANY($1)",
      [ids],
    );
    for (const [sort, expected] of [
      ["created_desc", [...ids].sort().reverse()],
      ["created_asc", [...ids].sort()],
    ] as const) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: AssetListResponse = (
          await app.inject(
            `/assets?spaceId=${team}&limit=2&sort=${sort}${cursor ? `&cursor=${cursor}` : ""}`,
          )
        ).json();
        expect(page.items.length).toBeLessThanOrEqual(2);
        seen.push(...page.items.map((a) => a.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toEqual(expected);
    }
    const byName: string[] = [];
    let cursor: string | null = null;
    do {
      const page: AssetListResponse = (
        await app.inject(
          `/assets?spaceId=${team}&limit=3&sort=name_asc${cursor ? `&cursor=${cursor}` : ""}`,
        )
      ).json();
      byName.push(...page.items.map((a) => a.name!));
      cursor = page.nextCursor;
    } while (cursor);
    expect(byName).toEqual([
      "name 0.png",
      "name 2.png",
      "name 4.png",
      "name 6.png",
      "same.png",
      "same.png",
      "same.png",
    ]);
    // Boundary: a page exactly at the end has no next cursor.
    const exact = (
      await app.inject(`/assets?spaceId=${team}&limit=7`)
    ).json<AssetListResponse>();
    expect(exact.items).toHaveLength(7);
    expect(exact.nextCursor).toBeNull();
    // Filters and validation.
    expect(
      (await app.inject(`/assets?spaceId=${team}&kind=video`)).json().items,
    ).toHaveLength(0);
    expect(
      (await app.inject(`/assets?spaceId=${team}&source=upload`)).json().items,
    ).toHaveLength(7);
    expect(
      (await app.inject(`/assets?spaceId=${team}&q=%25`)).json().items,
    ).toHaveLength(0);
    for (const bad of [
      "limit=0",
      "limit=101",
      "kind=pdf",
      "sort=size",
      "cursor=nope",
      "source=stock",
    ])
      expect(
        (await app.inject(`/assets?spaceId=${team}&${bad}`)).json().code,
      ).toBe("VALIDATION");
  });
  it("renames without breaking graph references and validates metadata", async () => {
    const asset = (await upload(app, await png())).json<Asset>();
    const renamed = await app.inject({
      method: "PATCH",
      url: `/assets/${asset.id}`,
      payload: {
        name: "  Hero / shot.png ",
        description: "Main character",
        tags: ["hero", "hero", "red"],
      },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({
      id: asset.id,
      name: "Hero shot.png",
      description: "Main character",
      tags: ["hero", "red"],
    });
    expect(renamed.json().url).toBe(asset.url);
    for (const payload of [{ name: "" }, { size: 1 }, { tags: "x" }, {}])
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: `/assets/${asset.id}`,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    const { canvasId } = await newCanvas(app);
    const run = await startRun(app, recipeWith(asset.id), canvasId);
    expect(run.statusCode).toBe(201);
    const done = await finish(app, run.json<Run>().runId);
    expect(done.status).toBe("done");
    expect(
      (done.jobs.find((j) => j.nodeId === "n_asset")!.outputs!.asset as Asset)
        .name,
    ).toBe("Hero shot.png");
  });
});
describe("generated outputs", () => {
  it("land in the canvas space with source and generation history", async () => {
    const team = await teamSpace({ usr_local: "editor" });
    const { canvasId } = await newCanvas(app, { spaceId: team });
    const prompt = `A lighthouse at dawn ${crypto.randomUUID()}`;
    const first = await finish(
      app,
      (await startRun(app, promptRecipe(prompt), canvasId)).json<Run>().runId,
    );
    expect(first.status).toBe("done");
    const job = first.jobs.find((j) => j.nodeId === "n_img")!;
    const output = (job.outputs!.image as Asset[])[0];
    const detail = (await app.inject(`/assets/${output.id}`)).json<Asset>();
    expect(detail).toMatchObject({
      spaceId: team,
      creatorId: "usr_local",
      status: "ready",
      source: {
        type: "generated",
        canvasId,
        runId: first.runId,
        nodeId: "n_img",
      },
      createdBy: { runId: first.runId, nodeId: "n_img" },
      generation: {
        nodeType: "image.generate",
        prompt,
        prompts: { prompt },
        model: "flux-2",
        settings: { aspect: "1:1", count: 1 },
        provider: { name: "mock", model: "mock:image" },
      },
    });
    const list = (
      await app.inject(`/assets?spaceId=${team}&source=generated`)
    ).json<AssetListResponse>();
    expect(list.items.map((a) => a.id)).toContain(output.id);
    // Editing the node later does not rewrite the older output's history.
    await finish(
      app,
      (
        await startRun(app, promptRecipe(`${prompt} at night`), canvasId)
      ).json<Run>().runId,
    );
    expect(
      (await app.inject(`/assets/${output.id}`)).json<Asset>().generation
        ?.prompt,
    ).toBe(prompt);
  });
  it("saves reference names as plain text, with their IDs and ports", async () => {
    const asset = (
      await upload(app, await png("reference-girl.png"))
    ).json<Asset>();
    const { canvasId } = await newCanvas(app);
    const run = await finish(
      app,
      (await startRun(app, recipeWith(asset.id), canvasId)).json<Run>().runId,
    );
    const edited = run.jobs.find((j) => j.nodeId === "n_edit")!.outputs!
      .image as Asset;
    await app.inject({
      method: "PATCH",
      url: `/assets/${asset.id}`,
      payload: { name: "renamed.png" },
    });
    const detail = (await app.inject(`/assets/${edited.id}`)).json<Asset>();
    expect(detail.generation?.references).toEqual([
      { name: "reference-girl.png", id: asset.id, port: "image" },
    ]);
  });
  it("keeps prompts by port, structured settings and what the provider reported", () => {
    const node = {
      id: "n",
      type: "image.generate",
      typeVersion: 2,
      position: { x: 0, y: 0 },
      params: {},
    };
    const ref = {
      id: "ast_ref",
      name: "pose.png",
      kind: "image" as const,
      mime: "image/png",
      bytes: 1,
      url: "",
      meta: {},
      createdAt: "",
    };
    const info = generationInfo(
      node,
      {
        model: "flux-2",
        size: { width: 1024, height: 768 },
        loras: ["ink", "film"],
        prompt: "ignored when a text input is connected",
      },
      {
        prompt: { value: "a lighthouse" },
        negative: { value: "blurry" },
        image: [ref],
      },
      {
        name: "acme",
        model: "flux-2-pro-0901",
        seed: 7,
        requestId: "req_1",
        apiKey: "never stored",
      },
    );
    expect(info).toEqual({
      nodeType: "image.generate",
      typeVersion: 2,
      prompt: "a lighthouse\nblurry",
      prompts: { prompt: "a lighthouse", negative: "blurry" },
      model: "flux-2",
      settings: { size: { width: 1024, height: 768 }, loras: ["ink", "film"] },
      references: [{ name: "pose.png", id: "ast_ref", port: "image" }],
      provider: {
        name: "acme",
        model: "flux-2-pro-0901",
        seed: 7,
        requestId: "req_1",
      },
    });
    expect(
      generationInfo(node, { prompt: "from the param" }, {}),
    ).toMatchObject({
      prompt: "from the param",
      prompts: { prompt: "from the param" },
    });
    // Oversized values are cut and marked, never silently dropped.
    const big = generationInfo(
      node,
      { steps: 30, curve: Array.from({ length: 5000 }, (_, i) => i) },
      { prompt: { value: "x".repeat(5000) } },
      { model: "no name" },
    );
    expect(big.prompt).toHaveLength(4000);
    expect(big.settings).toEqual({ steps: 30 });
    expect(big.truncated?.sort()).toEqual(["prompt", "settings"]);
    expect(big.provider).toBeUndefined();
  });
  it("migrates reference names saved as plain strings, and reruns safely", async () => {
    const id = `ast_${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO assets(id, catalog_version, space_id, source_type, name, kind, mime, bytes, status, preview_status, generation)
       VALUES($1,1,$2,'generated','old.png','image','image/png',0,'ready','none',$3)`,
      [
        id,
        personalSpaceId("usr_local"),
        {
          nodeType: "image.edit",
          typeVersion: 1,
          references: ["a.png", "b.png"],
        },
      ],
    );
    await migrate();
    await migrate();
    const { rows } = await db.query(
      "SELECT generation FROM assets WHERE id=$1",
      [id],
    );
    expect(rows[0].generation.references).toEqual([
      { name: "a.png" },
      { name: "b.png" },
    ]);
  });
  it("never publishes outputs of a job that did not finish", async () => {
    const jobId = `job_${crypto.randomUUID()}`;
    const make = () =>
      fixture("portrait.png").then((data) =>
        putAsset(new Blob([new Uint8Array(data)], { type: "image/png" }), {
          spaceId: personalSpaceId("usr_local"),
          creatorId: "usr_local",
          name: "pending.png",
          source: { type: "generated", jobId },
          publish: "processing",
        }),
      );
    const failed = await make();
    expect(failed.status).toBe("processing");
    expect(
      (await app.inject(`/assets?q=pending.png`))
        .json()
        .items.map((a: Asset) => a.id),
    ).not.toContain(failed.id);
    await failJobAssets(jobId);
    expect((await app.inject(`/assets/${failed.id}`)).statusCode).toBe(404);
    const ok = await make();
    await publishJobAssets(jobId);
    expect((await app.inject(`/assets/${ok.id}`)).json().status).toBe("ready");
    expect((await app.inject(`/assets/${failed.id}`)).statusCode).toBe(404);
  });
  it("cancelled runs leave no ready assets from unfinished jobs", async () => {
    const { canvasId } = await newCanvas(app);
    const run = (
      await startRun(
        app,
        promptRecipe(`cancel ${crypto.randomUUID()}`),
        canvasId,
      )
    ).json<Run>();
    await app.inject({ method: "POST", url: `/runs/${run.runId}/cancel` });
    await new Promise((r) => setTimeout(r, 800));
    const { rows } = await db.query(
      `SELECT a.status FROM assets a LEFT JOIN jobs j ON j.id=a.source_job_id
       WHERE a.source_run_id=$1 AND a.status='ready' AND (j.data->>'status') IS DISTINCT FROM 'done'`,
      [run.runId],
    );
    expect(rows).toHaveLength(0);
  });
});
describe("access", () => {
  it("isolates spaces on list, detail, files, thumbnails, usage, writes and runs", async () => {
    const asset = (await upload(app, await png("private.png"))).json<Asset>();
    const { canvasId } = await newCanvas(app);
    const mine = personalSpaceId("usr_local");
    expect((await other.inject(`/assets?spaceId=${mine}`)).statusCode).toBe(
      404,
    );
    expect(
      (await other.inject(`/assets/search?q=private&spaceId=${mine}`))
        .statusCode,
    ).toBe(404);
    for (const path of [
      "",
      "/file",
      "/thumbnail",
      `/usage?canvasId=${canvasId}`,
    ])
      expect(
        (await other.inject(`/assets/${asset.id}${path}`)).statusCode,
      ).toBe(404);
    expect(
      (await other.inject({ method: "HEAD", url: `/assets/${asset.id}/file` }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await other.inject({
          method: "PATCH",
          url: `/assets/${asset.id}`,
          payload: { name: "x" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await other.inject({ method: "DELETE", url: `/assets/${asset.id}` }))
        .statusCode,
    ).toBe(404);
    expect(
      (await upload(other, await png(), `?spaceId=${mine}`)).statusCode,
    ).toBe(404);
    expect(
      (await upload(other, await png(), `?canvasId=${canvasId}`)).statusCode,
    ).toBe(404);
    expect((await other.inject(`/canvases/${canvasId}`)).statusCode).toBe(404);
    expect(
      (await other.inject("/canvases")).json().map((c: { id: string }) => c.id),
    ).not.toContain(canvasId);
    // Their own list does not include our asset, and our asset cannot enter their graph.
    expect(
      (await other.inject("/assets")).json().items.map((a: Asset) => a.id),
    ).not.toContain(asset.id);
    const theirs = await newCanvas(other);
    const crossed = await startRun(
      other,
      recipeWith(asset.id),
      theirs.canvasId,
    );
    expect(crossed.statusCode).toBe(422);
    expect(crossed.json()[0]).toMatchObject({
      code: "INPUT_REQUIRED",
      nodeId: "n_asset",
      paramKey: "asset",
    });
    // Nor can they run our canvas or read our runs.
    expect(
      (await startRun(other, recipeWith(asset.id), canvasId)).statusCode,
    ).toBe(404);
    const ours = (
      await startRun(app, recipeWith(asset.id), canvasId)
    ).json<Run>();
    expect((await other.inject(`/runs/${ours.runId}`)).statusCode).toBe(404);
    expect((await other.inject(`/runs?canvasId=${canvasId}`)).statusCode).toBe(
      404,
    );
    expect(
      (
        await other.inject({
          method: "POST",
          url: `/runs/${ours.runId}/cancel`,
        })
      ).statusCode,
    ).toBe(404);
    await finish(app, ours.runId);
    // The client cannot pick an identity: there is no such parameter.
    expect(
      (await other.inject(`/assets?spaceId=${mine}&userId=usr_local`))
        .statusCode,
    ).toBe(404);
  });
  it("shares a team space with members and keeps viewers read-only", async () => {
    const team = await teamSpace({ usr_local: "owner", [otherId]: "viewer" });
    const asset = (
      await upload(app, await png("team.png"), `?spaceId=${team}`)
    ).json<Asset>();
    expect(
      (await other.inject(`/assets?spaceId=${team}`))
        .json()
        .items.map((a: Asset) => a.id),
    ).toContain(asset.id);
    expect((await other.inject(`/assets/${asset.id}/file`)).statusCode).toBe(
      200,
    );
    const spaces = (await other.inject("/spaces")).json();
    expect(
      spaces.spaces.find((s: { id: string }) => s.id === team),
    ).toMatchObject({ kind: "team", role: "viewer" });
    expect(
      (
        await other.inject({
          method: "PATCH",
          url: `/assets/${asset.id}`,
          payload: { name: "x" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await other.inject({ method: "DELETE", url: `/assets/${asset.id}` }))
        .statusCode,
    ).toBe(403);
    expect(
      (await upload(other, await png(), `?spaceId=${team}`)).statusCode,
    ).toBe(403);
    expect(
      (
        await other.inject({
          method: "POST",
          url: "/canvases",
          payload: { name: "x", spaceId: team },
        })
      ).statusCode,
    ).toBe(403);
  });
});
describe("delivery", () => {
  let asset: Asset;
  beforeAll(async () => {
    asset = (
      await upload(app, {
        name: "voice.wav",
        type: "audio/wav",
        data: await fixture("voice.wav"),
      })
    ).json<Asset>();
  });
  it("serves full, ranged, suffix and HEAD responses with validators", async () => {
    const full = await app.inject(`/assets/${asset.id}/file`);
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-length"]).toBe(String(asset.bytes));
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.headers["cache-control"]).toBe("private, no-cache");
    expect(full.headers["content-disposition"]).toContain(
      'inline; filename="voice.wav"',
    );
    const etag = full.headers.etag as string;
    const part = await app.inject({
      url: `/assets/${asset.id}/file`,
      headers: { range: "bytes=10-19" },
    });
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 10-19/${asset.bytes}`);
    expect(part.rawPayload).toEqual(full.rawPayload.subarray(10, 20));
    const open = await app.inject({
      url: `/assets/${asset.id}/file`,
      headers: { range: `bytes=${asset.bytes - 5}-` },
    });
    expect(open.rawPayload).toEqual(full.rawPayload.subarray(asset.bytes - 5));
    const suffix = await app.inject({
      url: `/assets/${asset.id}/file`,
      headers: { range: "bytes=-4" },
    });
    expect(suffix.statusCode).toBe(206);
    expect(suffix.rawPayload).toEqual(
      full.rawPayload.subarray(asset.bytes - 4),
    );
    const invalid = await app.inject({
      url: `/assets/${asset.id}/file`,
      headers: { range: `bytes=${asset.bytes}-` },
    });
    expect(invalid.statusCode).toBe(416);
    expect(invalid.headers["content-range"]).toBe(`bytes */${asset.bytes}`);
    const head = await app.inject({
      method: "HEAD",
      url: `/assets/${asset.id}/file`,
    });
    expect(head.statusCode).toBe(200);
    expect(head.headers["content-length"]).toBe(String(asset.bytes));
    expect(head.rawPayload.length).toBe(0);
    const cached = await app.inject({
      url: `/assets/${asset.id}/file`,
      headers: { "if-none-match": etag },
    });
    expect(cached.statusCode).toBe(304);
    const download = await app.inject(`/assets/${asset.id}/file?download=1`);
    expect(download.headers["content-disposition"]).toContain("attachment;");
    // Audio has no preview.
    expect((await app.inject(`/assets/${asset.id}/thumbnail`)).statusCode).toBe(
      404,
    );
  });
  it("stops reading from storage when the client disconnects", async () => {
    const big = Buffer.alloc(8 * 1024 * 1024, 7);
    const stored = await putAsset(
      new Blob(
        [new Uint8Array(await fixture("voice.wav")), new Uint8Array(big)],
        { type: "audio/wav" },
      ),
      {
        spaceId: personalSpaceId("usr_local"),
        creatorId: "usr_local",
        name: "big.wav",
        source: { type: "upload" },
        publish: "ready",
      },
    );
    const { storeFor } = await import("../src/storage.ts");
    const { objectFor } = await import("../src/assets.ts");
    const object = (await objectFor(stored.id, "original"))!;
    const store = storeFor(object.profile);
    const read = store.read.bind(store);
    let closed = false;
    store.read = async (key, options) => {
      const stream = await read(key, options);
      stream.on("close", () => (closed = true));
      return stream;
    };
    try {
      await new Promise<void>((resolve, reject) => {
        const req = httpRequest(`${url}/assets/${stored.id}/file`, (res) => {
          res.once("data", () => {
            req.destroy();
            resolve();
          });
        });
        req.on("error", () => {});
        req.end();
        setTimeout(() => reject(new Error("no data")), 5000);
      });
      await until(async () => closed, 5000);
      expect(closed).toBe(true);
    } finally {
      store.read = read;
    }
  });
  it("rejects malformed IDs before touching storage", async () => {
    expect(
      (await app.inject("/assets/..%2F..%2Fetc%2Fpasswd/file")).statusCode,
    ).toBe(400);
    expect((await app.inject("/assets/ast_x/other")).statusCode).toBe(404);
  });
});
describe("deletion", () => {
  it("lists affected nodes, blocks new runs with INPUT_REQUIRED and keeps a tombstone", async () => {
    const asset = (await upload(app, await png("to-delete.png"))).json<Asset>();
    const { canvasId } = await newCanvas(app);
    const recipe = recipeWith(asset.id);
    await saveSnapshot(canvasId, recipe);
    const usage = (
      await app.inject(`/assets/${asset.id}/usage?canvasId=${canvasId}`)
    ).json();
    expect(usage.nodes).toEqual([
      { nodeId: "n_asset", type: "input.asset", paramKey: "asset" },
    ]);
    const removed = await app.inject({
      method: "DELETE",
      url: `/assets/${asset.id}?canvasId=${canvasId}`,
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({
      assetId: asset.id,
      status: "deleted",
      affected: { nodes: [{ nodeId: "n_asset" }] },
    });
    const detail = await app.inject(`/assets/${asset.id}`);
    expect(detail.statusCode).toBe(410);
    expect(detail.json()).toMatchObject({
      code: "ASSET_DELETED",
      details: {
        asset: { id: asset.id, name: "to-delete.png", status: "deleted" },
      },
    });
    expect((await app.inject(`/assets/${asset.id}/file`)).statusCode).toBe(410);
    expect((await app.inject("/assets?q=to-delete")).json().items).toHaveLength(
      0,
    );
    const run = await startRun(app, recipe, canvasId);
    expect(run.statusCode).toBe(422);
    expect(run.json()[0]).toMatchObject({
      code: "INPUT_REQUIRED",
      nodeId: "n_asset",
    });
    expect(
      (await app.inject({ method: "DELETE", url: `/assets/${asset.id}` }))
        .statusCode,
    ).toBe(410);
    // The canvas recipe is not rewritten.
    const { rows } = await db.query(
      "SELECT snapshot FROM canvases WHERE id=$1",
      [canvasId],
    );
    expect(rows[0].snapshot.nodes[0].params.asset).toBe(asset.id);
  });
  it("fails a retry with INPUT_REQUIRED instead of crashing", async () => {
    const asset = (await upload(app, await png())).json<Asset>();
    const { canvasId } = await newCanvas(app);
    const first = await finish(
      app,
      (await startRun(app, recipeWith(asset.id), canvasId)).json<Run>().runId,
    );
    expect(first.status).toBe("done");
    await app.inject({ method: "DELETE", url: `/assets/${asset.id}` });
    const retry = await app.inject({
      method: "POST",
      url: `/runs/${first.runId}/retry`,
      payload: { nodeId: "n_asset" },
    });
    expect(retry.statusCode).toBe(200);
    const final = await finish(app, first.runId);
    expect(final.status).toBe("failed");
    const job = final.jobs.find((j) => j.nodeId === "n_asset")!;
    expect(job.error?.code).toBe("INPUT_REQUIRED");
    expect(final.jobs.find((j) => j.nodeId === "n_edit")!.status).toBe(
      "skipped",
    );
  });
  it("does not recreate a deleted output from the cache", async () => {
    const { canvasId } = await newCanvas(app);
    const recipe = promptRecipe(`cache ${crypto.randomUUID()}`);
    const first = await finish(
      app,
      (await startRun(app, recipe, canvasId)).json<Run>().runId,
    );
    const output = (
      first.jobs.find((j) => j.nodeId === "n_img")!.outputs!.image as Asset[]
    )[0];
    await app.inject({ method: "DELETE", url: `/assets/${output.id}` });
    const second = await finish(
      app,
      (await startRun(app, recipe, canvasId)).json<Run>().runId,
    );
    expect(second.status).toBe("done");
    const regenerated = (
      second.jobs.find((j) => j.nodeId === "n_img")!.outputs!.image as Asset[]
    )[0];
    expect(regenerated.id).not.toBe(output.id);
    expect((await app.inject(`/assets/${regenerated.id}`)).json().status).toBe(
      "ready",
    );
  });
  it("purges stored bytes after the grace period but keeps history", async () => {
    const asset = (await upload(app, await png())).json<Asset>();
    await app.inject({ method: "DELETE", url: `/assets/${asset.id}` });
    await new Promise((r) => setTimeout(r, 1100));
    await until(
      async () => (await cleanupAsset(asset.id)) !== "deferred" || undefined,
    );
    const { rows } = await db.query(
      "SELECT status, name, purged_at FROM assets WHERE id=$1",
      [asset.id],
    );
    expect(rows[0]).toMatchObject({ status: "deleted", name: "portrait.png" });
    expect(rows[0].purged_at).not.toBeNull();
    const objects = await db.query(
      "SELECT state FROM asset_objects WHERE asset_id=$1",
      [asset.id],
    );
    expect(objects.rows.every((o) => o.state === "deleted")).toBe(true);
  });
  it("keeps a failed cleanup recoverable and finishes it on retry", async () => {
    const asset = (await upload(app, await png())).json<Asset>();
    await app.inject({ method: "DELETE", url: `/assets/${asset.id}` });
    await new Promise((r) => setTimeout(r, 1100));
    const { rows } = await db.query(
      "SELECT profile FROM asset_objects WHERE asset_id=$1 AND role='original'",
      [asset.id],
    );
    const real = storeFor(rows[0].profile);
    let failures = 1;
    const flaky = Object.create(real);
    flaky.delete = async (key: string) => {
      if (failures-- > 0) throw new Error("object store unavailable");
      return real.delete(key);
    };
    registerStore(flaky);
    try {
      // The job throws, so pg-boss retries it; nothing is marked purged yet.
      await expect(cleanupAsset(asset.id)).rejects.toThrow("unavailable");
      const before = await db.query(
        "SELECT purged_at FROM assets WHERE id=$1",
        [asset.id],
      );
      expect(before.rows[0].purged_at).toBeNull();
      expect((await app.inject(`/assets/${asset.id}`)).statusCode).toBe(410);
      expect(await cleanupAsset(asset.id)).toBe("purged");
    } finally {
      registerStore(real);
    }
    const objects = await db.query(
      "SELECT state FROM asset_objects WHERE asset_id=$1",
      [asset.id],
    );
    expect(objects.rows.every((o) => o.state === "deleted")).toBe(true);
  });
  it("marks a video poster failed only after the last retry, without blocking the file", async () => {
    const video = (
      await upload(app, {
        name: "broken-poster.mp4",
        type: "video/mp4",
        data: await fixture("clip.mp4"),
      })
    ).json<Asset>();
    await until(
      async () =>
        (await app.inject(`/assets/${video.id}`)).json<Asset>()
          .previewStatus !== "pending",
    );
    await db.query("UPDATE assets SET preview_status='pending' WHERE id=$1", [
      video.id,
    ]);
    const dir = await mkdtemp(join(tmpdir(), "zcanvas-poster-"));
    const broken = join(dir, "source");
    await writeFile(broken, "not a video");
    try {
      await expect(
        deriveAsset(video.id, { sourcePath: broken, finalAttempt: false }),
      ).rejects.toBeTruthy();
      expect(
        (await app.inject(`/assets/${video.id}`)).json<Asset>().previewStatus,
      ).toBe("pending");
      expect(
        (await app.inject(`/assets/${video.id}/thumbnail`)).json().code,
      ).toBe("PREVIEW_PENDING");
      await expect(
        deriveAsset(video.id, { sourcePath: broken, finalAttempt: true }),
      ).rejects.toBeTruthy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    expect(
      (await app.inject(`/assets/${video.id}`)).json<Asset>().previewStatus,
    ).toBe("failed");
    const thumb = await app.inject(`/assets/${video.id}/thumbnail`);
    expect(thumb.statusCode).toBe(404);
    expect(thumb.json().code).toBe("PREVIEW_FAILED");
    expect((await app.inject(`/assets/${video.id}/file`)).statusCode).toBe(200);
  });
});
describe("interrupted writes", () => {
  it("marks an interrupted upload as failed and never lists it", async () => {
    const name = `interrupted-${crypto.randomUUID()}.png`;
    const body = multipart(await png(name));
    await new Promise<void>((resolve) => {
      const req = httpRequest(`${url}/assets`, {
        method: "POST",
        headers: {
          ...body.headers,
          "content-length": String(body.payload.length),
        },
      });
      req.on("error", () => resolve());
      req.write(
        body.payload.subarray(0, Math.floor(body.payload.length / 2)),
        () => {
          setTimeout(() => {
            req.destroy();
            resolve();
          }, 200);
        },
      );
    });
    const failed = await until(async () => {
      const { rows } = await db.query(
        "SELECT status FROM assets WHERE name=$1",
        [name],
      );
      return rows[0]?.status === "failed" && rows[0];
    });
    expect(failed.status).toBe("failed");
    expect((await app.inject(`/assets?q=${name}`)).json().items).toHaveLength(
      0,
    );
  });
  it("enforces the size limit while streaming", async () => {
    await expect(
      spool(Readable.from([Buffer.alloc(64), Buffer.alloc(64)]), 100),
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
  });
});
describe("migration", () => {
  it("maps legacy canvases, runs and assets, reports the rest, and is safe to rerun", async () => {
    // A legacy object store holding objects under the asset ID, as the POC wrote them.
    const root = await mkdtemp(join(tmpdir(), "zcanvas-legacy-"));
    registerStore(new LocalStore({ id: "s3", driver: "local", root }));
    const used = `ast_${crypto.randomUUID()}`,
      orphan = `ast_${crypto.randomUUID()}`,
      generated = `ast_${crypto.randomUUID()}`;
    const data = await fixture("portrait.png");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, used), data);
    const canvasId = `rcp_${crypto.randomUUID()}`;
    const runId = `run_${crypto.randomUUID()}`;
    const legacy = (id: string, extra = {}) => ({
      id,
      kind: "image",
      mime: "image/png",
      bytes: data.length,
      url: `http://127.0.0.1:4310/assets/${id}/file`,
      meta: { width: 720, height: 1280 },
      createdAt: "2026-09-30T10:00:00.000Z",
      ...extra,
    });
    await db.query(
      "INSERT INTO canvases(id,name,snapshot) VALUES($1,'Legacy',$2)",
      [canvasId, recipeWith(used)],
    );
    await db.query(
      "INSERT INTO runs(id,canvas_id,recipe,data) VALUES($1,$2,'{}','{}')",
      [runId, canvasId],
    );
    await db.query(
      "INSERT INTO assets(id,data) VALUES($1,$2),($3,$4),($5,$6)",
      [
        used,
        legacy(used),
        orphan,
        legacy(orphan),
        generated,
        legacy(generated, { createdBy: { runId, nodeId: "n_img" }, meta: {} }),
      ],
    );
    const report = await migrateLegacyCatalog();
    expect(report.assetsMigrated).toBe(3);
    expect(report.unmapped).toContainEqual({
      recordType: "asset",
      recordId: orphan,
      reason: "Upload is not referenced by any canvas",
    });
    const space = personalSpaceId("usr_local");
    const { rows } = await db.query(
      "SELECT id, space_id, source_type, source_run_id FROM assets WHERE id = ANY($1) ORDER BY id",
      [[used, orphan, generated]],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[used]).toMatchObject({
      space_id: space,
      source_type: "upload",
    });
    expect(byId[generated]).toMatchObject({
      space_id: space,
      source_type: "generated",
      source_run_id: runId,
    });
    expect(byId[orphan].space_id).toBeNull();
    // Old IDs keep working: detail, bytes from the old locator, and the recipe.
    const detail = (await app.inject(`/assets/${used}`)).json<Asset>();
    expect(detail).toMatchObject({
      id: used,
      url: legacy(used).url.replace(
        "http://127.0.0.1:4310",
        detail.url.split("/assets/")[0],
      ),
    });
    const file = await app.inject(`/assets/${used}/file`);
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(data)).toBe(true);
    // The generated asset's file was never copied: the error is explicit, not a silent lookup elsewhere.
    expect((await app.inject(`/assets/${generated}/file`)).json().code).toBe(
      "STORAGE_UNAVAILABLE",
    );
    const run = await finish(
      app,
      (await startRun(app, recipeWith(used), canvasId)).json<Run>().runId,
    );
    expect(run.status).toBe("done");
    // Unmapped assets are invisible until an operator assigns them.
    expect((await app.inject(`/assets/${orphan}`)).statusCode).toBe(404);
    const again = await migrateLegacyCatalog();
    expect(again.assetsMigrated).toBe(0);
    expect(again.canvasesAssigned).toBe(0);
    expect(await assignUnmappedAssets(space, [orphan])).toBe(1);
    expect((await app.inject(`/assets/${orphan}`)).statusCode).toBe(200);
    await rm(root, { recursive: true, force: true });
  });
});
