import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const envPath = fileURLToPath(new URL("../../.env.local", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const env = process.env;
const number = (value: string | undefined, fallback: number) =>
  value === undefined || value === "" ? fallback : Number(value);
export interface S3ProfileConfig {
  id: string;
  driver: "s3";
  endpoint?: string;
  bucket: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
  /** Optional key prefix inside the bucket. */
  prefix?: string;
}
export interface LocalProfileConfig {
  id: string;
  driver: "local";
  root: string;
}
export type StorageProfileConfig = S3ProfileConfig | LocalProfileConfig;
const driver = env.STORAGE_DRIVER === "s3" ? "s3" : "local";
/** The S3 settings the POC has always used. Legacy assets live here. */
const s3Profile: S3ProfileConfig = {
  id: env.S3_PROFILE_ID ?? "s3",
  driver: "s3",
  endpoint: env.S3_ENDPOINT ?? "http://127.0.0.1:59000",
  bucket: env.S3_BUCKET ?? "zcanvas",
  region: env.S3_REGION ?? "us-east-1",
  accessKeyId: env.S3_ACCESS_KEY ?? "zcanvas",
  secretAccessKey: env.S3_SECRET_KEY ?? "zcanvas-local-only",
  forcePathStyle: env.S3_FORCE_PATH_STYLE !== "0",
  prefix: env.S3_PREFIX || undefined,
};
const localProfile: LocalProfileConfig = {
  id: env.LOCAL_STORAGE_PROFILE_ID ?? "local",
  driver: "local",
  root: resolve(repoRoot, env.LOCAL_STORAGE_ROOT ?? ".data/assets"),
};
/** Extra read-only profiles, e.g. an old bucket after moving to a new one. */
const extraProfiles: StorageProfileConfig[] = env.STORAGE_READ_PROFILES
  ? JSON.parse(env.STORAGE_READ_PROFILES)
  : [];
export const config = {
  databaseUrl:
    env.DATABASE_URL ?? "postgres://zcanvas:zcanvas@127.0.0.1:55432/zcanvas",
  apiPort: number(env.API_PORT, 4310),
  syncPort: number(env.SYNC_PORT, 4311),
  publicUrl: env.PUBLIC_API_URL ?? "http://127.0.0.1:4310",
  mock: env.MOCK_WORKERS !== "0",
  /** The single identity of this local POC. Clients cannot choose another. */
  actorId: env.ZCANVAS_ACTOR_ID ?? "usr_local",
  storage: {
    /** New originals and derivatives are written here. */
    writeProfile: driver === "s3" ? s3Profile.id : localProfile.id,
    profiles: [
      localProfile,
      ...(driver === "s3" || env.S3_LEGACY_READ !== "0" ? [s3Profile] : []),
      ...extraProfiles,
    ] as StorageProfileConfig[],
    /** Create the bucket on startup. Off by default: production buckets are provisioned. */
    autoCreateBucket: env.S3_AUTO_CREATE_BUCKET === "1",
    maxUploadBytes: number(env.MAX_UPLOAD_BYTES, 100 * 1024 * 1024),
    tmpDir: env.ASSET_TMP_DIR || undefined,
    /** Deleted files stay readable to in-flight runs this long before purge. */
    cleanupDelaySec: number(env.ASSET_CLEANUP_DELAY_SEC, 3600),
    /** Uploads/outputs stuck in uploading/processing longer than this are failed. */
    staleWriteSec: number(env.ASSET_STALE_WRITE_SEC, 3600),
  },
  search: {
    enabled: env.SEARCH_SEMANTIC !== "0",
    /** none | hash | local | openai */
    provider: env.EMBEDDING_PROVIDER ?? "none",
    model: env.EMBEDDING_MODEL,
    dims: env.EMBEDDING_DIMS ? Number(env.EMBEDDING_DIMS) : undefined,
    url: env.EMBEDDING_URL,
    apiKey: env.EMBEDDING_API_KEY,
    queryTimeoutMs: number(env.SEARCH_TIMEOUT_MS, 2500),
  },
};
