import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const envPath = fileURLToPath(new URL("../../.env.local", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
export const config = {
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://zcanvas:zcanvas@127.0.0.1:55432/zcanvas",
  s3Endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:59000",
  s3Bucket: process.env.S3_BUCKET ?? "zcanvas",
  s3AccessKey: process.env.S3_ACCESS_KEY ?? "zcanvas",
  s3SecretKey: process.env.S3_SECRET_KEY ?? "zcanvas-local-only",
  apiPort: Number(process.env.API_PORT ?? 4310),
  syncPort: Number(process.env.SYNC_PORT ?? 4311),
  publicUrl: process.env.PUBLIC_API_URL ?? "http://127.0.0.1:4310",
  mock: process.env.MOCK_WORKERS !== "0",
};
