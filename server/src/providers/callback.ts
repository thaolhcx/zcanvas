import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.ts";
/**
 * Signs provider callback URLs, so only a provider we gave the URL to can wake
 * a fetch. The secret is CALLBACK_SECRET, else derived from the database URL
 * (stable across restarts, never sent anywhere).
 */
const secret = () =>
  process.env.CALLBACK_SECRET ||
  createHmac("sha256", "zcanvas-callback").update(config.databaseUrl).digest("hex");
export const callbackSig = (taskId: string) =>
  createHmac("sha256", secret()).update(taskId).digest("hex").slice(0, 32);
export function callbackValid(taskId: string, sig: string) {
  const want = Buffer.from(callbackSig(taskId));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
/** The URL handed to the provider, or undefined when no public URL is configured. */
export function callbackUrl(taskId: string) {
  const base = process.env.PROVIDER_CALLBACK_BASE_URL;
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/providers/callback?task=${encodeURIComponent(taskId)}&sig=${callbackSig(taskId)}`;
}
