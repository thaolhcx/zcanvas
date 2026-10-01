import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ApiProblem,
  type Actor,
  listSpaces,
  notFound,
  personalSpaceId,
  requireCanvas,
  requireSpace,
} from "./access.ts";
import {
  assetUsage,
  beginAsset,
  cleanName,
  deleteAsset,
  failAsset,
  finishAsset,
  getAssetFor,
  listAssets,
  objectFor,
  parseListQuery,
  parsePatch,
  patchAsset,
  spool,
  toAsset,
} from "./assets.ts";
import { rm } from "node:fs/promises";
import { parseSearchQuery, searchAssets } from "./search.ts";
import { deliver, etagFor } from "./media.ts";
import { config } from "./config.ts";
import { storeFor } from "./storage.ts";
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const checkId = (value: unknown, what: string) => {
  if (typeof value !== "string" || !ID.test(value))
    throw new ApiProblem(400, "VALIDATION", `Invalid ${what}`);
  return value;
};
/** Catalog, media and search routes. `actor` is fixed by the server. */
export function registerAssetRoutes(app: FastifyInstance, actor: Actor) {
  app.get("/spaces", async () => listSpaces(actor));
  app.get("/assets", async (request) =>
    listAssets(actor, parseListQuery(request.query as Record<string, unknown>)),
  );
  app.get("/assets/search", async (request) =>
    searchAssets(actor, parseSearchQuery(request.query as Record<string, unknown>)),
  );
  app.post("/assets", async (request, reply) => {
    const query = request.query as { spaceId?: string; canvasId?: string };
    let spaceId: string, canvasId: string | undefined;
    if (query.canvasId !== undefined) {
      canvasId = checkId(query.canvasId, "canvasId");
      spaceId = await requireCanvas(actor, canvasId, "write");
      if (query.spaceId !== undefined && query.spaceId !== spaceId)
        throw new ApiProblem(400, "VALIDATION", "spaceId does not match the canvas space");
    } else {
      spaceId =
        query.spaceId === undefined ? personalSpaceId(actor.id) : checkId(query.spaceId, "spaceId");
      await requireSpace(actor, spaceId, "write", "Space not found");
    }
    const file = await request.file({
      limits: { fileSize: config.storage.maxUploadBytes, files: 1, fields: 4 },
    });
    if (!file) throw new ApiProblem(400, "BAD_REQUEST", "Choose a file");
    const field = file.fields.name as { value?: unknown } | undefined;
    let id: string;
    try {
      ({ id } = await beginAsset({
        spaceId,
        creatorId: actor.id,
        name: cleanName(field?.value ?? file.filename, "Untitled"),
        mime: file.mimetype.toLowerCase(),
        source: { type: "upload", ...(canvasId ? { canvasId } : {}) },
        publish: "ready",
      }));
    } catch (error) {
      file.file.resume();
      throw error;
    }
    let spooled;
    try {
      spooled = await spool(file.file);
      if (file.file.truncated)
        throw new ApiProblem(413, "TOO_LARGE", `Files are limited to ${Math.floor(config.storage.maxUploadBytes / 1024 / 1024)} MB`);
    } catch (error) {
      await failAsset(id, error);
      if (spooled) await rm(spooled.dir, { recursive: true, force: true });
      if (error instanceof ApiProblem) throw error;
      throw new ApiProblem(400, "UPLOAD_INTERRUPTED", "The upload did not finish");
    }
    return reply.code(201).send(await finishAsset(id, spooled, "ready"));
  });
  app.get<{ Params: { id: string } }>("/assets/:id", async (request) =>
    toAsset(await getAssetFor(actor, checkId(request.params.id, "asset ID"))),
  );
  app.patch<{ Params: { id: string } }>("/assets/:id", async (request) =>
    patchAsset(actor, checkId(request.params.id, "asset ID"), parsePatch(request.body)),
  );
  app.delete<{ Params: { id: string }; Querystring: { canvasId?: string } }>(
    "/assets/:id",
    async (request) =>
      deleteAsset(
        actor,
        checkId(request.params.id, "asset ID"),
        request.query.canvasId === undefined ? undefined : checkId(request.query.canvasId, "canvasId"),
      ),
  );
  app.get<{ Params: { id: string }; Querystring: { canvasId?: string } }>(
    "/assets/:id/usage",
    async (request) =>
      assetUsage(
        actor,
        checkId(request.params.id, "asset ID"),
        checkId(request.query.canvasId, "canvasId"),
      ),
  );
  const media = async (
    request: FastifyRequest<{ Params: { id: string; kind: string } }>,
    reply: FastifyReply,
  ) => {
    const { kind } = request.params;
    if (kind !== "file" && kind !== "thumbnail") throw notFound();
    const asset = await getAssetFor(actor, checkId(request.params.id, "asset ID"));
    let role = "original";
    const headers: Record<string, string> = {};
    if (kind === "thumbnail") {
      if (asset.preview_status === "ready") role = "thumbnail";
      else if (asset.kind === "image" && asset.preview_status !== "none")
        // Never block a valid original behind a missing preview.
        headers["X-Preview-Status"] = asset.preview_status;
      else if (asset.preview_status === "pending")
        throw new ApiProblem(404, "PREVIEW_PENDING", "The preview is being prepared", { retryAfterSec: 2 });
      else if (asset.preview_status === "failed")
        throw new ApiProblem(404, "PREVIEW_FAILED", "The preview could not be made");
      else throw notFound("This asset has no preview");
    }
    const object = await objectFor(asset.id, role);
    if (!object || object.state !== "stored")
      throw new ApiProblem(503, "STORAGE_UNAVAILABLE", "The stored file is not available");
    let bytes = object.bytes === null ? undefined : Number(object.bytes);
    try {
      bytes ??= (await storeFor(object.profile).stat(object.key))?.bytes;
    } catch {
      bytes = undefined;
    }
    if (bytes === undefined)
      throw new ApiProblem(503, "STORAGE_UNAVAILABLE", "The stored file is not available");
    const name = asset.name ?? asset.id;
    return deliver(
      request,
      reply,
      {
        profile: object.profile,
        key: object.key,
        bytes,
        mime: role === "thumbnail" ? "image/jpeg" : (object.mime ?? asset.mime),
        fingerprint: etagFor({ ...object, bytes }),
        name: role === "thumbnail" ? `${name.replace(/\.[^.]+$/, "")}-preview.jpg` : name,
      },
      headers,
    );
  };
  app.get("/assets/:id/:kind", media);
}
