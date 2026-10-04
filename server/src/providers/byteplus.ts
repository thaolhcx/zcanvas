import type { ProviderAdapter } from "./types.ts";
import { ProviderError } from "./types.ts";
// Placeholder until the BytePlus port lands (next commit).
export const byteplusAdapter: ProviderAdapter = {
  name: "byteplus",
  available: () => false,
  async submit() {
    throw new ProviderError("BytePlus is not configured");
  },
  async fetch() {
    return { state: "failed", message: "BytePlus is not configured" };
  },
};
