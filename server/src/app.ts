import { isLocalOrigin } from "./origin.ts";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { Graph, Y, emptyRecipe } from "../../graph/src/index.ts";
import { validate, type Recipe, type Run } from "../../contracts/index.ts";
import { db } from "./db.ts";
import { registry } from "./registry.ts";
import { config } from "./config.ts";
import { putAsset, unavailableAssets } from "./assets.ts";
import { getRun, enqueue, emit } from "./runner.ts";
import {
  ApiProblem,
  type Access,
  type Actor,
  ensureActor,
  personalSpaceId,
  readableSpaceIds,
  requireCanvas,
  requireSpace,
} from "./access.ts";
import { registerAssetRoutes } from "./asset-routes.ts";
import { StorageError } from "./storage.ts";
const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" } },
};
/** Asset IDs referenced by `asset` params, with the node and param that use them. */
export function assetReferences(recipe: Recipe) {
  const refs: { nodeId: string; paramKey: string; assetId: string }[] = [];
  for (const node of recipe.nodes) {
    const entry = registry.get(node.type);
    for (const [paramKey, param] of Object.entries(entry?.params ?? {}))
      if (param.type === "asset" && typeof node.params[paramKey] === "string")
        refs.push({
          nodeId: node.id,
          paramKey,
          assetId: node.params[paramKey] as string,
        });
  }
  return refs;
}
/**
 * `actorId` is server configuration (or a test fixture), never request data.
 * The local POC has one configured identity; see docs/asset-platform.md.
 */
export async function createApp(options: { actorId?: string } = {}) {
  const actor: Actor = { id: options.actorId ?? config.actorId };
  await ensureActor(actor.id);
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiProblem)
      return reply.code(error.status).send(error.body());
    if (error instanceof StorageError)
      return reply
        .code(503)
        .send({ error: "Storage is unavailable", code: "STORAGE_UNAVAILABLE" });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status < 500)
      return reply.code(status).send({
        error: (error as Error).message,
        code: (error as { validation?: unknown }).validation
          ? "VALIDATION"
          : "BAD_REQUEST",
      });
    console.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });
  const requireRun = async (id: string, access: Access) => {
    const { rows } = await db.query("SELECT space_id FROM runs WHERE id=$1", [
      id,
    ]);
    await requireSpace(actor, rows[0]?.space_id, access, "Run not found");
    return rows[0].space_id as string;
  };
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
          'SELECT id, name, version, updated_at, space_id AS "spaceId", project_id AS "projectId" FROM canvases WHERE space_id = ANY($1) ORDER BY updated_at DESC',
          [await readableSpaceIds(actor)],
        )
      ).rows,
  );
  app.post<{ Body: { name: string; spaceId?: string; projectId?: string } }>(
    "/canvases",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            spaceId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" },
            projectId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" },
          },
        },
      },
    },
    async (request) => {
      const spaceId = request.body.spaceId ?? personalSpaceId(actor.id);
      await requireSpace(actor, spaceId, "write", "Space not found");
      const projectId = request.body.projectId ?? null;
      if (
        projectId &&
        !(
          await db.query("SELECT 1 FROM projects WHERE id=$1 AND space_id=$2", [
            projectId,
            spaceId,
          ])
        ).rowCount
      )
        throw new ApiProblem(
          400,
          "VALIDATION",
          "The project is not in this space",
        );
      const recipe = emptyRecipe(undefined, request.body.name);
      const graph = new Graph(new Y.Doc(), registry, recipe);
      const bytes = Buffer.from(Y.encodeStateAsUpdate(graph.doc));
      graph.destroy();
      graph.doc.destroy();
      await db.query(
        "INSERT INTO canvases(id,name,ydoc,snapshot,space_id,project_id) VALUES($1,$2,$3,$4,$5,$6)",
        [recipe.meta.id, recipe.meta.name, bytes, recipe, spaceId, projectId],
      );
      return { canvasId: recipe.meta.id, spaceId };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/canvases/:id",
    { schema: { params: idParams } },
    async (request, reply) => {
      await requireCanvas(actor, request.params.id, "read");
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
  registerAssetRoutes(app, actor);
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
    if (typeof canvasId !== "string")
      return reply.code(404).send({ error: "Canvas not found" });
    const spaceId = await requireCanvas(actor, canvasId, "write");
    // Assets must be ready and in the canvas space. Deleted, missing and
    // other-space assets look the same: the input needs a new file.
    const refs = assetReferences(recipe);
    const missing = new Set(
      await unavailableAssets(
        [...new Set(refs.map((r) => r.assetId))],
        spaceId,
      ),
    );
    const inputIssues = refs
      .filter((r) => missing.has(r.assetId))
      .map((r) => ({
        code: "INPUT_REQUIRED",
        severity: "error",
        nodeId: r.nodeId,
        paramKey: r.paramKey,
        message:
          "This file was deleted or is not available in this space. Choose another file.",
      }));
    if (inputIssues.length) return reply.code(422).send(inputIssues);
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
      "INSERT INTO runs(id,canvas_id,recipe,data,space_id,actor_id) VALUES($1,$2,$3,$4,$5,$6)",
      [run.runId, canvasId, recipe, run, spaceId, actor.id],
    );
    await enqueue(run.runId);
    return reply.code(201).send(run);
  });
  app.get<{ Querystring: { canvasId: string } }>("/runs", async (request) => {
    if (typeof request.query.canvasId !== "string")
      throw new ApiProblem(400, "VALIDATION", "canvasId is required");
    await requireCanvas(actor, request.query.canvasId, "read");
    return (
      await db.query(
        "SELECT data FROM runs WHERE canvas_id=$1 ORDER BY created_at DESC LIMIT 30",
        [request.query.canvasId],
      )
    ).rows.map((r) => r.data);
  });
  app.get<{ Params: { id: string } }>(
    "/runs/:id",
    { schema: { params: idParams } },
    async (request, reply) => {
      await requireRun(request.params.id, "read");
      const run = await getRun(request.params.id);
      return run ?? reply.code(404).send({ error: "Run not found" });
    },
  );
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    "/runs/:id/events",
    { websocket: true },
    async (socket, request) => {
      try {
        await requireRun(request.params.id, "read");
      } catch {
        socket.close(1008, "Run not found");
        return;
      }
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
      await requireRun(request.params.id, "write");
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
      await requireRun(request.params.id, "write");
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
        {
          kind: "image",
          name: "portrait.png",
          spaceId: personalSpaceId(actor.id),
          creatorId: actor.id,
          source: { type: "upload" },
          publish: "ready",
        },
      ),
    );
  if (config.mock)
    app.post<{ Params: { id: string }; Body: { nodeId: string } }>(
      "/runs/:id/fail",
      async (request, reply) => {
        await requireRun(request.params.id, "write");
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
