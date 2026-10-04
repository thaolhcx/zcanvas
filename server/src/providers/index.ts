import type { ModelSpec } from "../../../contracts/index.ts";
import { config } from "../config.ts";
import { mockAdapter } from "./mock.ts";
import { byteplusAdapter } from "./byteplus.ts";
import type { ProviderAdapter } from "./types.ts";
let override: ProviderAdapter | undefined;
/** Tests only: answer every model with this adapter (undefined restores the default). */
export const setAdapterForTests = (adapter?: ProviderAdapter) => {
  override = adapter;
};
/** MOCK_WORKERS=1 (default): every model answers with fixtures through the same queue. */
export function adapterFor(model: ModelSpec): ProviderAdapter {
  if (override) return override;
  if (config.mock) return mockAdapter;
  if (model.provider === "byteplus") return byteplusAdapter;
  throw new Error(`No adapter for provider ${model.provider}`);
}
