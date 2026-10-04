/**
 * BytePlus settings. Keys only ever come from the environment; they are never
 * logged, stored or sent anywhere but BytePlus.
 */
export const BYTEPLUS_DEFAULT_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
export const BYTEPLUS_DEFAULT_VOICE_BASE_URL = "https://voice.ap-southeast-1.bytepluses.com";
export const BYTEPLUS_DEFAULT_ASSETS_BASE_URL = "https://ark.ap-southeast-1.byteplusapi.com";
export type AssetMode = "verify" | "lazy" | "always" | "off";
export interface BytePlusConfig {
  apiKey?: string;
  baseUrl: string;
  voiceApiKey?: string;
  voiceBaseUrl: string;
  accessKey?: string;
  secretKey?: string;
  tos?: { bucket: string; region: string; endpoint: string; prefix: string };
  assetMode: AssetMode;
  assetGroupId?: string;
  assetsBaseUrl: string;
  verifyModel: string;
}
const trim = (url: string) => url.replace(/\/+$/, "");
export function readConfig(env: NodeJS.ProcessEnv = process.env): BytePlusConfig {
  const region = env.BYTEPLUS_TOS_REGION || "ap-southeast-1";
  const accessKey = env.BYTEPLUS_ACCESS_KEY || undefined;
  const secretKey = env.BYTEPLUS_SECRET_KEY || undefined;
  const bucket = env.BYTEPLUS_TOS_BUCKET || undefined;
  const mode = String(env.BYTEPLUS_ASSET_MODE || "verify").toLowerCase();
  return {
    apiKey: env.BYTEPLUS_API_KEY || undefined,
    baseUrl: trim(env.BYTEPLUS_BASE_URL || BYTEPLUS_DEFAULT_BASE_URL),
    voiceApiKey: env.BYTEPLUS_VOICE_API_KEY || undefined,
    voiceBaseUrl: trim(env.BYTEPLUS_VOICE_BASE_URL || BYTEPLUS_DEFAULT_VOICE_BASE_URL),
    accessKey,
    secretKey,
    // TOS staging (and with it Assets) turns on with the IAM key pair and a bucket.
    ...(accessKey && secretKey && bucket
      ? {
          tos: {
            bucket,
            region,
            // TOS speaks the S3 API on its tos-s3-<region> endpoint.
            endpoint: trim(env.BYTEPLUS_TOS_ENDPOINT || `https://tos-s3-${region}.bytepluses.com`),
            prefix: (env.BYTEPLUS_TOS_PREFIX || "zcanvas/byteplus").replace(/^\/+|\/+$/g, ""),
          },
        }
      : {}),
    assetMode: (["verify", "lazy", "always", "off"].includes(mode) ? mode : "verify") as AssetMode,
    assetGroupId: env.BYTEPLUS_ASSET_GROUP_ID || undefined,
    assetsBaseUrl: trim(env.BYTEPLUS_ASSETS_BASE_URL || BYTEPLUS_DEFAULT_ASSETS_BASE_URL),
    verifyModel: env.BYTEPLUS_VERIFY_MODEL || "seed-2-0-pro-260328",
  };
}
