export type NodeId = string;
export type EdgeId = string;
export type GroupId = string;
export type PortKey = string;
export type Params = Record<string, unknown>;
export type XY = { x: number; y: number };
export type WH = { w: number; h: number };
export type AssetKind = "image" | "video" | "audio";
export type ValueKind = AssetKind | "text" | "json";
export type Kind = ValueKind | "any" | `list<${ValueKind}>`;
/**
 * An input port is a **role** (`first`, `last`, `reference`, `source`, `voice`…):
 * `RecipeEdge.targetPort` names the role the input fills.
 */
export interface Port {
  key: string;
  kind: Kind | Kind[];
  /** With `modes`: required only in those modes. */
  required?: boolean;
  multiple?: boolean;
  label?: string;
  /** How many inputs this role takes (e.g. one first frame). */
  max?: number;
  /** The role only exists in these modes of the node. */
  modes?: string[];
}
/** An explicit mode tab of a node (Text to video, First & last frame…). */
export interface NodeMode {
  value: string;
  label: string;
  /** Input kind the mode cannot run without. */
  needs?: ValueKind;
}
interface ParamCommon {
  label?: string;
  help?: string;
  required?: boolean;
  advanced?: boolean;
  showIf?: { key: string; equals: unknown };
}
export type Param = ParamCommon &
  (
    | {
        type: "enum";
        options: (string | { value: string; label: string })[];
        default?: string;
      }
    | {
        type: "number";
        min?: number;
        max?: number;
        step?: number;
        default?: number;
        unit?: string;
      }
    | {
        type: "string";
        multiline?: boolean;
        placeholder?: string;
        default?: string;
      }
    | { type: "boolean"; default?: boolean }
    | { type: "asset"; kind: AssetKind }
    | { type: "color"; default?: string }
    | { type: "json"; schema: Record<string, unknown> }
    /** A model from the catalog (`GET /models`) of this kind, or "auto". */
    | { type: "model"; kind: import("./models.ts").ModelKind; default?: string }
  );
export interface NodeType {
  type: string;
  version: number;
  title: string;
  description?: string;
  icon?: string;
  category: "input" | "video" | "audio" | "image" | "text" | "flow" | "output";
  inputs: Port[];
  outputs: Port[];
  params: Record<string, Param>;
  modes?: NodeMode[];
  runner:
    | { kind: "flow" }
    | {
        kind: "job";
        worker: string;
        timeoutSec?: number;
        concurrency?: number;
        cacheable?: boolean;
      };
  cost: {
    unit:
      | "credit_per_run"
      | "credit_per_image"
      | "credit_per_second"
      | "credit_per_1k_chars";
    estimate: number;
  };
  ui?: { body?: string; width?: number; previewPort?: string };
  migrate?: string;
  agentHints?: string;
}
export type Registry = Map<string, NodeType>;
export interface RecipeNode {
  id: NodeId;
  type: string;
  typeVersion: number;
  label?: string;
  position: XY;
  params: Params;
  groupId?: GroupId | null;
}
export interface RecipeEdge {
  id: EdgeId;
  source: NodeId;
  sourcePort: string;
  target: NodeId;
  targetPort: string;
}
export interface RecipeGroup {
  id: GroupId;
  name: string;
  position: XY;
  size: WH;
}
/** One param a template user must fill. */
export interface TemplateInput {
  nodeId: NodeId;
  paramKey: string;
  label?: string;
  help?: string;
}
/** `recipe.meta.template`: present when a recipe is a reusable template flow. */
export interface TemplateMeta {
  title: string;
  description?: string;
  /** Asset id (ast_…) of the cover image. */
  cover?: string;
  tags?: string[];
  /** Ordered; the first unfilled one is where the camera goes. */
  inputs: TemplateInput[];
}
export interface Recipe {
  schema: "recipe/v1";
  meta: {
    id: string;
    name: string;
    version: number;
    registryVersion: string;
    updatedAt?: string;
    template?: TemplateMeta;
  };
  nodes: RecipeNode[];
  edges: RecipeEdge[];
  groups: RecipeGroup[];
}
export type IssueCode =
  | "SCHEMA"
  | "DUP_ID"
  | "UNKNOWN_TYPE"
  | "VERSION"
  | "EDGE_NODE"
  | "EDGE_PORT"
  | "FAN_IN"
  | "CYCLE"
  | "KIND"
  | "NESTED_LIST"
  | "PARAM_UNKNOWN"
  | "PARAM_VALUE"
  | "PARAM_REQUIRED"
  | "INPUT_REQUIRED"
  | "GROUP"
  /** An input is connected to a role the current mode does not have. */
  | "MODE"
  /** The model cannot take these inputs (too many, wrong kind). */
  | "MODEL"
  /** An `@` token in a prompt points to nothing connected. */
  | "REFERENCE";
export interface Issue {
  code: IssueCode;
  severity: "error" | "warning";
  nodeId?: string;
  edgeId?: string;
  paramKey?: string;
  message: string;
}
export interface GraphChange {
  origin: unknown;
  nodeIds: string[];
  edgeIds: string[];
  groupIds: string[];
  meta: boolean;
}
export type Unsubscribe = () => void;
export interface GraphApi {
  addNode(
    type: string,
    init?: { params?: Params; position?: XY; label?: string },
  ): NodeId;
  removeNodes(ids: NodeId[]): void;
  connect(e: Omit<RecipeEdge, "id">): EdgeId;
  disconnect(ids: EdgeId[]): void;
  setParam(id: NodeId, key: string, value: unknown): void;
  setLabel(id: NodeId, label: string): void;
  setName(name: string): void;
  moveNodes(moves: { id: NodeId; position: XY }[]): void;
  group(ids: NodeId[], name: string): GroupId;
  updateGroup(
    id: GroupId,
    patch: { name?: string; position?: XY; size?: WH },
  ): void;
  ungroup(id: GroupId): void;
  autoLayout(ids?: NodeId[]): void;
  validate(): Issue[];
  toRecipe(): Recipe;
  fromRecipe(r: Recipe, mode: "replace" | "insert"): void;
  transaction<T>(origin: string, fn: () => T): T;
  undo(): void;
  redo(): void;
  subscribe(cb: (change: GraphChange) => void): Unsubscribe;
}
export interface Asset {
  id: string;
  kind: AssetKind;
  mime: string;
  bytes: number;
  url: string;
  thumbUrl?: string;
  meta: {
    durationSec?: number;
    width?: number;
    height?: number;
    [key: string]: unknown;
  };
  /** Source run/node of a generated asset. Kept for older clients; see `source`. */
  createdBy?: { runId: string; nodeId: string };
  createdAt: string;
  /**
   * Shown in the media library. Uploads are kept; generated results are kept
   * once used (added to a canvas, downloaded, used as a reference) or kept by hand.
   */
  kept?: boolean;
  // Catalog fields. Optional so assets saved before the catalog stay valid.
  name?: string;
  spaceId?: string;
  /** User who uploaded the file or started the run. Not the owner: the space owns it. */
  creatorId?: string;
  source?: import("./assets.ts").AssetSource;
  status?: import("./assets.ts").AssetStatus;
  previewStatus?: import("./assets.ts").PreviewStatus;
  description?: string;
  tags?: string[];
  generation?: import("./assets.ts").GenerationInfo;
  updatedAt?: string;
  deletedAt?: string;
}
export type Output = Asset | { value: string | object };
export type Outputs = Record<PortKey, Output | Output[]>;
export type JobStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "skipped"
  | "cancelled";
export type RunStatus = "running" | "done" | "failed" | "cancelled";
export interface Job {
  jobId: string;
  nodeId: string;
  itemIndex?: number;
  status: JobStatus;
  progress?: number;
  outputs?: Outputs;
  error?: { code: string; message: string };
  credits?: number;
  /** Model jobs: the catalog model that runs (Auto resolved). */
  model?: string;
  /** Waiting for a free provider slot: position in that model's line (1 = next). */
  queuePosition?: number;
  /** When the provider is expected to finish (ISO), from past run times. */
  eta?: string;
  /** What the user typed and what was sent after Auto prompt. */
  intent?: string;
  finalPrompt?: string;
  /** When the job ended (done, failed or cancelled). */
  finishedAt?: string;
  /** Where a model job is: waiting (for a slot), auto-prompt, preparing, submitting, provider-queued, provider. */
  stage?: string;
}
export interface Run {
  runId: string;
  canvasId: string;
  /** Run one node (and the upstream work it still needs). */
  target?: NodeId;
  graphVersion: number;
  status: RunStatus;
  credits: number;
  startedAt: string;
  finishedAt?: string;
  jobs: Job[];
}
export type RunEvent =
  | ({ type: "job.status"; runId: string; at: string; message?: string } & Job)
  | {
      type: "run.status";
      runId: string;
      status: RunStatus;
      credits: number;
      at: string;
    };
/**
 * Metadata a worker passes to `putAsset`. `provider` is what the model
 * provider reported; the server records the rest of the generation history.
 */
export type OutputMeta = Partial<Asset> & {
  provider?: import("./assets.ts").GenerationProvider;
};
export interface ModelsClient {
  generate(
    kind: AssetKind | "image-edit",
    request: { params: Params; inputs: Outputs; signal: AbortSignal },
  ): Promise<{ file: Blob; meta: OutputMeta; credits: number }>;
}
export interface RunContext {
  runId: string;
  jobId: string;
  nodeId: string;
  itemIndex?: number;
  inputs: Outputs;
  params: Params;
  signal: AbortSignal;
  report(progress: number, message?: string): void;
  putAsset(file: Blob | ReadableStream, meta: OutputMeta): Promise<Asset>;
  models: ModelsClient;
  log(level: "info" | "warn" | "error", msg: string): void;
}
export interface Worker {
  type: string;
  version: number;
  run(ctx: RunContext): Promise<Outputs>;
}
