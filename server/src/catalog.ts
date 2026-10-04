import { loadModels } from "../../contracts/node.mjs";
import type { ModelSpec } from "../../contracts/index.ts";
import { config } from "./config.ts";
import { adapterFor } from "./providers/index.ts";
/**
 * The model catalog: contracts/models/*.json plus the account's own endpoints
 * (`ep-…`) from BYTEPLUS_{LANGUAGE,IMAGE,VIDEO}_MODELS ("id" or "id|Name",
 * comma-separated). An extra endpoint copies the fields and limits of the
 * built-in model of its kind and is never the Auto default.
 */
const builtin = loadModels(
  new URL("../../contracts/models/", import.meta.url).pathname,
);
function extra(kind: ModelSpec["kind"], value: string | undefined): ModelSpec[] {
  const base = builtin.find((m) => m.kind === kind && m.default);
  if (!value || !base) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, ...rest] = entry.split("|");
      const key = id.trim().toLowerCase().replace(/[^a-z0-9.-]/g, "-").slice(0, 60);
      return {
        ...structuredClone(base),
        key: /^[a-z]/.test(key) ? key : `m-${key}`,
        title: rest.join("|").trim() || id.trim(),
        description: `Account endpoint ${id.trim()}`,
        providerModel: id.trim(),
        default: false,
      };
    })
    .filter((m) => !builtin.some((b) => b.key === m.key));
}
export const models: ModelSpec[] = [
  ...builtin,
  ...extra("llm", process.env.BYTEPLUS_LANGUAGE_MODELS),
  ...extra("image", process.env.BYTEPLUS_IMAGE_MODELS),
  ...extra("video", process.env.BYTEPLUS_VIDEO_MODELS),
];
export const modelByKey = (key: string) => models.find((m) => m.key === key);
export function modelsResponse() {
  return {
    models,
    mode: config.mock ? ("mock" as const) : ("live" as const),
    unavailable: models
      .filter((m) => !adapterFor(m).available(m))
      .map((m) => m.key),
  };
}
