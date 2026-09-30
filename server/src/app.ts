import { isLocalOrigin } from "./origin.ts";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Graph, Y, emptyRecipe } from "../../graph/src/index.ts";
import { validate, type Recipe, type Run } from "../../contracts/index.ts";
import { db } from "./db.ts";
import { registry } from "./registry.ts";
import { config } from "./config.ts";
import { getAsset, putAsset, s3 } from "./assets.ts";
import { getRun, enqueue, emit } from "./runner.ts";
const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" } },
};
export async function createApp() {
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 });
  app.addHook("onRequest", async (request, reply) => {
    if (!isLocalOrigin(request.headers.origin))
      return reply
        .code(403)
        .send({ error: "Only the local workspace may call this API" });
  });
  await app.register(cors, {
    origin: /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  });
  await app.register(multipart, {
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  });
  await app.register(websocket);
  app.get("/health", async () => ({ ok: true, mock: config.mock }));
  app.get("/registry", async () => ({
    registryVersion: "2026.09.1",
    types: [...registry.values()],
  }));
  app.get(
    "/canvases",
    async () =>
      (
        await db.query(
          "SELECT id, name, version, updated_at FROM canvases ORDER BY updated_at DESC",
        )
      ).rows,
  );
  app.post<{ Body: { name: string } }>(
    "/canvases",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
          },
        },
      },
    },
    async (request) => {
      const recipe = emptyRecipe(undefined, request.body.name);
      const graph = new Graph(new Y.Doc(), registry, recipe);
      const bytes = Buffer.from(Y.encodeStateAsUpdate(graph.doc));
      graph.destroy();
      graph.doc.destroy();
      await db.query(
        "INSERT INTO canvases(id,name,ydoc,snapshot) VALUES($1,$2,$3,$4)",
        [recipe.meta.id, recipe.meta.name, bytes, recipe],
      );
      return { canvasId: recipe.meta.id };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/canvases/:id",
    { schema: { params: idParams } },
    async (request, reply) => {
      const { rows } = await db.query(
        "SELECT snapshot FROM canvases WHERE id=$1",
        [request.params.id],
      );
      if (!rows.length)
        return reply.code(404).send({ error: "Canvas not found" });
      return rows[0].snapshot;
    },
  );
  app.get(
    "/presets",
    async () =>
      (
        await db.query(
          "SELECT id, name, recipe FROM presets ORDER BY created_at DESC",
        )
      ).rows,
  );
  app.post<{ Body: { name: string; recipe: Recipe } }>(
    "/presets",
    async (request, reply) => {
      if (
        typeof request.body?.name !== "string" ||
        !request.body.name.trim() ||
        request.body.name.length > 120
      )
        return reply
          .code(400)
          .send({ error: "A preset name is required (up to 120 characters)" });
      const issues = validate(request.body.recipe, registry);
      if (issues.length) return reply.code(422).send(issues);
      const id = `preset_${crypto.randomUUID()}`;
      await db.query("INSERT INTO presets(id,name,recipe) VALUES($1,$2,$3)", [
        id,
        request.body.name,
        request.body.recipe,
      ]);
      return { id };
    },
  );
  app.post("/assets", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "Choose a file" });
    if (
      !["image/", "video/", "audio/"].some((kind) =>
        file.mimetype.startsWith(kind),
      )
    )
      return reply.code(415).send({ error: "Choose an image, video or audio" });
    try {
      const buffer = await file.toBuffer();
      return await putAsset(
        new Blob([new Uint8Array(buffer)], { type: file.mimetype }),
        {},
      );
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Unreadable media",
      });
    }
  });
  app.get<{ Params: { id: string } }>(
    "/assets/:id",
    { schema: { params: idParams } },
    async (request, reply) => {
      try {
        return await getAsset(request.params.id);
      } catch {
        return reply.code(404).send({ error: "Asset not found" });
      }
    },
  );
  app.get<{ Params: { id: string; kind: string } }>(
    "/assets/:id/:kind",
    async (request, reply) => {
      if (!["file", "thumbnail"].includes(request.params.kind))
        return reply.code(404).send();
      let asset;
      try {
        asset = await getAsset(request.params.id);
      } catch {
        return reply.code(404).send();
      }
      const thumbnail = request.params.kind === "thumbnail";
      if (thumbnail && !asset.thumbUrl) return reply.code(404).send();
      const object = await s3.send(
        new GetObjectCommand({
          Bucket: config.s3Bucket,
          Key: asset.id + (thumbnail ? "_thumb" : ""),
        }),
      );
      const bytes = Buffer.from(await object.Body!.transformToByteArray());
      reply
        .type(thumbnail ? "image/jpeg" : asset.mime)
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("Accept-Ranges", "bytes");
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]),
          end = Math.min(
            range[2] ? Number(range[2]) : bytes.length - 1,
            bytes.length - 1,
          );
        if (start >= bytes.length || start > end) return reply.code(416).send();
        return reply
          .code(206)
          .header("Content-Range", `bytes ${start}-${end}/${bytes.length}`)
          .send(bytes.subarray(start, end + 1));
      }
      return reply.send(bytes);
    },
  );
  app.post<{
    Body: { recipe: Recipe; canvasId: string; graphVersion: number };
  }>("/runs", async (request, reply) => {
    const { recipe, canvasId, graphVersion } = request.body ?? {};
    const issues = validate(recipe, registry);
    if (issues.length) return reply.code(422).send(issues);
    if (graphVersion !== recipe.meta.version)
      return reply.code(422).send([
        {
          code: "VERSION",
          severity: "error",
          message: "graphVersion does not match the snapshot",
        },
      ]);
    if (
      !(await db.query("SELECT 1 FROM canvases WHERE id=$1", [canvasId]))
        .rowCount
    )
      return reply.code(404).send({ error: "Canvas not found" });
    const run: Run = {
      runId: `run_${crypto.randomUUID()}`,
      canvasId,
      graphVersion,
      status: "running",
      credits: 0,
      startedAt: new Date().toISOString(),
      jobs: [],
    };
    await db.query(
      "INSERT INTO runs(id,canvas_id,recipe,data) VALUES($1,$2,$3,$4)",
      [run.runId, canvasId, recipe, run],
    );
    await enqueue(run.runId);
    return reply.code(201).send(run);
  });
  app.get<{ Querystring: { canvasId: string } }>("/runs", async (request) =>
    (
      await db.query(
        "SELECT data FROM runs WHERE canvas_id=$1 ORDER BY created_at DESC LIMIT 30",
        [request.query.canvasId],
      )
    ).rows.map((r) => r.data),
  );
  app.get<{ Params: { id: string } }>(
    "/runs/:id",
    { schema: { params: idParams } },
    async (request, reply) => {
      const run = await getRun(request.params.id);
      return run ?? reply.code(404).send({ error: "Run not found" });
    },
  );
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    "/runs/:id/events",
    { websocket: true },
    (socket, request) => {
      let last = Number(request.query.after ?? 0),
        busy = false;
      const poll = async () => {
        if (busy || socket.readyState !== 1) return;
        busy = true;
        try {
          const { rows } = await db.query(
            "SELECT id,data FROM run_events WHERE run_id=$1 AND id>$2 ORDER BY id LIMIT 200",
            [request.params.id, last],
          );
          for (const row of rows) {
            if (socket.readyState === 1)
              socket.send(
                JSON.stringify({ ...row.data, eventId: Number(row.id) }),
              );
            last = Number(row.id);
          }
        } catch {
          socket.close(1011, "Event stream unavailable");
        } finally {
          busy = false;
        }
      };
      const timer = setInterval(() => {
        void poll();
      }, 100);
      void poll();
      socket.on("close", () => clearInterval(timer));
    },
  );
  app.post<{ Params: { id: string }; Body: { nodeId: string } }>(
    "/runs/:id/retry",
    { schema: { params: idParams } },
    async (request, reply) => {
      const run = await getRun(request.params.id);
      if (!run) return reply.code(404).send({ error: "Run not found" });
      if (run.status === "running")
        return reply
          .code(409)
          .send({ error: "Wait for the run to finish before retrying" });
      const { rows } = await db.query("SELECT recipe FROM runs WHERE id=$1", [
        run.runId,
      ]);
      const recipe: Recipe = rows[0].recipe;
      if (!recipe.nodes.some((n) => n.id === request.body?.nodeId))
        return reply.code(400).send({ error: "Node not found in this run" });
      const affected = new Set([request.body.nodeId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const edge of recipe.edges)
          if (affected.has(edge.source) && !affected.has(edge.target)) {
            affected.add(edge.target);
            grew = true;
          }
      }
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const updated = await client.query(
          "UPDATE runs SET generation=generation+1, data=(data-'finishedAt') || '{\"status\":\"running\"}'::jsonb WHERE id=$1 AND data->>'status'<>'running' RETURNING id",
          [run.runId],
        );
        if (!updated.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Run is already running" });
        }
        await client.query(
          "DELETE FROM jobs WHERE run_id=$1 AND node_id=ANY($2)",
          [run.runId, [...affected]],
        );
        await client.query(
          "DELETE FROM mock_failures WHERE run_id=$1 AND node_id=ANY($2)",
          [run.runId, [...affected]],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      await emit(run.runId, {
        type: "run.status",
        runId: run.runId,
        status: "running",
        credits: run.credits,
        at: new Date().toISOString(),
      });
      await enqueue(run.runId);
      return getRun(run.runId);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/runs/:id/cancel",
    { schema: { params: idParams } },
    async (request, reply) => {
      const run = await getRun(request.params.id);
      if (!run) return reply.code(404).send({ error: "Run not found" });
      if (run.status !== "running") return run;
      const usage = await db.query(
        "SELECT COALESCE(sum(credits),0) AS credits FROM usage WHERE run_id=$1",
        [run.runId],
      );
      const data = {
        ...run,
        jobs: [],
        status: "cancelled",
        credits: Number(usage.rows[0].credits),
        finishedAt: new Date().toISOString(),
      };
      const cancelled = await db.query(
        "UPDATE runs SET generation=generation+1,data=$2 WHERE id=$1 AND data->>'status'='running'",
        [run.runId, data],
      );
      if (!cancelled.rowCount) return getRun(run.runId);
      await db.query(
        "UPDATE jobs SET data=data || '{\"status\":\"cancelled\"}'::jsonb WHERE run_id=$1 AND data->>'status' IN ('queued','running')",
        [run.runId],
      );
      await emit(run.runId, {
        type: "run.status",
        runId: run.runId,
        status: "cancelled",
        credits: data.credits,
        at: new Date().toISOString(),
      });
      return getRun(run.runId);
    },
  );
  if (config.mock)
    app.post("/debug/asset", async () =>
      putAsset(
        new Blob(
          [
            new Uint8Array(
              await readFile(
                new URL("../../fixtures/portrait.png", import.meta.url),
              ),
            ),
          ],
          { type: "image/png" },
        ),
        { kind: "image" },
      ),
    );
  if (config.mock)
    app.post<{ Params: { id: string }; Body: { nodeId: string } }>(
      "/runs/:id/fail",
      async (request, reply) => {
        const run = await getRun(request.params.id);
        if (!run || run.status !== "running")
          return reply.code(409).send({ error: "Run must be running" });
        await db.query(
          "INSERT INTO mock_failures(run_id,node_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [run.runId, request.body.nodeId],
        );
        return { ok: true };
      },
    );
  return app;
}
