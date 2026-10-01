import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiProblem } from "./access.ts";
import { StorageError, storeFor, type ByteRange } from "./storage.ts";
export type RangeResult =
  | { type: "full" }
  | { type: "partial"; range: ByteRange }
  | { type: "unsatisfiable" };
/**
 * RFC 9110 single byte ranges: `a-b`, open-ended `a-` and suffix `-n`.
 * Other units and multi-range requests are ignored (full response), which
 * the RFC allows. Ranges outside the object are 416.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): RangeResult {
  if (!header) return { type: "full" };
  const match = header.trim().match(/^bytes=\s*(\d*)\s*-\s*(\d*)\s*$/i);
  if (!match) return { type: "full" };
  const [, first, last] = match;
  if (!first && !last) return { type: "unsatisfiable" };
  if (!first) {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return { type: "unsatisfiable" };
    return {
      type: "partial",
      range: { start: Math.max(0, size - suffix), end: size - 1 },
    };
  }
  const start = Number(first);
  const end = last ? Math.min(Number(last), size - 1) : size - 1;
  if (start >= size || (last && Number(last) < start))
    return { type: "unsatisfiable" };
  return { type: "partial", range: { start, end } };
}
/** ASCII fallback plus RFC 5987 UTF-8 name; never contains quotes or path parts. */
export function contentDisposition(name: string, download: boolean) {
  const safe = name.replace(/[\u0000-\u001f\u007f"\\/]/g, "_");
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
export interface Deliverable {
  profile: string;
  key: string;
  bytes: number;
  mime: string;
  /** Content fingerprint; objects are immutable, so this is a strong validator. */
  fingerprint: string;
  name: string;
}
export const etagFor = (object: {
  sha256: string | null;
  profile: string;
  key: string;
  bytes: number;
}) =>
  `"${(object.sha256 ?? createHash("sha256").update(`${object.profile}:${object.key}:${object.bytes}`).digest("hex")).slice(0, 40)}"`;
/**
 * Streams one stored object. Access must be checked by the caller first.
 * Memory stays bounded: bytes flow from the store to the socket, and a client
 * disconnect destroys the upstream stream (and aborts the S3 request).
 */
export async function deliver(
  request: FastifyRequest,
  reply: FastifyReply,
  object: Deliverable,
  extraHeaders: Record<string, string> = {},
) {
  const download = (request.query as { download?: string })?.download === "1";
  reply
    .header("Content-Type", object.mime)
    .header("Accept-Ranges", "bytes")
    .header("ETag", object.fingerprint)
    // Private media: the browser may keep a copy but must revalidate, so
    // every use passes the access check. No shared/proxy caching.
    .header("Cache-Control", "private, no-cache")
    .header("X-Content-Type-Options", "nosniff")
    .header("Content-Disposition", contentDisposition(object.name, download));
  for (const [key, value] of Object.entries(extraHeaders))
    reply.header(key, value);
  const ifNoneMatch = request.headers["if-none-match"];
  if (
    ifNoneMatch &&
    ifNoneMatch
      .split(/\s*,\s*/)
      .some((tag) => tag === object.fingerprint || tag === "*")
  )
    return reply.code(304).send();
  const ifRange = request.headers["if-range"];
  const rangeHeader =
    ifRange && ifRange !== object.fingerprint
      ? undefined
      : request.headers.range;
  const parsed = parseRange(rangeHeader, object.bytes);
  if (parsed.type === "unsatisfiable")
    return reply
      .code(416)
      .header("Content-Range", `bytes */${object.bytes}`)
      .header("Content-Type", "application/json")
      .send({
        error: "Requested range is outside the file",
        code: "RANGE_NOT_SATISFIABLE",
        details: { size: object.bytes },
      });
  const range = parsed.type === "partial" ? parsed.range : undefined;
  const length = range ? range.end - range.start + 1 : object.bytes;
  reply.header("Content-Length", String(length));
  if (range)
    reply
      .code(206)
      .header(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${object.bytes}`,
      );
  if (request.method === "HEAD") {
    // Send headers only, keeping the real Content-Length, without opening storage.
    reply.hijack();
    reply.raw.writeHead(
      reply.statusCode,
      reply.getHeaders() as Record<string, string>,
    );
    reply.raw.end();
    return reply;
  }
  if (length === 0) return reply.send();
  const controller = new AbortController();
  let stream;
  try {
    stream = await storeFor(object.profile).read(object.key, {
      range,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof StorageError)
      throw new ApiProblem(
        503,
        "STORAGE_UNAVAILABLE",
        error.code === "NOT_FOUND"
          ? "The stored file is missing"
          : "The file's storage is unavailable",
      );
    throw error;
  }
  reply.raw.on("close", () => {
    if (!reply.raw.writableFinished) {
      controller.abort();
      stream.destroy();
    }
  });
  return reply.send(stream);
}
