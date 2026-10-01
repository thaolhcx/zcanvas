import { config } from "./config.ts";
/**
 * The small boundary between search and an embedding model. `id` names the
 * model and version; vectors from different ids are never compared.
 */
export interface EmbeddingProvider {
  id: string;
  dims: number;
  /** True when text leaves this server (see docs/asset-platform.md). */
  remote: boolean;
  embed(
    texts: string[],
    purpose: "query" | "document",
    signal?: AbortSignal,
  ): Promise<number[][]>;
}
export const normalizeText = (text: string) =>
  text.toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/\p{M}/gu, "");
function unit(vector: number[]) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((v) => v / length);
}
/**
 * Deterministic feature-hashing embeddings for automated tests. They match
 * shared words and word fragments only; they are NOT semantic and must not
 * be reported as search-quality evidence.
 */
export function hashProvider(dims = 256): EmbeddingProvider {
  const hash = (text: string) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };
  const one = (text: string) => {
    const vector = new Array(dims).fill(0);
    for (const word of normalizeText(text).match(/[\p{L}\p{N}]+/gu) ?? []) {
      const features = [`w:${word}`];
      const padded = `^${word}$`;
      for (let i = 0; i + 3 <= padded.length; i++)
        features.push(`g:${padded.slice(i, i + 3)}`);
      for (const feature of features) {
        const h = hash(feature);
        vector[h % dims] +=
          (h & 0x80000000 ? -1 : 1) * (feature.startsWith("w:") ? 2 : 1);
      }
    }
    return unit(vector);
  };
  return {
    id: `hash-v1-${dims}`,
    dims,
    remote: false,
    async embed(texts) {
      return texts.map(one);
    },
  };
}
/**
 * Runs a sentence-embedding model in this process with transformers.js.
 * No text leaves the server. The default model is multilingual (English and
 * Vietnamese). The model is downloaded once into the transformers.js cache.
 */
export function localProvider(
  model = config.search.model ?? "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  dims = config.search.dims ?? 384,
): EmbeddingProvider {
  let extractor: Promise<any> | undefined;
  const load = () =>
    (extractor ??= import("@huggingface/transformers" as string).then(
      (t: any) => t.pipeline("feature-extraction", model, { dtype: "q8" }),
    ));
  // E5 models expect these prefixes; other models ignore them harmlessly.
  const prefix = (purpose: "query" | "document") =>
    /e5/i.test(model) ? (purpose === "query" ? "query: " : "passage: ") : "";
  return {
    // Dimensions are part of the ID so vectors of different sizes never mix.
    id: `local:${model}:${dims}`,
    dims,
    remote: false,
    async embed(texts, purpose, signal) {
      const run = await load();
      signal?.throwIfAborted();
      const output = await run(
        texts.map((t) => prefix(purpose) + t),
        { pooling: "mean", normalize: true },
      );
      const vectors: number[][] = output.tolist();
      if (vectors[0]?.length !== dims)
        throw new Error(
          `Model returned ${vectors[0]?.length} dimensions, expected ${dims}`,
        );
      return vectors;
    },
  };
}
/** Any OpenAI-compatible /embeddings endpoint (OpenAI, Ollama, vLLM, …). */
export function openAiProvider(): EmbeddingProvider {
  const url = (config.search.url ?? "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const model = config.search.model ?? "text-embedding-3-small";
  const dims = config.search.dims ?? 1536;
  return {
    id: `openai:${model}:${dims}`,
    dims,
    remote: true,
    async embed(texts, _purpose, signal) {
      const response = await fetch(`${url}/embeddings`, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          ...(config.search.apiKey
            ? { Authorization: `Bearer ${config.search.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model,
          input: texts,
          ...(config.search.dims ? { dimensions: dims } : {}),
        }),
      });
      if (!response.ok)
        throw new Error(`Embedding provider returned ${response.status}`);
      const body = (await response.json()) as {
        data: { embedding: number[]; index: number }[];
      };
      const vectors = body.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
      if (vectors[0]?.length !== dims)
        throw new Error(
          `Model returned ${vectors[0]?.length} dimensions, expected ${dims}`,
        );
      return vectors;
    },
  };
}
export function configuredProvider(): EmbeddingProvider | undefined {
  if (!config.search.enabled) return undefined;
  switch (config.search.provider) {
    case "hash":
      return hashProvider(config.search.dims ?? 256);
    case "local":
      return localProvider();
    case "openai":
      return openAiProvider();
    default:
      return undefined;
  }
}
