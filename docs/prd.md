# PRD — POC Node Canvas Platform

Sep 29, 2026 · @Thao Le&#32;

This POC builds the base of a node canvas platform: the canvas, its data model, and the engine that runs a graph. It must be smooth at 128 nodes, easy to use without training, and easy to extend with new node types. If the 6 success criteria below pass, the real product is built on the same schema. An agent that edits the graph comes later, on top of the same API.

## Background and goals

**Why the canvas first.** Node canvases are now the standard UI for AI creative tools (Figma Weave, Flora, Freepik Spaces, Krea Nodes, Lumina). The canvas itself is not the hard part; the hard parts are the data model under it, the engine that runs it, and keeping it smooth as graphs grow. If those are right, every later feature (presets, agent, sharing) is a thin layer on top. If they are wrong, every later feature fights them.

**Reference.** ByteDance Lumina uses React Flow v12 + Yjs. In our test on 29 Sep 2026 their canvas stayed smooth at 128 nodes with full-size images and no special tricks. It was not usable at 256 nodes. We take 128 as our budget.

**Goals of the POC**

1. One data model: graph = recipe JSON, in both directions, with a schema.
2. One node registry that describes every node type; adding a type needs no canvas code.
3. A canvas a new user can use in 10 minutes without a guide.
4. A graph runs as real jobs, with live status and retry per node.
5. Local-first: edit offline, sync later, no lost changes.
6. Smooth at 128 nodes with images.

## Scope

The POC covers the platform base only. Features that sit on top of it come after.

| In the POC | Out of the POC |
| --- | --- |
| Canvas core: add, connect, move, delete, group, undo/redo, auto-layout, copy/paste | Polished visual design, themes, onboarding tour |
| Usability: node palette with search, drag-to-connect, inline validation, keyboard shortcuts | Comments, cursors of other users |
| Node registry with 8 node types that cover all hard cases | The full node library |
| Extensibility: add a new node type from a registry entry only; optional custom node body | Third-party plugins, marketplace |
| 1 pilot flow end to end: media generation (prompt → image → edit/upscale → image-to-video → voice/music → export) | Other flows (localization, editing) come after, as new node types only |
| Run the graph, live status per node, retry one node | Scheduling, priority queues, cost limits |
| Local-first storage + sync to server | Real-time multi-user editing (Yjs is ready for it, but not tested) |
| Save / load recipe JSON, save as preset | Preset library UI, version history |
| Graph API that the UI uses (same API a future agent will use) | The agent itself |
| Credit usage logged per run | Usage reports |
| 1 user, desktop Chrome | Login, roles, permissions, mobile |

## Success criteria

The POC passes only if all 6 criteria pass. Targets were approved on 29 Sep 2026.

| # | Question | How we test | Pass if |
| --- | --- | --- | --- |
| 1 | Does graph = recipe JSON work both ways? | Build the pilot graph on canvas, export JSON, reload it on an empty canvas. Repeat with a hand-written JSON. | Same nodes, edges, params and layout after reload. JSON passes schema check. |
| 2 | Is the platform easy to extend? | A developer who did not build the POC adds a new node type (for example `audio.sfx`) with a registry entry and a worker. | Under 1 hour, no change to canvas code. The node shows in the palette, validates and runs. |
| 3 | Is the canvas easy to use? | Thao builds the pilot flow from a one-line brief, no guide. Team test with 3 new users comes after the POC. | Under 10 minutes. No more than 2 points of confusion, each written down as a fix. |
| 4 | Does a graph run as real jobs? | Run the pilot graph from 1 real prompt to a finished 10–15 s clip. Kill one node mid-run, then retry only that node. | Status shows live on each node. Retry reruns only the failed node and its downstream nodes. Output file is correct. |
| 5 | Does local-first sync work? | Edit offline for 5 minutes, reconnect. Edit the same graph in two tabs at once. | No lost changes. Graph on server = graph on client after sync. |
| 6 | Is the canvas fast enough? | 128 nodes with images: drag, pan, zoom on a 16 GB RAM laptop, production build. | 50+ FPS on drag and pan, no frame longer than 100 ms. |

## Users and main flow

**Users in the POC:** one operator who builds media pipelines. Later: anyone in the team who runs presets, and an agent that builds graphs through the same API.

**Main flow**

1. The user opens a blank canvas or a preset.
2. They open the palette (double-click or `/`), search a node by name, and drop it on the canvas.
3. They drag from an output port to an input port. Ports that do not match are grayed out while dragging. Dropping an edge on empty space opens the palette with only the nodes that fit.
4. They set params in the node body. A missing required param shows a yellow mark on the node.
5. They press **Run**. The button shows the estimated credits first. The app checks the graph; if a node is invalid, Run is blocked and the node is marked red with the reason.
6. Each node shows its status: queued, running (with progress), done (with a preview), or failed (with the error).
7. If a node fails, the user fixes the param and presses **Retry** on that node. Only that node and the nodes after it run again.
8. The user saves the graph as a preset. Next time, they pick the preset, change the prompt or the input asset, and press Run.

**Ease of use rules:** every action has a keyboard shortcut; every error is shown on the node, not in a console; the palette is the only way to add nodes, so there is one thing to learn.

## UX spec

This is what criterion 3 measures. The layout follows Lumina, which we know works; two additions are marked.

| Area | Spec |
| --- | --- |
| Layout | Full-screen canvas, dark, dot grid. Top left: canvas name (click to rename), back. Top right: **Run** with estimated credits (`Run · ~6 cr`). Left rail: `+` palette, fit view, auto-layout, undo, redo. Bottom left: zoom slider, mini-map toggle. Right panel opens only when one node is selected and holds the full param form. No fixed sidebar. |
| Node | Header: category icon, title (click to set label), status badge at the right. Body: preview of `ui.previewPort` (image thumbnail, video poster, audio waveform, first 2 lines of text); before a run, a dim frame with the kind name. Below: the 2–3 most used params inline; the rest in the right panel; `advanced` params behind "More". Ports: dots on both sides, one color per kind; hover shows port name and kind. Fanned-out node shows `3/4` next to the badge. |
| Add a node | One palette, three ways in: `+`, double-click on empty canvas, `/`. Search box + list grouped by category; typing filters; Enter drops the node at the click point or screen center. Dragging an edge onto empty canvas opens the palette filtered to nodes whose input fits, and connects on pick. |
| Connect | Drag from an output port. While dragging, non-matching input ports dim, matching ones light up. Drop on a matching port connects; drop on an occupied non-`multiple` port replaces the edge. A `list<x> → x` edge carries a small `×n` label (addition). Click edge + Delete, or hover edge for a delete button. |
| Validation on node | `validate()` runs after every Graph API transaction, but issues are shown at two levels. **Incomplete** (`INPUT_REQUIRED`, `PARAM_REQUIRED`): a small yellow dot on the node, no text; the Run button is dimmed with a tooltip like "3 nodes need input". **Wrong** (`KIND`, `FAN_IN`, `NESTED_LIST`, `PARAM_VALUE`, and all others): red at once, with a short message on the node, edge or field it names. On Run, both levels block; the canvas pans to the first issue and shows its full message. Three rules: one message per issue code, written in one place; a message sits where the issue points (`nodeId` → node, `edgeId` → edge, `paramKey` → field), never a toast; issues are derived from the current graph, never stored, so a fixed issue disappears at once. |
| Run status on node | `queued` gray · `running` thin progress bar at the node's bottom + `%` · `done` green + new preview · `failed` red + short error code · `skipped` hatched · `cancelled` gray. Small "changed" badge if the node was edited after the run started. Hover a failed node for **Retry**. |
| Run | Blocked while any node is red: canvas pans to the first red node and the right panel opens on the bad field. Otherwise all nodes go `queued`; header shows `Running · 0/7` with **Cancel**. On finish: `Done · 6.8 cr`; the export node gets an open-asset button. |
| Select, group, layout | Click selects one; Shift+click or drag-box selects many. Multi-select shows a floating bar: Group, Duplicate, Delete, Auto-layout. A group is a named frame; dragging the frame moves its nodes; double-click the name to rename. Auto-layout places nodes left to right along data flow. |
| Shortcuts | `/` palette · `Delete` · `Cmd+Z` / `Shift+Cmd+Z` · `Cmd+C` / `V` / `D` · `Cmd+G` group · `Cmd+Enter` run · `F` fit view · `Space`+drag pan · scroll pans, `Cmd`+scroll zooms. |
| Presets | Canvas name menu → "Save as preset". Canvas list has a Presets tab; opening one creates a new canvas from the recipe. |
| Zoomed out | Below zoom 0.4 a node shows only frame, title and status badge. |

Additions over Lumina: the credit estimate on Run and the `×n` fan-out label. Both are cheap and tell the user what the graph will do before it spends credits.

## Solution architecture

The browser owns the graph and the server owns runs. This split keeps the canvas fast and offline-safe, and keeps job status correct when several clients watch one run. The node registry is the one shared contract: the canvas, the Graph API and the runner all read it.

&#91;embedded content: POC architecture · browser and server\]

Graph edits go through the Graph API into the Yjs doc and sync in the background. Run sends a snapshot to the server, which creates the jobs and pushes status back to the canvas.

**Stack (proposed)**

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React + Vite + TypeScript | Simple build for an internal tool |
| Canvas | React Flow v12 (`@xyflow/react`) | Same as Lumina; proven smooth at 128 nodes |
| State | Zustand (UI state), Yjs (graph) | Narrow selectors; CRDT for sync and undo |
| Local storage | `y-indexeddb` | Offline edits, fast reload |
| Sync server | Hocuspocus (Node) | Yjs server with Postgres storage and auth hooks |
| Runner | Node + Postgres + pg-boss | Postgres only, no Redis. Postgres in Docker for the POC; Neon later (pg-boss polls, so it works there with the direct connection string). BullMQ is the fallback |
| Workers | Thin workers: model API calls (image, video, audio) + ffmpeg for export | Real jobs, little code; each worker is under 100 lines |
| Models | One models module in the runner | One place for API keys, model names and usage logging; no separate gateway service in the POC |

## Data model

Three things: the **node registry** (what node types exist), the **graph doc** (one canvas, stored in Yjs), and the **recipe JSON** (a plain export of the graph). The canvas, the Graph API and the runner all read the same registry, so a new node type is added in one place.

### Node registry

One entry per node type. The canvas draws the node from it, the runner validates inputs with it, and any client (later an agent) learns the node from it.

```json
{
  "type": "image.generate",
  "version": 1,
  "title": "Generate image",
  "category": "image",
  "description": "Makes an image from a prompt, with an optional reference image.",
  "inputs":  [
    { "key": "prompt", "kind": "text", "required": true },
    { "key": "reference", "kind": "image", "required": false }
  ],
  "outputs": [{ "key": "image", "kind": "list<image>" }],
  "params": {
    "model": { "type": "enum", "options": ["seedream-4", "flux-2"], "default": "seedream-4" },
    "aspect": { "type": "enum", "options": ["1:1", "9:16", "16:9"], "default": "9:16" },
    "count": { "type": "number", "min": 1, "max": 4, "default": 1 },
    "seed": { "type": "number", "advanced": true }
  },
  "runner": { "kind": "job", "worker": "image-gen", "timeoutSec": 300, "cacheable": true },
  "cost": { "unit": "credit_per_image", "estimate": 1 },
  "agentHints": "First step of most visual flows. Use a reference image to keep a character consistent."
}
```

**Data kinds** on ports: `image`, `video`, `audio` are **asset kinds** (a file in storage, passed by id). `text` and `json` are **value kinds** (inline in the job result, max 64 KB). `any` matches every kind. `list<kind>` is a list of one kind. The canvas only allows edges between matching kinds, with one rule that keeps flows simple: an edge `list<x> → x` is allowed and means fan-out (see Execution).

**The 8 POC node types** (chosen to cover every hard case once):

| Node type | Covers |
| --- | --- |
| `input.prompt` | Text value, the start of most flows |
| `input.asset` | Upload or pick an existing image / video / audio |
| `image.generate` | Model call; output is always `list<image>` (`count` items), which fans out to the next node |
| `image.edit` | Model call with two inputs (image + instruction); covers upscale, inpaint, restyle |
| `video.generate` | Long job (image-to-video), progress, high cost |
| `audio.generate` | Model call with a user choice (voice or music style) |
| `flow.if` | Branch on a condition; the untaken branch is skipped |
| `output.export` | Mux video + audio with ffmpeg, save as a named asset |

The full node library comes after the POC. If these 8 types fit the registry with no special-case code, the rest will fit too. \`flow.subgraph\` (a saved recipe used as a node) is designed for but not built in the POC.

### Graph doc (Yjs)

```
Y.Doc
├─ meta:   Y.Map   { id, name, version, registryVersion }
├─ nodes:  Y.Map<nodeId, Y.Map { type, typeVersion, label?, position, params: Y.Map, groupId? }>
├─ edges:  Y.Map<edgeId, { source, sourcePort, target, targetPort }>
└─ groups: Y.Map<groupId, { name, position, size }>
```

- Run status, progress and outputs are **not** in the doc. They come from the server (see Execution).
- Maps keyed by id, not arrays. Two edits on different nodes never conflict.

### Recipe JSON

A plain snapshot of the doc: `{ meta, nodes[], edges[], groups[] }`. It is used to save presets, to share in the library, and as the input of a run. Import = build a new Yjs doc from the JSON. Full schema and invariants are in Contracts below.

## Contracts

Five contracts hold the platform together. Each one is a versioned file in the repo (`contracts/*.schema.json` or `*.ts`). Every part is built and tested against them, so parts can change on their own. **Verified:** the two JSON Schemas, the 8 node types, the pilot recipe and `validate()` are written and pass 20 tests; the full source is in Contracts source (verified).

| Contract | Between | Format |
| --- | --- | --- |
| Recipe JSON | canvas ↔ storage, import/export, runner | JSON Schema `recipe/v1` |
| Node registry | one source → canvas, Graph API, runner, workers | JSON Schema `registry/v1` |
| Graph API | UI, scripts, later an agent → graph doc | TypeScript interface |
| Run API | client ↔ server | HTTP + WebSocket, JSON |
| Worker | runner → worker | TypeScript interface |

### Recipe JSON (`recipe/v1`)

```json
{
  "schema": "recipe/v1",
  "meta": {
    "id": "rcp_8f3a",
    "name": "Character short",
    "version": 3,
    "registryVersion": "2026.09.1",
    "updatedAt": "2026-09-29T10:12:00Z"
  },
  "nodes": [
    {
      "id": "n_prompt",
      "type": "input.prompt",
      "typeVersion": 1,
      "label": "Scene prompt",
      "position": { "x": 0, "y": 0 },
      "params": { "text": "A girl in a red coat on a rainy street, cinematic" },
      "groupId": null
    },
    {
      "id": "n_img",
      "type": "image.generate",
      "typeVersion": 1,
      "position": { "x": 360, "y": 0 },
      "params": { "model": "seedream-4", "aspect": "9:16", "count": 1 }
    },
    {
      "id": "n_vid",
      "type": "video.generate",
      "typeVersion": 1,
      "position": { "x": 720, "y": 0 },
      "params": { "model": "seedance-1.5", "durationSec": 5 }
    }
  ],
  "edges": [
    { "id": "e_1", "source": "n_prompt", "sourcePort": "text", "target": "n_img", "targetPort": "prompt" },
    { "id": "e_2", "source": "n_img", "sourcePort": "image", "target": "n_vid", "targetPort": "image" }
  ],
  "groups": [
    { "id": "g_1", "name": "Shot 1", "position": { "x": -20, "y": -40 }, "size": { "w": 1100, "h": 300 } }
  ]
}
```

**Invariants** (checked by `validate()` on the client and again by the server before a run):

1. All `id` values are unique inside the recipe.
2. Every `type` exists in the registry; `typeVersion` is known or has a `migrate` path.
3. Every edge names an existing node and an existing port on that node's type.
4. Port kinds match: `x → x`, `list<x> → list<x>`, `list<x> → x` (fan-out), or either side `any`. Nothing else.
5. An input port has at most one incoming edge, unless the port is marked `multiple`.
6. The graph has no cycles.
7. Every param passes its registry rule (type, enum options, min/max). Required params with no default must be set.
8. `groupId` points to an existing group. Groups are layout only; they never change how the graph runs.
9. `meta.version` goes up by one on every Graph API transaction. It is the `graphVersion` a run is tied to.

`position`, `label` and `groups` are layout. Two recipes with the same nodes, edges and params run the same, whatever the layout.

**Fan-out rules** (implemented and tested in `validate.mjs`):

1. An edge `list<x> → x` is allowed. The target node is fanned out: one job per item.
2. Every output `y` of a fanned-out node is effectively `list<y>`, so fan-out carries on down the graph.
3. A fanned-out node whose declared output is already a list is refused (`NESTED_LIST`). One level only.
4. A node with one list input and one scalar input broadcasts the scalar to every item.
5. `any` ports take the effective kind of the upstream edge, so `flow.if` passes the real kind through and a kind error after it is still caught.

**Issue codes** returned by `validate()`: `SCHEMA`, `DUP_ID`, `UNKNOWN_TYPE`, `VERSION`, `EDGE_NODE`, `EDGE_PORT`, `FAN_IN`, `CYCLE`, `KIND`, `NESTED_LIST`, `PARAM_UNKNOWN`, `PARAM_VALUE`, `PARAM_REQUIRED`, `INPUT_REQUIRED`, `GROUP`. The canvas maps each code to a message on the node or edge it names.

### Node registry (`registry/v1`)

The registry is one JSON file per node type, loaded at build time and served to the client as one bundle with a `registryVersion`. A node type is:

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | string | Unique id, `<category>.<name>`, for example `image.generate` |
| `version` | integer | Bumped on any change to ports or params |
| `title`, `description`, `icon` | string | Shown in the palette and node header |
| `category` | enum | `input`, `video`, `audio`, `image`, `text`, `flow`, `output` |
| `inputs[]`, `outputs[]` | Port\[\] | See Port |
| `params` | map\<key, Param> | See Param |
| `runner` | Runner | How the server runs it |
| `cost` | { unit, estimate } | For the credit log and the estimate shown before Run |
| `ui` | { body?, width?, previewPort? } | Optional custom body component; which output to preview on the node |
| `migrate` | string (module path), optional | `(params, fromVersion) → params` for old recipes |
| `agentHints` | string, optional | One line on when to use the node; unused by the POC, kept for later |

**Port**

```json
{ "key": "media", "kind": "video", "required": true, "multiple": false, "label": "Media" }
```

`kind` is one of `image`, `video`, `audio` (asset kinds), `text`, `json` (value kinds), `any`, or `list<kind>`. A port with `"kind": ["image", "video"]` accepts either. `multiple: true` allows fan-in; the worker then gets an array. `any` is for flow nodes only; the real kind is checked at run time.

**Param**

| `type` | Extra fields | Input drawn on the node |
| --- | --- | --- |
| `enum` | `options[]` (value + label), `default` | Select |
| `number` | `min`, `max`, `step`, `default`, `unit` | Slider when min and max are set, else a field |
| `string` | `multiline`, `placeholder`, `default` | Text field or textarea |
| `boolean` | `default` | Switch |
| `asset` | `kind` | Asset picker |
| `color` | `default` | Color picker |
| `json` | `schema` (JSON Schema) | Code field with validation |

Every param may also carry `label`, `help`, `required`, `advanced` (hidden behind "more"), and `showIf: { key, equals }` for simple conditional forms.

**Runner**

```json
{ "kind": "job", "worker": "image-gen", "timeoutSec": 300, "concurrency": 4, "cacheable": true }
```

`kind` is `job` (queued, runs in a worker) or `flow` (handled by the runner itself with no worker: `input.prompt` and `input.asset` emit their param as output; `flow.if` branches; `flow.subgraph` later). `cacheable: false` for nodes whose output should be fresh on every run.

**`flow.if`**: input `value: any`; params `field` (a path into the value, or into an asset's `meta`, for example `meta.width`), `op` (`eq`, `neq`, `gt`, `lt`, `contains`), `compare` (the value to compare with); outputs `then: any` and `else: any`. The input passes through the taken port unchanged; the other port's downstream is `skipped`.

### Graph API (client)

The only way to change a graph. The UI calls it, import/export calls it, tests call it, and later an agent gets the same calls as tools. It writes to the Yjs doc inside a transaction with an `origin`, so undo and history know who made each change.

```ts
interface GraphApi {
  addNode(type: string, init?: { params?: Params; position?: XY; label?: string }): NodeId;
  removeNodes(ids: NodeId[]): void;                 // also removes their edges
  connect(e: { source: NodeId; sourcePort: string; target: NodeId; targetPort: string }): EdgeId; // throws GraphError on kind mismatch
  disconnect(ids: EdgeId[]): void;
  setParam(id: NodeId, key: string, value: unknown): void; // throws GraphError on invalid value
  setLabel(id: NodeId, label: string): void;
  moveNodes(moves: { id: NodeId; position: XY }[]): void; // called on drag stop only, never per frame
  group(ids: NodeId[], name: string): GroupId;
  updateGroup(id: GroupId, patch: { name?: string; position?: XY; size?: WH }): void;
  ungroup(id: GroupId): void;                        // nodes stay, groupId -> null
  autoLayout(ids?: NodeId[]): void;

  validate(): Issue[]; // { code, severity: 'error' | 'warning', nodeId?, edgeId?, paramKey?, message }
  toRecipe(): Recipe;
  fromRecipe(r: Recipe, mode: 'replace' | 'insert'): void; // 'insert' pastes with new ids, offset

  transaction<T>(origin: string, fn: () => T): T; // one undo step; origin: 'user' | 'import' | 'script'
  undo(): void; redo(): void;
  subscribe(cb: (change: GraphChange) => void): Unsubscribe;
}
```

Rules: no direct writes to the Yjs doc from UI code; every call is synchronous and validates against the registry before it writes; a call that fails changes nothing.

### Server API

| Method | Path | Body → Response |
| --- | --- | --- |
| `GET` / `POST` | `/canvases` | List canvases; create one `{ name }` → `{ canvasId }`. The Yjs doc name is the `canvasId`. |
| `POST` | `/assets` | multipart file → `Asset` (for `input.asset`) |
| `GET` / `POST` | `/presets` | List presets; save one `{ name, recipe }` |
| `POST` | `/runs` | `{ recipe, canvasId, graphVersion }` → `Run`; `422` with `Issue[]` if invalid |
| `GET` | `/runs/{runId}` | → `Run` (status, jobs, started/finished, credits) |
| `GET` | `/runs?canvasId=` | → last runs of a canvas |
| `POST` | `/runs/{runId}/retry` | `{ nodeId }` → `Run`; reruns that node and all downstream |
| `POST` | `/runs/{runId}/cancel` | → `Run` |
| `WS` | `/runs/{runId}/events` | Server → client events below |

`Run = { runId, canvasId, graphVersion, status, credits, startedAt, finishedAt?, jobs: Job[] }` and `Job = { jobId, nodeId, itemIndex?, status, progress?, outputs?, error?, credits? }`. `itemIndex` is set when a node fans out (one job per list item).

**Events** (one JSON object per message, `at` is server time):

```json
{ "type": "job.status", "runId": "run_1", "jobId": "job_3", "nodeId": "n_img", "itemIndex": 0, "status": "running", "progress": 0.42, "message": "step 12/28", "at": "..." }
{ "type": "job.status", "runId": "run_1", "jobId": "job_3", "nodeId": "n_img", "itemIndex": 0, "status": "done", "outputs": { "image": { "assetId": "ast_9", "thumbUrl": "..." } }, "credits": 1, "at": "..." }
{ "type": "job.status", "runId": "run_1", "jobId": "job_5", "nodeId": "n_vid", "status": "failed", "error": { "code": "MODEL_TIMEOUT", "message": "..." }, "at": "..." }
{ "type": "run.status", "runId": "run_1", "status": "done", "credits": 6.8, "at": "..." }
```

Job status is one of `queued`, `running`, `done`, `failed`, `skipped`, `cancelled`. Run status is `running`, `done`, `failed` (any job failed and nothing left to run), `cancelled`. The client keeps this in its own run store, keyed by `runId`, `nodeId` and `itemIndex`, never in the graph doc. A node with several jobs shows the count done (`3/4`). On reconnect the client calls `GET /runs/{runId}` once and then resumes the stream. A node edited after the run started shows a small "changed since run" mark; its status is still shown.

**Cache key** for a job: `sha256(type + typeVersion + canonical(params) + sorted input assetIds)`. Same key and `cacheable: true` → the job is `done` at once with the old outputs and `credits: 0`.

### Worker

```ts
interface Worker {
  type: string;        // registry type this worker serves
  version: number;     // must equal the registry version
  run(ctx: RunContext): Promise<Record<PortKey, Output | Output[]>>;
}

type Output = Asset | { value: string | object };   // asset kinds -> Asset; value kinds -> { value }

interface RunContext {
  runId: string; jobId: string; nodeId: string; itemIndex?: number;
  inputs: Record<PortKey, Output | Output[]>;   // one item of a list when fanned out
  params: Params;                                // already validated against the registry
  signal: AbortSignal;                           // cancel
  report(progress: number, message?: string): void; // 0..1
  putAsset(file: Blob | ReadableStream, meta: Partial<Asset>): Promise<Asset>;
  models: ModelsClient;                          // the one place that calls model APIs and logs usage
  log(level: 'info' | 'warn' | 'error', msg: string): void;
}
```

A worker is a pure function of `inputs + params`. It never reads the graph, never writes status, calls models only through `ctx.models`, and stores files only through `putAsset`. A thrown error becomes `failed` with `{ code, message }`; a `signal` abort becomes `cancelled`. Workers must be safe to run twice with the same inputs (a retry after a crash may do that).

### Asset

```json
{ "id": "ast_9", "kind": "video", "mime": "video/mp4", "bytes": 48213344, "url": "https://.../ast_9.mp4", "thumbUrl": "https://.../ast_9_300.jpg", "meta": { "durationSec": 132.4, "width": 1920, "height": 1080 }, "createdBy": { "runId": "run_1", "nodeId": "n_mux" }, "createdAt": "..." }
```

The canvas only ever holds `assetId` and reads `thumbUrl` for previews. The asset service makes the 300 px thumbnail (and a poster frame for video) on `putAsset`, so the canvas never loads a full-size file.

## Extensibility

A new node type is one registry entry plus one worker function. Nothing in the canvas changes.

**Adding a node type**

1. Write the registry entry (type, ports, params, runner, cost). The palette, the ports, the param form and the validation come from it.
2. Write the worker: `run(ctx) → outputs`, one function that takes inputs and params and returns assets or values (Worker contract).
3. Register both. Reload. The node is in the palette, validates on the canvas and runs.

**Param form from the registry.** Each param type maps to one input (table in Contracts). A node type never needs a custom form. If a type needs a special body (for example a waveform preview), it can register one optional React component in `ui.body`; everything else stays generic.

**Versioning.** A registry entry has a `version`. A saved recipe stores the version of each node. When a type changes, an optional `migrate(params, fromVersion)` keeps old recipes working.

**Sub-graphs (after the POC).** A saved recipe can be used as a node (`flow.subgraph`) with the inputs and outputs of its first and last nodes. This is how big flows stay under the 128-node budget. The registry reserves `runner.kind: flow` for it; nothing else in the POC depends on it.

**Graph API.** Every canvas action is one call on the Graph API (full interface in Contracts). The UI uses it, import/export uses it, and tests use it. An agent later gets the same calls as tools, with no new surface to build. The POC proves the API is complete by building the pilot graph from a script, with no UI.

## Execution

When the user presses Run, the client sends a **snapshot** of the graph to the server. The server owns the run from there. The canvas can keep changing; it does not affect a run that has started.

**Run steps**

1. Client calls `POST /runs` with the recipe JSON and `graphVersion`. Several runs of one canvas may be live at once; each is independent.
2. Server validates the graph against the registry (same invariants as the client) and sorts it (topological order).
3. Server creates jobs. One job per node, or one job per list item when a `list<x> → x` edge fans out; the results are collected back into a `list<y>` for the next node. A job starts when all jobs it depends on are `done`.
4. `flow.if` is run by the runner itself: it reads the condition and marks the whole untaken branch `skipped`.
5. Each job calls its worker. Workers call model APIs through the `models` module and write files through `putAsset`.
6. Server pushes status to the client over WebSocket: `queued → running (progress) → done | failed | skipped | cancelled`.
7. Outputs are saved as assets (or inline values for `text` / `json`). The node shows a thumbnail from `thumbUrl`, never the full file.

**Retry one node:** `POST /runs/{id}/retry {nodeId}` reruns that node and every node after it. Nodes before it reuse their saved outputs. The same rule works for "change one param and rerun from here".

**Cache (in the POC):** a job output is keyed as in Contracts (type, typeVersion, params, input asset ids). Same key and `cacheable: true` = reuse the output, no new credit spent.

**Change one param and run again:** a new run of the whole graph. Nodes upstream of the change hit the cache and finish at once with `credits: 0`; only the changed node and its downstream spend credits. Retry is for a failed node; a fresh Run is for an edited graph. Both are cheap for the same reason.

**Credits:** each job logs its credit use with `runId`, `jobId` and `nodeId`. `userId` and `projectId` fields exist but are empty in the POC. Only logging, no limits.

**Tech:** Postgres tables `runs` and `jobs` + a simple job queue (pg-boss). No workflow engine in the POC. If retry and batch logic gets hard, we test Temporal after the POC.

## Sync and offline

The graph is local-first: every edit is applied and saved in the browser first, then synced to the server in the background. The user never waits for the network to drag, connect or change a param.

| Data | Source of truth | How it moves |
| --- | --- | --- |
| Graph (nodes, edges, params, positions) | Client, synced to server | Yjs doc, saved in the browser with `y-indexeddb`, synced over WebSocket (Hocuspocus) |
| Run status, progress, errors | Server | Pushed to the client over WebSocket; never written into the Yjs doc |
| Assets (images, video, audio) | Server / object storage (MinIO in the POC, R2 or S3 later) | Node keeps only the asset id and URL; the browser caches thumbnails |

**Rules**

- **No doc write on every frame.** While a node is dragged, its position lives only in the canvas store. It is written to Yjs on drag stop.
- **Offline:** edits keep going into IndexedDB. On reconnect, Yjs merges them with the server copy. No manual conflict step.
- **Two tabs at the same time:** both write to the same doc; Yjs merges. If both change the same param, the last write wins, and the change shows in history.
- **Undo/redo:** `Y.UndoManager`, one stack per tab, tracking origins `user` and `import`. One Graph API transaction = one undo step.
- **Server side:** Hocuspocus saves the doc to Postgres, table `canvases (id, name, ydoc bytea, snapshot jsonb, version, updated_at)`. The JSON snapshot is for listing and recovery; a run always uses the snapshot the client sent.

Multi-user editing will work with the same setup, but we do not test it in the POC.

## Performance

Budget: **128 nodes per canvas** without extra tricks. Bigger pipelines use groups or sub-graphs. Lumina shows React Flow can do this, so lag comes from our code, not the library.

**Rules for the canvas code**

1. One `BaseNode` component for all types, wrapped in `React.memo`. It picks its body by `data.type`. `nodeTypes` and `edgeTypes` are declared outside components.
2. No component reads the whole `nodes` array. Use narrow Zustand selectors with `shallow`.
3. Y.Doc → store sync is per key: `observeDeep` tells which node changed; only that node's object is rebuilt, all others keep their reference so `memo` skips them. Never rebuild the whole array on every update.
4. Validation issues are stored as `Map<nodeId, Issue[]>` and `Map<edgeId, Issue[]>`, diffed against the previous result so an unchanged entry keeps its reference. Only the small issue badge subscribes, by id. Nodes with no issue subscribe to nothing.
5. Text fields commit to the Graph API on blur or after a 150 ms pause, not on every keystroke. Dragging creates no transaction, so it never triggers validation.
6. Callbacks live in the store, not in `node.data`.
7. Run status lives in its own store keyed by node id. Only the small status badge subscribes to it.
8. Images in nodes are thumbnails (about 300 px). Video nodes show a poster; play only on hover.
9. No `box-shadow`, `filter` or `backdrop-filter` on nodes. Keep a node under about 40 DOM elements.
10. Zoomed far out (`zoom < 0.4`): nodes show only a frame and title.
11. Above 128 nodes: turn on `onlyRenderVisibleElements`.

**How we measure:** a built-in FPS meter and a button that adds 128 / 256 / 512 test nodes. We always test the production build, not dev mode.

## Build order and definition of done

Build the platform first and the UI last. Every step before the UI is driven by a script or a test, not by clicking. Each step has a test that must pass before the next step starts, so a wrong contract is found before code depends on it.

**Before step 1** (decisions the agent cannot make):

- [ ] Which model and API key for each real worker: image generate, image edit, video, audio. Needed only at step 5; everything else runs with mock workers.
- [ ] Nothing else. The POC runs fully on one laptop (see Local dev below). No cloud account, no deploy.

| # | Step | Done when | Test level |
| --- | --- | --- | --- |
| 1 | Contracts: `recipe/v1`, `registry/v1` JSON Schemas; `GraphApi`, `Worker`, `Run`, `Asset` types | Done 29 Sep 2026: schemas + 8 types + pilot recipe + `validate()` pass 20 tests (Contracts source tab). Remaining: the TypeScript types | Unit |
| 2 | Graph API on a Yjs doc + `toRecipe` / `fromRecipe` + `UndoManager` | A script builds the pilot graph through the API, exports, re-imports, gets an equal recipe; undo of one transaction restores the previous recipe (criterion 1) | Integration (script, no UI) |
| 3 | Sync: `y-indexeddb` + Hocuspocus + `canvases` table | Two headless clients edit one doc through the local Hocuspocus; go offline, edit, reconnect; both end equal to the server (criterion 5) | Integration |
| 4 | Runner: `runs`, `jobs`, pg-boss, fan-out, `flow.if`, retry, cancel, cache, events | Mock workers run the pilot recipe end to end through `POST /runs` + WS; kill one job and retry only it; second run hits the cache (criterion 4, mock) | Integration |
| 5 | Real workers: image, edit, video, audio, export; `models` module with usage log | Pilot recipe from prompt to 10–15 s clip through the API alone (criterion 4, real) | Integration |
| 6 | Canvas UI: React Flow, `BaseNode`, palette, ports, param form, issues, run status, per-key store sync | Playwright builds the pilot by clicking, runs it, sees status and preview; Thao builds it by hand in under 10 minutes (criterion 3) | E2E |
| 7 | Performance pass on the 128-node test canvas | Criterion 6 on the 16 GB laptop, production build, FPS meter | E2E |
| 8 | Extensibility check: add `audio.sfx` by a second developer | Criterion 2 | E2E |

**Testing strategy**

- **E2E is the main proof.** Playwright against the production build: build the pilot, run it, fail one node, retry, save a preset, reload it, edit offline. Each of the 6 criteria has one E2E scenario. Runs on every merge.
- **Integration** covers the API and the runner without the browser: `POST /runs` with mock workers, WS events, retry, cache, two Yjs clients through Hocuspocus. Fast enough to run on every commit.
- **Unit tests only for pure modules:** `validate()`, kind and fan-out inference, cache key, `migrate`. These are combinatorial (20 kind cases) and would be slow and brittle as E2E. No unit tests for React components, stores or UI glue; E2E covers those.
- **Mock workers** are a first-class feature (`MOCK_WORKERS=1`): they return fixed assets in 200 ms so E2E and integration never spend credits.

**Local dev (the whole POC runs here)**

No cloud during the POC. Neon and object storage come after the go decision; the only change then is two environment variables.

| Piece | Local choice | Notes |
| --- | --- | --- |
| On the machine | Node 22, pnpm, Docker Desktop, ffmpeg, Chrome | Playwright downloads its own Chromium |
| `docker compose up -d` | Postgres 16, MinIO | Postgres = the database (pg-boss makes its own tables). MinIO = S3-compatible asset store, web UI on `:9001` to look at assets. Nothing else. |
| `pnpm dev` | `server` (API + Hocuspocus), `runner` (pg-boss loop), `web` (Vite) | Three processes, one command |
| `.env.local` | `DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `MOCK_WORKERS=1`, model keys empty until step 5 | Committed as `.env.example` |
| Mock workers | Return fixed assets from `fixtures/` (a few images, one short mp4, one wav) after 200 ms | Default on. Steps 1–4 and 6–8 spend zero credits. |
| Tests | `pnpm test` = Vitest unit + integration against the compose Postgres; `pnpm e2e` = production build + Playwright, mock workers | Both run on the laptop; no CI needed for the POC |
| Debug | `?debug=1` on the canvas URL shows the FPS meter and the "add 128 / 256 / 512 nodes" button | Used for criterion 6 |

Repo layout: pnpm workspace with `contracts/`, `graph/` (Graph API + Yjs), `server/`, `workers/`, `web/`, `fixtures/`, `e2e/`. Start: `git clone`, `docker compose up -d`, `pnpm i`, `pnpm dev`.

**Non-negotiables** (a build that breaks one of these is not done, even if it works):

- All graph writes go through the Graph API; no direct Yjs or React Flow state writes from UI code.
- Run status and validation issues never enter the Yjs doc. Positions are written on drag stop only.
- The canvas holds asset ids and thumbnails only, never full-size files.
- One `BaseNode`; `nodeTypes` declared once outside components; no custom form per node type.
- The server re-validates every recipe with the same invariants as the client.
- Workers are pure, call models only through `ctx.models`, and store files only through `putAsset`.

## Risks and decisions

**Risks**

| Risk | Effect | What we do |
| --- | --- | --- |
| Registry cannot express a real node cleanly | Criterion 2 fails; special-case code creeps into the canvas | Pick the 8 POC types to cover every hard case (fan-out, branch, user choice, long job, two inputs) before writing canvas code |
| Canvas is smooth but confusing | Criterion 3 fails; the tool needs training | Palette as the single entry point; inline errors; Thao tests first and logs every point of confusion as a fix |
| `Fan-out` and `flow.if` make the runner complex | Runner takes longer than planned | Fan-out is one level only (no list inside list) in the POC; flow.if has one condition, no expressions |
| Media jobs are slow or unstable | Criterion 4 is hard to test | Workers are thin API calls; a mock worker flag returns fixed assets so the runner can be tested without spending credits |
| Yjs doc and run snapshot get out of step | Run uses an old graph by mistake | Run stores the graph version; the canvas shows which version is running |
| Big images still slow the canvas | Criterion 6 fails | Thumbnails from day 1; an image service makes a 300 px version on upload |

**Decisions (29 Sep 2026)**

| Question | Decision |
| --- | --- |
| Pilot flow | Media generation (prompt → image → edit → video → audio → export), not video localization. Other flows come later as new node types only. |
| Extensibility target | A new node type in under 1 hour, no canvas change. The node set will keep growing, so attaching a new node to a flow must stay easy to understand for the user. |
| Usability test | Thao tests first, no guide, under 10 minutes. A 3-person team test comes after the POC. |
| Reference machine | 16 GB RAM laptop, production build. |
| Job queue | pg-boss on Postgres. Local Postgres in Docker for the POC; Neon after the go decision (direct connection string). BullMQ as fallback. |
| Output cache | In the POC. |
