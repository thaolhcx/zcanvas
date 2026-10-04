// The model queue (issue #25, D6): submit, schedule at the ETA, fetch; shared
// slots; restart safety; cancel; retries; Studio pages and node history.
import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";
import { createApp } from "../src/app.ts";
import { migrate, db } from "../src/db.ts";
import { checkStorage } from "../src/storage.ts";
import { startRunner } from "../src/runner.ts";
import { modelByKey } from "../src/catalog.ts";
import { setAdapterForTests } from "../src/providers/index.ts";
import { mockAdapter } from "../src/providers/mock.ts";
import { ProviderError, type ProviderAdapter } from "../src/providers/types.ts";
import { callbackSig } from "../src/providers/callback.ts";
import { submitJob } from "../src/gen.ts";
import type {
  Asset,
  HistoryResponse,
  Recipe,
  Run,
  StudioCanvas,
} from "../../contracts/index.ts";
import { type App, png, until, upload } from "./helpers.ts";
let app: App, stop: () => Promise<void>, canvasId: string;
const env = { ...process.env };
beforeAll(async () => {
  await migrate();
  await checkStorage();
  stop = await startRunner();
  app = await createApp();
  canvasId = (
    await app.inject({
      method: "POST",
      url: "/canvases",
      payload: { name: "Queue" },
    })
  ).json().canvasId;
});
afterAll(async () => {
  await app?.close();
  await stop?.();
});
afterEach(() => {
  process.env = { ...env };
  setAdapterForTests(undefined);
  modelByKey("seedance-2-5")!.slots = 10;
  modelByKey("seedream-5-pro")!.slots = 6;
});
const node = (
  id: string,
  type: string,
  params: Record<string, unknown>,
  typeVersion = 2,
) => ({
  id,
  type,
  typeVersion,
  position: { x: 0, y: 0 },
  params,
});
const recipe = (
  nodes: Recipe["nodes"],
  edges: Recipe["edges"] = [],
): Recipe => ({
  schema: "recipe/v1",
  meta: {
    id: canvasId,
    name: "Queue",
    version: 1,
    registryVersion: "2026.09.1",
  },
  nodes,
  edges,
  groups: [],
});
const videoRecipe = (prompt = `A paper boat ${crypto.randomUUID()}`) =>
  recipe([
    node("v", "video.generate", {
      model: "auto",
      mode: "text",
      prompt,
      duration: 4,
      autoPrompt: false,
    }),
  ]);
const imageRecipe = (
  prompt = `A lighthouse ${crypto.randomUUID()}`,
  extra = {},
) =>
  recipe([
    node("i", "image.generate", {
      model: "auto",
      prompt,
      autoPrompt: false,
      ...extra,
    }),
  ]);
async function start(r: Recipe, target?: string, canvas = canvasId) {
  const response = await app.inject({
    method: "POST",
    url: "/runs",
    payload: {
      recipe: { ...r, meta: { ...r.meta, id: canvas } },
      canvasId: canvas,
      graphVersion: r.meta.version,
      ...(target ? { target } : {}),
    },
  });
  if (response.statusCode !== 201) throw new Error(response.body);
  return response.json<Run>();
}
const getRun = async (id: string) =>
  (await app.inject(`/runs/${id}`)).json<Run>();
const finished = (id: string, ms = 20000) =>
  until(async () => {
    const run = await getRun(id);
    return run.status !== "running" && run;
  }, ms);
const taskRows = async (runId: string) =>
  (
    await db.query(
      "SELECT * FROM gen_tasks WHERE run_id=$1 ORDER BY created_at",
      [runId],
    )
  ).rows;

describe("submit, schedule at the ETA, fetch", () => {
  it("runs a video as a provider task with an expected time, then records its duration", async () => {
    process.env.MOCK_VIDEO_MS = "1200";
    const run = await start(videoRecipe());
    const running = await until(async () => {
      const job = (await getRun(run.runId)).jobs[0];
      return job?.eta ? job : undefined;
    });
    expect(running.status).toBe("running");
    expect(running.model).toBe("seedance-2-5");
    expect(new Date(running.eta!).getTime()).toBeGreaterThan(Date.now() - 1000);
    const done = await finished(run.runId);
    expect(done.status).toBe("done");
    expect(done.jobs[0].eta).toBeUndefined();
    expect(done.jobs[0].finishedAt).toBeTruthy();
    const tasks = await taskRows(run.runId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      state: "done",
      provider: "mock",
      model: "seedance-2-5",
    });
    expect(Number(tasks[0].fetches)).toBeGreaterThanOrEqual(1);
    const stats = await db.query(
      "SELECT ms FROM gen_stats WHERE model='seedance-2-5' ORDER BY id DESC LIMIT 1",
    );
    expect(stats.rows[0].ms).toBeGreaterThan(0);
    const usage = await db.query(
      "SELECT credits, model FROM usage WHERE run_id=$1",
      [run.runId],
    );
    expect(usage.rows[0]).toMatchObject({ model: "seedance-2-5" });
  });
  it("answers images inside submit, without a fetch", async () => {
    const done = await finished(
      (await start(imageRecipe(undefined, { count: 2 }))).runId,
    );
    expect(done.status).toBe("done");
    expect(done.jobs[0].outputs!.image as Asset[]).toHaveLength(2);
    const tasks = await taskRows(done.runId);
    expect(tasks[0]).toMatchObject({
      state: "done",
      provider_task_id: null,
      fetches: 0,
    });
  });
  it("lets a waiting job see its place in line when the model has no free slot", async () => {
    process.env.MOCK_VIDEO_MS = "1500";
    modelByKey("seedance-2-5")!.slots = 1;
    const first = await start(videoRecipe());
    await until(async () => (await getRun(first.runId)).jobs[0]?.eta);
    const second = await start(videoRecipe());
    const waiting = await until(async () => {
      const job = (await getRun(second.runId)).jobs[0];
      return job?.queuePosition && job;
    });
    expect(waiting).toMatchObject({ status: "queued", queuePosition: 1 });
    expect((await finished(first.runId)).status).toBe("done");
    const done = await finished(second.runId);
    expect(done.status).toBe("done");
    expect(done.jobs[0].queuePosition).toBeUndefined();
  });
  it("caps running jobs per user across models", async () => {
    process.env.GEN_USER_MAX = "1";
    process.env.MOCK_VIDEO_MS = "1200";
    const video = await start(videoRecipe());
    await until(async () => (await getRun(video.runId)).jobs[0]?.eta);
    const image = await start(imageRecipe());
    const waiting = await until(
      async () => (await getRun(image.runId)).jobs[0]?.queuePosition,
    );
    expect(waiting).toBe(1);
    expect((await finished(image.runId)).status).toBe("done");
  });
});

describe("restarts", () => {
  it("neither submits twice nor loses a video task when the runner restarts mid-task", async () => {
    process.env.MOCK_VIDEO_MS = "2500";
    const run = await start(videoRecipe());
    await until(
      async () => (await taskRows(run.runId))[0]?.state === "submitted",
    );
    await stop();
    await new Promise((r) => setTimeout(r, 300));
    stop = await startRunner();
    const done = await finished(run.runId);
    expect(done.status).toBe("done");
    const tasks = await taskRows(run.runId);
    expect(tasks).toHaveLength(1);
    const mock = await db.query("SELECT count(*) FROM mock_tasks WHERE id=$1", [
      tasks[0].provider_task_id,
    ]);
    expect(Number(mock.rows[0].count)).toBe(1);
  });
  it("fails, rather than resubmits, a task interrupted between recording and sending", async () => {
    const run = await start(imageRecipe());
    const done = await finished(run.runId);
    const job = done.jobs[0];
    // Simulate: the job is back to queued and a "submitting" row exists for its next attempt.
    await db.query(
      "UPDATE runs SET data=jsonb_set(data,'{status}','\"running\"') WHERE id=$1",
      [run.runId],
    );
    await db.query(
      'UPDATE jobs SET data=data || \'{"status":"queued","attempt":2}\'::jsonb WHERE id=$1',
      [job.jobId],
    );
    await db.query(
      "INSERT INTO gen_tasks(id,job_id,attempt,run_id,node_id,provider,model,state) VALUES($1,$2,2,$3,'i','mock','seedream-5-pro','submitting')",
      [`gtk_${job.jobId}_2`, job.jobId, run.runId],
    );
    await submitJob(job.jobId);
    const after = (
      await db.query("SELECT data FROM jobs WHERE id=$1", [job.jobId])
    ).rows[0].data;
    expect(after.status).toBe("failed");
    expect(after.error.code).toBe("INTERRUPTED");
    expect((await taskRows(run.runId)).map((t) => t.state)).toEqual([
      "done",
      "failed",
    ]);
  });
});

describe("cancel", () => {
  it("cancels a task the provider still queues", async () => {
    process.env.MOCK_VIDEO_MS = "4000";
    const run = await start(videoRecipe());
    await until(
      async () => (await taskRows(run.runId))[0]?.state === "submitted",
    );
    const cancelled = await app.inject({
      method: "POST",
      url: `/runs/${run.runId}/cancel`,
    });
    expect(cancelled.json().status).toBe("cancelled");
    const task = await until(async () => {
      const t = (await taskRows(run.runId))[0];
      return t.state === "cancelled" && t;
    });
    const mock = await db.query("SELECT state FROM mock_tasks WHERE id=$1", [
      task.provider_task_id,
    ]);
    expect(mock.rows[0].state).toBe("cancelled");
    expect((await getRun(run.runId)).jobs[0].status).toBe("cancelled");
  });
  it("drops a running task: the paid result is stored, not shown", async () => {
    process.env.MOCK_VIDEO_MS = "1600";
    const run = await start(videoRecipe());
    const submitted = await until(async () => {
      const t = (await taskRows(run.runId))[0];
      return t?.state === "submitted" && t;
    });
    // Past the first half the mock provider is running and can no longer cancel.
    await new Promise((r) =>
      setTimeout(
        r,
        Math.max(
          0,
          new Date(submitted.created_at).getTime() + 1000 - Date.now(),
        ),
      ),
    );
    await app.inject({ method: "POST", url: `/runs/${run.runId}/cancel` });
    await until(async () => (await taskRows(run.runId))[0].state === "dropped");
    const task = await until(async () => {
      const t = (await taskRows(run.runId))[0];
      return t.state === "cancelled" && t;
    }, 15000);
    expect(task.finished_at).toBeTruthy();
    const job = (await getRun(run.runId)).jobs[0];
    expect(job.status).toBe("cancelled");
    expect(job.outputs).toBeUndefined();
    const stored = await db.query(
      "SELECT status, kept FROM assets WHERE source_job_id=$1",
      [job.jobId],
    );
    expect(stored.rows).toEqual([{ status: "ready", kept: false }]);
  });
});

describe("errors", () => {
  it("retries a busy provider with backoff, then succeeds", async () => {
    let calls = 0;
    const flaky: ProviderAdapter = {
      ...mockAdapter,
      name: "flaky",
      async submit(request, read, signal) {
        calls++;
        if (calls === 1) throw new ProviderError("429 Too Many Requests", true);
        return mockAdapter.submit(request, read, signal);
      },
    };
    setAdapterForTests(flaky);
    const done = await finished((await start(imageRecipe())).runId);
    expect(done.status).toBe("done");
    expect(calls).toBe(2);
    expect((await taskRows(done.runId)).map((t) => t.state)).toEqual([
      "failed",
      "done",
    ]);
  });
  it("stops at once on a content or parameter error, with the provider's message", async () => {
    setAdapterForTests({
      ...mockAdapter,
      name: "strict",
      async submit() {
        throw new ProviderError(
          "InputTextSensitiveContentDetected: the prompt may contain sensitive content",
        );
      },
    });
    const done = await finished((await start(imageRecipe())).runId);
    expect(done.status).toBe("failed");
    expect(done.jobs[0].error).toEqual({
      code: "PROVIDER_ERROR",
      message:
        "InputTextSensitiveContentDetected: the prompt may contain sensitive content",
    });
    expect(await taskRows(done.runId)).toHaveLength(1);
  });
  it("refuses a run whose model limits or references are broken before queueing it", async () => {
    const tooLong = recipe([
      node("v", "video.generate", {
        model: "auto",
        mode: "text",
        prompt: "x",
        duration: 31,
      }),
    ]);
    const r1 = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { recipe: tooLong, canvasId, graphVersion: 1 },
    });
    expect(r1.statusCode).toBe(422);
    expect(r1.json().map((i: { code: string }) => i.code)).toContain(
      "PARAM_VALUE",
    );
    const broken = imageRecipe("Put @[Logo](asset:ast_missing) on it");
    const r2 = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { recipe: broken, canvasId, graphVersion: 1 },
    });
    expect(r2.statusCode).toBe(422);
    expect(r2.json().map((i: { code: string }) => i.code)).toContain(
      "REFERENCE",
    );
  });
  it("only wakes a fetch from a callback that carries our signature", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/providers/callback?task=gtk_x&sig=nope",
    });
    expect(bad.statusCode).toBe(403);
    const good = await app.inject({
      method: "POST",
      url: `/providers/callback?task=gtk_x&sig=${callbackSig("gtk_x")}`,
    });
    expect(good.statusCode).toBe(200);
  });
});

describe("references, Auto prompt and keep", () => {
  it("renders @ tokens as image 1, keeps the reference and records intent and final prompt", async () => {
    const asset = (await upload(app, await png("logo.png"))).json<Asset>();
    // A result used as a reference is kept: make this one an unkept result first.
    await db.query(
      "UPDATE assets SET source_type='generated', kept=false WHERE id=$1",
      [asset.id],
    );
    const intent = `Put @[Logo](asset:${asset.id}) on a coffee bag ${crypto.randomUUID()}`;
    const r = recipe(
      [
        node("a", "input.asset", { asset: asset.id }, 1),
        node("i", "image.generate", { model: "auto", prompt: intent }),
      ],
      [
        {
          id: "e",
          source: "a",
          sourcePort: "asset",
          target: "i",
          targetPort: "reference",
        },
      ],
    );
    const done = await finished((await start(r, "i")).runId);
    expect(done.status).toBe("done");
    const job = done.jobs.find((j) => j.nodeId === "i")!;
    expect(job.intent).toBe(intent);
    expect(job.finalPrompt).toContain(`@[Logo](asset:${asset.id})`);
    expect(job.finalPrompt).toContain("cinematic lighting");
    const out = (job.outputs!.image as Asset[])[0];
    const detail = (await app.inject(`/assets/${out.id}`)).json<Asset>();
    expect(detail.generation).toMatchObject({
      intent,
      finalPrompt: job.finalPrompt,
      references: [{ id: asset.id, port: "reference", name: "logo.png" }],
    });
    // The model sees "image 1", not the token.
    expect(detail.generation!.prompt).toContain("Put image 1 on a coffee bag");
    expect((await app.inject(`/assets/${asset.id}`)).json<Asset>().kept).toBe(
      true,
    );
  });
  it("keeps a downloaded result", async () => {
    const done = await finished((await start(imageRecipe())).runId);
    const out = (done.jobs[0].outputs!.image as Asset[])[0];
    expect((await app.inject(`/assets/${out.id}`)).json<Asset>().kept).toBe(
      false,
    );
    expect(
      (await app.inject(`/assets/${out.id}/file?download=1`)).statusCode,
    ).toBe(200);
    expect((await app.inject(`/assets/${out.id}`)).json<Asset>().kept).toBe(
      true,
    );
  });
});

describe("Text", () => {
  it("writes text through the queue with the preset's system prompt and image context", async () => {
    const asset = (await upload(app, await png("bag.png"))).json<Asset>();
    const r = recipe(
      [
        node("a", "input.asset", { asset: asset.id }, 1),
        node(
          "t",
          "text.generate",
          {
            model: "auto",
            preset: "enrich",
            prompt: `coffee bag ${crypto.randomUUID()}`,
          },
          1,
        ),
      ],
      [
        {
          id: "e",
          source: "a",
          sourcePort: "asset",
          target: "t",
          targetPort: "context",
        },
      ],
    );
    const done = await finished((await start(r, "t")).runId);
    expect(done.status).toBe("done");
    const job = done.jobs.find((j) => j.nodeId === "t")!;
    expect(job.model).toBe("seed-2-0-pro");
    expect((job.outputs!.text as { value: string }).value).toMatch(
      /^coffee bag .*warm soft backlight/,
    );
    expect(job.finalPrompt).toBeUndefined();
    const stored = (
      await db.query("SELECT request FROM jobs WHERE id=$1", [job.jobId])
    ).rows[0].request;
    expect(stored.system).toMatch(/detailed image or video generation prompt/);
    expect(stored.refs).toEqual([
      expect.objectContaining({
        assetId: asset.id,
        role: "context",
        kind: "image",
      }),
    ]);
    const history = (
      await app.inject(`/canvases/${canvasId}/nodes/t/history`)
    ).json<HistoryResponse>();
    expect(history.items[0].text).toMatch(/warm soft backlight/);
  });
});

describe("Studio pages and node history", () => {
  it("gives each user one hidden canvas per kind, kept out of the canvas list", async () => {
    const a = (await app.inject("/studio/video")).json<StudioCanvas>();
    const b = (await app.inject("/studio/video")).json<StudioCanvas>();
    expect(a.canvasId).toBe(b.canvasId);
    expect(a.recipe.nodes).toEqual([
      expect.objectContaining({
        id: "studio",
        type: "video.generate",
        typeVersion: 2,
      }),
    ]);
    const list = (await app.inject("/canvases")).json<{ id: string }[]>();
    expect(list.map((c) => c.id)).not.toContain(a.canvasId);
    expect((await app.inject("/studio/nope")).statusCode).toBe(404);
    const draft = structuredClone(a.recipe);
    draft.nodes[0].params = { model: "auto", mode: "frames", prompt: "draft" };
    draft.meta.version = 3;
    // An incomplete draft (frames without a first frame) is still saved.
    const saved = await app.inject({
      method: "PUT",
      url: "/studio/video",
      payload: { recipe: draft },
    });
    expect(saved.statusCode).toBe(200);
    expect(
      (await app.inject("/studio/video")).json<StudioCanvas>().recipe.nodes[0]
        .params.prompt,
    ).toBe("draft");
  });
  it("lists a node's runs newest first; regenerating makes a new result; delete hides an entry", async () => {
    const studio = (await app.inject("/studio/image")).json<StudioCanvas>();
    const r = structuredClone(studio.recipe);
    // The draft may hold references from other runs on this database: start from the node alone.
    r.nodes = r.nodes.filter((n) => n.id === "studio");
    r.edges = [];
    r.nodes[0].params = {
      model: "auto",
      prompt: `Fox in a cup ${crypto.randomUUID()}`,
      autoPrompt: false,
    };
    const one = await finished(
      (await start(r, "studio", studio.canvasId)).runId,
    );
    const two = await finished(
      (await start(r, "studio", studio.canvasId)).runId,
    );
    // The target of a run is never served from the cache.
    expect((two.jobs[0].outputs!.image as Asset[])[0].id).not.toBe(
      (one.jobs[0].outputs!.image as Asset[])[0].id,
    );
    const history = (
      await app.inject(`/canvases/${studio.canvasId}/nodes/studio/history`)
    ).json<HistoryResponse>();
    expect(history.items.slice(0, 2).map((h) => h.jobId)).toEqual([
      two.jobs[0].jobId,
      one.jobs[0].jobId,
    ]);
    expect(history.items[0]).toMatchObject({
      status: "done",
      model: "seedream-5-pro",
      intent: r.nodes[0].params.prompt,
      replaced: false,
      node: { id: "studio", params: r.nodes[0].params },
    });
    expect(history.items[0].outputs).toHaveLength(1);
    const del = await app.inject({
      method: "DELETE",
      url: `/canvases/${studio.canvasId}/nodes/studio/history/${two.jobs[0].jobId}`,
    });
    expect(del.statusCode).toBe(200);
    const after = (
      await app.inject(`/canvases/${studio.canvasId}/nodes/studio/history`)
    ).json<HistoryResponse>();
    expect(after.items.map((h) => h.jobId)).not.toContain(two.jobs[0].jobId);
    const dock = (await app.inject("/history?kind=image&q=fox%20cup")).json();
    expect(
      dock.items.some(
        (i: { jobId: string; studio: string }) =>
          i.jobId === one.jobs[0].jobId && i.studio === "image",
      ),
    ).toBe(true);
  });
  it("keeps a retried node's old job as replaced history", async () => {
    const run = await start(imageRecipe());
    await app.inject({
      method: "POST",
      url: `/runs/${run.runId}/fail`,
      payload: { nodeId: "i" },
    });
    const failed = await finished(run.runId);
    expect(failed.status).toBe("failed");
    const old = failed.jobs[0].jobId;
    await app.inject({
      method: "POST",
      url: `/runs/${run.runId}/retry`,
      payload: { nodeId: "i" },
    });
    await db.query("DELETE FROM mock_failures WHERE run_id=$1", [run.runId]);
    const retried = await finished(run.runId);
    expect(retried.status).toBe("done");
    expect(retried.jobs[0].jobId).not.toBe(old);
    const history = (
      await app.inject(`/canvases/${canvasId}/nodes/i/history`)
    ).json<HistoryResponse>();
    const entry = history.items.find((h) => h.jobId === old)!;
    expect(entry).toMatchObject({ replaced: true, status: "failed" });
  });
});
describe("mock media", () => {
  it("follows the asked ratio, so layouts look right on mocks (#25 review)", async () => {
    const sharp = (await import("sharp")).default;
    const base = { jobId: "j", runId: "r", nodeId: "n", prompt: "x", refs: [] };
    const image = await mockAdapter.submit(
      {
        ...base,
        task: "image",
        model: modelByKey("seedream-5-pro")!,
        params: { ratio: "16:9", count: 1 },
      },
      async () => new Uint8Array(),
      AbortSignal.timeout(10000),
    );
    if (image.type !== "done" || image.outputs[0].type !== "file")
      throw new Error("no image");
    const { width, height } = await sharp(
      Buffer.from(await image.outputs[0].file.arrayBuffer()),
    ).metadata();
    expect(width! / height!).toBeCloseTo(16 / 9, 1);
  });
});
