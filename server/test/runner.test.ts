import { beforeAll, afterAll, it, expect } from "vitest";
import WebSocket from "ws";
import { createApp } from "../src/app.ts";
import { migrate, db } from "../src/db.ts";
import { checkStorage } from "../src/storage.ts";
import { startRunner, cacheKey } from "../src/runner.ts";
import pilot from "../../contracts/examples/pilot.recipe.json" with { type: "json" };
import type { Recipe, Run } from "../../contracts/index.ts";
let app: Awaited<ReturnType<typeof createApp>>,
  stop: () => Promise<void>,
  url: string,
  canvasId: string;
const makeRecipe = () => {
  const r = structuredClone(pilot) as Recipe;
  r.nodes[0].params.text = `Pilot ${crypto.randomUUID()}`;
  return r;
};
const start = async (recipe: Recipe) => {
  const result = await app.inject({
    method: "POST",
    url: "/runs",
    payload: { recipe, canvasId, graphVersion: recipe.meta.version },
  });
  expect(result.statusCode).toBe(201);
  return result.json<Run>();
};
const wait = async (id: string) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const run = (await app.inject(`/runs/${id}`)).json<Run>();
    if (run.status !== "running") return run;
    await new Promise((r) => setTimeout(r, 75));
  }
  throw new Error("Run timed out");
};
beforeAll(async () => {
  await migrate();
  await checkStorage();
  stop = await startRunner();
  app = await createApp();
  url = await app.listen({ host: "127.0.0.1", port: 0 });
  canvasId = (
    await app.inject({
      method: "POST",
      url: "/canvases",
      payload: { name: "Runner integration" },
    })
  ).json().canvasId;
});
afterAll(async () => {
  await app?.close();
  await stop?.();
});
it("runs the pilot over HTTP + WebSocket, fans out to two playable exports, then hits cache", async () => {
  const recipe = makeRecipe(),
    run = await start(recipe);
  const events: { type: string; status: string }[] = [];
  const socket = new WebSocket(
    url.replace("http", "ws") + `/runs/${run.runId}/events`,
  );
  socket.on("message", (message) => events.push(JSON.parse(String(message))));
  const completed = await wait(run.runId);
  await new Promise((r) => setTimeout(r, 200));
  socket.close();
  expect(completed.status).toBe("done");
  expect(
    events.some((e) => e.type === "job.status" && e.status === "running"),
  ).toBe(true);
  const exports = completed.jobs.filter((j) => j.nodeId === "n_out");
  expect(exports).toHaveLength(2);
  for (const job of exports) {
    expect(job.status).toBe("done");
    const file = job.outputs!.file as {
      url: string;
      meta: { durationSec: number };
    };
    expect(file.meta.durationSec).toBeGreaterThanOrEqual(10);
    const response = await app.inject(new URL(file.url).pathname);
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.length).toBeGreaterThan(1000);
  }
  const cached = await wait((await start(recipe)).runId);
  expect(cached.status).toBe("done");
  expect(cached.credits).toBe(0);
}, 60000);
it("fails one node, skips downstream, retries only that subgraph preserving upstream jobs", async () => {
  const run = await start(makeRecipe());
  await app.inject({
    method: "POST",
    url: `/runs/${run.runId}/fail`,
    payload: { nodeId: "n_vid" },
  });
  const failed = await wait(run.runId);
  expect(failed.status).toBe("failed");
  expect(
    failed.jobs
      .filter((j) => j.nodeId === "n_out")
      .every((j) => j.status === "skipped"),
  ).toBe(true);
  const upstream = failed.jobs
    .filter((j) => j.nodeId === "n_img")
    .map((j) => j.jobId);
  const retry = await app.inject({
    method: "POST",
    url: `/runs/${run.runId}/retry`,
    payload: { nodeId: "n_vid" },
  });
  expect(retry.statusCode).toBe(200);
  const final = await wait(run.runId);
  expect(final.status).toBe("done");
  expect(
    final.jobs.filter((j) => j.nodeId === "n_img").map((j) => j.jobId),
  ).toEqual(upstream);
}, 60000);
it("skips an untaken branch without stopping independent audio", async () => {
  const recipe = makeRecipe();
  recipe.nodes.find((n) => n.id === "n_if")!.params.compare = "99999";
  const run = await wait((await start(recipe)).runId);
  expect(run.status).toBe("done");
  expect(
    run.jobs
      .filter((j) => ["n_vid", "n_out"].includes(j.nodeId))
      .every((j) => j.status === "skipped"),
  ).toBe(true);
  expect(run.jobs.find((j) => j.nodeId === "n_voice")?.status).toBe("done");
}, 30000);
it("cancels a running snapshot and ignores subsequent worker completion", async () => {
  const run = await start(makeRecipe());
  const cancel = await app.inject({
    method: "POST",
    url: `/runs/${run.runId}/cancel`,
  });
  expect(cancel.json().status).toBe("cancelled");
  await new Promise((r) => setTimeout(r, 1200));
  expect((await wait(run.runId)).status).toBe("cancelled");
});
it("rejects invalid snapshots and mismatched graph versions on the server", async () => {
  const recipe = makeRecipe();
  recipe.edges[0].targetPort = "missing";
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/runs",
        payload: { recipe, canvasId, graphVersion: 7 },
      })
    ).statusCode,
  ).toBe(422);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/runs",
        payload: { recipe: makeRecipe(), canvasId, graphVersion: 99 },
      })
    ).statusCode,
  ).toBe(422);
});
it("cache keys include text inputs and port identities", () => {
  const node = (pilot as Recipe).nodes[1];
  expect(cacheKey(node, { prompt: { value: "a" } })).not.toBe(
    cacheKey(node, { prompt: { value: "b" } }),
  );
  expect(cacheKey(node, { prompt: { value: "a" } })).not.toBe(
    cacheKey(node, { other: { value: "a" } }),
  );
});
it("rejects cross-origin requests to the local API", async () => {
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/canvases",
        headers: { origin: "https://unrelated.example" },
        payload: { name: "Unwanted" },
      })
    ).statusCode,
  ).toBe(403);
});
