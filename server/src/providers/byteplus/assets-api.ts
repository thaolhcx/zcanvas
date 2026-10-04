import { createHash, createHmac } from "node:crypto";
import { call, json } from "./http.ts";
import { ProviderError } from "../types.ts";
/**
 * BytePlus Assets OpenAPI: registers media as trusted `asset://` references,
 * the path real-person references take through the Seedance input screen.
 * A control-plane API signed with the IAM key pair (HMAC-SHA256, Action +
 * Version in the query string).
 */
const SERVICE = "ark";
const VERSION = "2024-01-01";
const PROJECT = "default";
export type AssetType = "Image" | "Video" | "Audio";
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const hmac = (key: Buffer | string, v: string) => createHmac("sha256", key).update(v).digest();
const encode = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
/** `ark.ap-southeast-1.byteplusapi.com` → `ap-southeast-1`. */
export const regionOf = (host: string) => /^[^.]+\.([a-z]+-[a-z]+-\d+)\./.exec(host)?.[1] ?? "ap-southeast-1";
/** Pure, so the canonical request can be pinned in tests. */
export function signRequest(args: { action: string; payload: unknown; accessKey: string; secretKey: string; baseUrl: string; date: Date }) {
  const base = args.baseUrl.replace(/\/+$/, "");
  const host = new URL(base).host;
  const region = regionOf(host);
  const body = JSON.stringify(args.payload ?? {});
  const bodyHash = sha256(body);
  const xDate = args.date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = xDate.slice(0, 8);
  const query = [
    ["Action", args.action],
    ["Version", VERSION],
  ]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encode(k)}=${encode(v)}`)
    .join("&");
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonical = ["POST", "/", query, `content-type:application/json\nhost:${host}\nx-content-sha256:${bodyHash}\nx-date:${xDate}\n`, signedHeaders, bodyHash].join("\n");
  const scope = `${day}/${region}/${SERVICE}/request`;
  const toSign = ["HMAC-SHA256", xDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(Buffer.from(args.secretKey, "utf8"), day), region), SERVICE), "request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    url: `${base}/?${query}`,
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Date": xDate,
      "X-Content-Sha256": bodyHash,
      Authorization: `HMAC-SHA256 Credential=${args.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
type AssetsResponse = { ResponseMetadata?: { Error?: { Code?: string; Message?: string } }; Result?: { Id?: string; Status?: string } };
export class AssetsApi {
  constructor(
    private readonly opts: { accessKey: string; secretKey: string; baseUrl: string; now?: () => Date; sleep?: (ms: number) => Promise<void> },
  ) {}
  async call(action: string, payload: unknown) {
    const signed = signRequest({ action, payload, ...this.opts, date: (this.opts.now ?? (() => new Date()))() });
    const response = await call(signed.url, { method: "POST", headers: signed.headers, body: signed.body });
    const data = await json<AssetsResponse>(response);
    const error = data.ResponseMetadata?.Error;
    if (!response.ok || error)
      throw new ProviderError(`BytePlus Assets ${action} failed (${response.status}): ${error?.Message ?? error?.Code ?? "no message"}`, response.status === 429 || response.status >= 500);
    return data;
  }
  async createGroup(name: string) {
    const data = await this.call("CreateAssetGroup", { Name: name, Description: "zcanvas references", GroupType: "AIGC", ProjectName: PROJECT });
    return data.Result?.Id || name;
  }
  /** Registers a fetchable URL (a presigned TOS URL) as an owned, trusted reference. */
  async createAsset(args: { groupId: string; url: string; type: AssetType; name: string }) {
    const data = await this.call("CreateAsset", {
      GroupId: args.groupId,
      URL: args.url,
      AssetType: args.type,
      ProjectName: PROJECT,
      Moderation: { Strategy: "Skip" },
      Name: args.name.slice(0, 120),
    });
    if (!data.Result?.Id) throw new ProviderError("BytePlus Assets CreateAsset returned no id");
    return data.Result.Id;
  }
  async status(id: string) {
    return String((await this.call("GetAsset", { Id: id, ProjectName: PROJECT })).Result?.Status ?? "");
  }
  /** An id that never went Active is not a usable reference. */
  async waitActive(id: string, intervalMs = 2000, attempts = 30) {
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let i = 0; i < attempts; i++) {
      const s = await this.status(id);
      if (s === "Active") return;
      if (s === "Failed") throw new ProviderError(`BytePlus asset ${id} failed to ingest`);
      if (i < attempts - 1) await sleep(intervalMs);
    }
    throw new ProviderError(`BytePlus asset ${id} did not become Active`);
  }
}
export const isMissingGroup = (error: unknown) => {
  const m = String((error as Error)?.message ?? error);
  return /asset_?group/i.test(m) && /not ?found|not exist/i.test(m);
};
