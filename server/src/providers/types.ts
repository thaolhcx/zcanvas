import type {
  AssetKind,
  ModelSpec,
  OutputMeta,
  Params,
} from "../../../contracts/index.ts";
/**
 * One model call, as the queue hands it to a provider adapter. Everything is
 * already resolved: the model (Auto picked), the final prompt (`@` tokens
 * rendered as "image 1"…), the model params with defaults and the ordered
 * media references with their roles.
 */
export interface GenRef {
  assetId: string;
  kind: AssetKind;
  /** The role (target port): first, last, reference, source, context… */
  role: string;
  name: string;
  mime: string;
}
export interface GenRequest {
  jobId: string;
  runId: string;
  nodeId: string;
  /** What the node does with the model. image-edit = image.edit (source image + instruction). */
  task: "llm" | "image" | "video" | "audio" | "image-edit";
  model: ModelSpec;
  mode?: string;
  prompt: string;
  params: Params;
  refs: GenRef[];
  /** text.generate: system prompt, effort and plain-text context. */
  system?: string;
  effort?: string;
  texts?: string[];
}
/** Reads a reference's bytes (from our storage). */
export type ReadRef = (ref: GenRef) => Promise<Uint8Array>;
export type GenOutput =
  | { type: "file"; file: Blob; meta: OutputMeta }
  | { type: "text"; text: string; meta?: OutputMeta };
export type SubmitResult =
  | { type: "done"; outputs: GenOutput[]; credits?: number }
  | { type: "task"; taskId: string; etaSec?: number };
export type FetchResult =
  | { state: "queued" | "running"; etaSec?: number }
  | { state: "done"; outputs: GenOutput[]; credits?: number }
  | { state: "failed"; message: string; code?: string };
export interface ProviderTask {
  taskId: string;
  request: GenRequest;
}
export interface ProviderAdapter {
  readonly name: string;
  /** Configured (keys present)? A model of an unavailable provider cannot run. */
  available(model: ModelSpec): boolean;
  submit(request: GenRequest, read: ReadRef, signal: AbortSignal): Promise<SubmitResult>;
  /** Reads the task's state once, and downloads the result when it is done. */
  fetch(task: ProviderTask, signal: AbortSignal): Promise<FetchResult>;
  /** Cancels a task the provider still queues; "running" when it is too late. */
  cancel?(task: ProviderTask): Promise<"cancelled" | "running">;
}
/**
 * transient: 429, 5xx, network — retried with backoff.
 * Anything else (content, parameters, auth) stops at once with this message.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly transient = false,
    readonly code = transient ? "PROVIDER_BUSY" : "PROVIDER_ERROR",
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
export const isTransientStatus = (status: number) =>
  status === 429 || status >= 500;
