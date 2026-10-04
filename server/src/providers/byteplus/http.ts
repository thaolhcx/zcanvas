import { isIP } from "node:net";
import { ProviderError, isTransientStatus } from "../types.ts";
/** The fetch the BytePlus adapter uses; tests replace it with recorded responses. */
let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);
export const setBytePlusFetch = (impl?: typeof fetch) => {
  fetchImpl = impl ?? ((...args) => globalThis.fetch(...args));
};
export async function call(url: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    if ((init.signal as AbortSignal | undefined)?.aborted) throw error;
    throw new ProviderError(
      `BytePlus could not be reached: ${(error as Error).message}`,
      true,
      "PROVIDER_UNREACHABLE",
    );
  }
  return response;
}
export async function json<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}
type ApiError = {
  error?: { code?: string; message?: string } | string;
  message?: string;
  code?: string | number;
};
/** `code: message` from any BytePlus error body. */
export function apiMessage(body: ApiError, fallback: string) {
  const e = body.error;
  if (typeof e === "string") return e;
  if (e?.code && e.message) return `${e.code}: ${e.message}`;
  return e?.message ?? e?.code ?? body.message ?? fallback;
}
/** 429 / 5xx are transient (retried); any other failure stops with the API's message. */
export function failure(what: string, response: Response, body: ApiError) {
  const message = `${what} failed (${response.status}): ${apiMessage(body, "no message")}`;
  return new ProviderError(
    message,
    isTransientStatus(response.status),
    isTransientStatus(response.status) ? "PROVIDER_BUSY" : "PROVIDER_ERROR",
  );
}
const PRIVATE = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^::1$/,
  /^f[cd]/i,
  /^fe80/i,
];
/**
 * Downloads a result URL the API returned, straight away (ModelArk image URLs
 * live 24 hours). Only https to public hosts, at most `maxBytes`.
 */
export async function download(
  url: string,
  what: string,
  maxBytes = 1024 * 1024 * 1024,
): Promise<Uint8Array> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ProviderError(`BytePlus returned an invalid ${what} URL`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (
    parsed.protocol !== "https:" ||
    host === "localhost" ||
    (isIP(host) && PRIVATE.some((p) => p.test(host)))
  )
    throw new ProviderError(
      `Refusing to download the ${what} from ${parsed.protocol}//${host}`,
    );
  const response = await call(url, { redirect: "follow" });
  if (!response.ok)
    throw new ProviderError(
      `Could not download the BytePlus ${what} (${response.status})`,
      isTransientStatus(response.status),
    );
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxBytes)
    throw new ProviderError(`The BytePlus ${what} is too large`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxBytes)
    throw new ProviderError(`The BytePlus ${what} is too large`);
  return bytes;
}
