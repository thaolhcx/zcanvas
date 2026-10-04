import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { db } from "../../db.ts";
import { ProviderError } from "../types.ts";
import type { BytePlusConfig } from "./config.ts";
import { AssetsApi, isMissingGroup, type AssetType } from "./assets-api.ts";
/**
 * Reference pipeline: every reference is staged to the account's TOS bucket
 * under its sha256; what we learn about those bytes (Assets id, real person)
 * is cached in Postgres (provider_media) instead of a sidecar file. Real-person
 * media is registered in Assets and sent as asset://; the rest as a short
 * presigned URL. An expired TOS object is simply staged again.
 */
export type MediaKind = "image" | "video" | "audio";
export interface Staged {
  kind: MediaKind;
  sha: string;
  key: string;
  mime: string;
  size: number;
  meta: { assetId?: string; realPerson?: boolean; assetType?: AssetType };
}
/** The slice of TOS this needs; tests fake it. */
export interface MediaStore {
  exists(key: string): Promise<boolean>;
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  presign(key: string, seconds: number): string;
}
const PRESIGN_SECONDS = 3600;
const LIMITS: Record<
  MediaKind,
  { type: AssetType; max: number; mimes: string[] }
> = {
  image: {
    type: "Image",
    max: 30 << 20,
    mimes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/bmp",
      "image/tiff",
      "image/gif",
      "image/heic",
      "image/heif",
    ],
  },
  video: {
    type: "Video",
    max: 200 << 20,
    mimes: ["video/mp4", "video/quicktime"],
  },
  audio: {
    type: "Audio",
    max: 15 << 20,
    mimes: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave"],
  },
};
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
};
const sha256 = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const hmac = (key: Buffer | string, v: string) =>
  createHmac("sha256", key).update(v).digest();
const uri = (v: string) =>
  encodeURIComponent(v).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
/** SigV4 query presign (GET), as S3 and TOS's S3 endpoint accept it. Pure, for tests. */
export function presignUrl(args: {
  endpoint: string;
  bucket: string;
  key: string;
  region: string;
  accessKey: string;
  secretKey: string;
  seconds: number;
  date: Date;
}) {
  const endpoint = new URL(args.endpoint);
  const host = `${args.bucket}.${endpoint.host}`;
  const amzDate = args.date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${args.region}/s3/aws4_request`;
  const path = "/" + args.key.split("/").map(uri).join("/");
  const query = Object.entries({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${args.accessKey}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(args.seconds),
    "X-Amz-SignedHeaders": "host",
  })
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${uri(k)}=${uri(v)}`)
    .join("&");
  const canonical = [
    "GET",
    path,
    query,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join(
    "\n",
  );
  const key = hmac(
    hmac(hmac(hmac(`AWS4${args.secretKey}`, day), args.region), "s3"),
    "aws4_request",
  );
  return `${endpoint.protocol}//${host}${path}?${query}&X-Amz-Signature=${createHmac("sha256", key).update(toSign).digest("hex")}`;
}
export function tosStore(cfg: BytePlusConfig): MediaStore {
  const tos = cfg.tos!;
  const client = new S3Client({
    region: tos.region,
    endpoint: tos.endpoint,
    forcePathStyle: false,
    credentials: {
      accessKeyId: cfg.accessKey!,
      secretAccessKey: cfg.secretKey!,
    },
  });
  return {
    async exists(key) {
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: tos.bucket, Key: key }),
        );
        return true;
      } catch (e) {
        if (
          (e as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode === 404
        )
          return false;
        throw new ProviderError(
          `TOS is unavailable: ${(e as Error).message}`,
          true,
        );
      }
    },
    async put(key, bytes, mime) {
      await client.send(
        new PutObjectCommand({
          Bucket: tos.bucket,
          Key: key,
          Body: bytes,
          ContentType: mime,
        }),
      );
    },
    presign: (key, seconds) =>
      presignUrl({
        endpoint: tos.endpoint,
        bucket: tos.bucket,
        key,
        region: tos.region,
        accessKey: cfg.accessKey!,
        secretKey: cfg.secretKey!,
        seconds,
        date: new Date(),
      }),
  };
}
export class MediaPipeline {
  constructor(
    private readonly cfg: BytePlusConfig,
    private readonly store: MediaStore,
    private readonly assets: AssetsApi | null,
    /** Real-person pre-check of an image (by URL); undefined = could not decide. */
    private readonly verify?: (url: string) => Promise<boolean | undefined>,
  ) {}
  get assetsOn() {
    return this.cfg.assetMode !== "off" && this.assets !== null;
  }
  async stage(
    kind: MediaKind,
    bytes: Uint8Array,
    mime: string,
  ): Promise<Staged> {
    const sha = sha256(bytes);
    const key = `${this.cfg.tos!.prefix}/${sha}.${EXT[mime] ?? "bin"}`;
    if (!(await this.store.exists(key))) await this.store.put(key, bytes, mime);
    const { rows } = await db.query(
      "SELECT provider_asset_id, real_person, asset_type FROM provider_media WHERE provider='byteplus' AND sha256=$1",
      [sha],
    );
    const r = rows[0];
    await db.query(
      `INSERT INTO provider_media(sha256, provider, object_key) VALUES($1,'byteplus',$2)
       ON CONFLICT (provider, sha256) DO UPDATE SET object_key=EXCLUDED.object_key, updated_at=now()`,
      [sha, key],
    );
    return {
      kind,
      sha,
      key,
      mime,
      size: bytes.length,
      meta: {
        ...(r?.provider_asset_id ? { assetId: r.provider_asset_id } : {}),
        ...(r?.real_person !== null && r?.real_person !== undefined
          ? { realPerson: r.real_person }
          : {}),
        ...(r?.asset_type ? { assetType: r.asset_type } : {}),
      },
    };
  }
  url(media: Staged) {
    return this.store.presign(media.key, PRESIGN_SECONDS);
  }
  private async save(media: Staged) {
    await db.query(
      "UPDATE provider_media SET provider_asset_id=$2, real_person=$3, asset_type=$4, updated_at=now() WHERE provider='byteplus' AND sha256=$1",
      [
        media.sha,
        media.meta.assetId ?? null,
        media.meta.realPerson ?? null,
        media.meta.assetType ?? null,
      ],
    );
  }
  /** The real-person pre-check, cached per sha. Its own queue step (prepare), never inside a submit. */
  async check(media: Staged) {
    if (
      !this.assetsOn ||
      this.cfg.assetMode !== "verify" ||
      media.kind !== "image" ||
      media.meta.realPerson !== undefined ||
      !this.verify
    )
      return;
    const verdict = await this.verify(this.url(media)).catch(() => undefined);
    if (verdict === undefined) return;
    media.meta.realPerson = verdict;
    await this.save(media);
  }
  /** Whether policy says this needs an asset:// before the first submit. */
  needsAsset(media: Staged) {
    if (!this.assetsOn || media.meta.assetId) return false;
    return (
      media.meta.realPerson === true ||
      (this.cfg.assetMode === "always" && media.kind !== "audio")
    );
  }
  /** The URL Seedance gets: a cached asset://, else a presigned URL. Never registers (prepare did). */
  resolve(media: Staged) {
    return media.meta.assetId && this.assetsOn
      ? `asset://${media.meta.assetId}`
      : this.url(media);
  }
  /** Registers media in Assets from its TOS object; null when it cannot be an asset. */
  async register(media: Staged, opts: { realPerson?: boolean } = {}) {
    if (!this.assets || !this.assetsOn) return null;
    const limit = LIMITS[media.kind];
    if (media.size > limit.max || !limit.mimes.includes(media.mime))
      return null;
    const url = this.url(media);
    const name = `zcanvas-${media.sha.slice(0, 16)}`;
    let id: string;
    try {
      id = await this.assets.createAsset({
        groupId: await this.group(),
        url,
        type: limit.type,
        name,
      });
    } catch (error) {
      if (!isMissingGroup(error)) throw error;
      id = await this.assets.createAsset({
        groupId: await this.group(true),
        url,
        type: limit.type,
        name,
      });
    }
    await this.assets.waitActive(id);
    media.meta = {
      ...media.meta,
      assetId: id,
      assetType: limit.type,
      ...(opts.realPerson ? { realPerson: true } : {}),
    };
    await this.save(media);
    return `asset://${id}`;
  }
  async forget(media: Staged) {
    delete media.meta.assetId;
    await this.save(media);
  }
  private async group(fresh = false) {
    if (this.cfg.assetGroupId && !fresh) return this.cfg.assetGroupId;
    if (!fresh) {
      const { rows } = await db.query(
        "SELECT value FROM provider_state WHERE key='byteplus:asset-group'",
      );
      if (rows[0]?.value?.groupId) return rows[0].value.groupId as string;
    }
    const groupId = await this.assets!.createGroup(
      `zcanvas-${Date.now()}-${randomBytes(4).toString("hex")}`,
    );
    await db.query(
      "INSERT INTO provider_state(key, value) VALUES('byteplus:asset-group', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()",
      [{ groupId }],
    );
    return groupId;
  }
}
