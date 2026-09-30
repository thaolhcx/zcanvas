# Zcanvas

**v0.1.0** — first end-to-end mock POC release. See the [release notes](CHANGELOG.md).

A local-first node canvas for creative media workflows. This POC implements the [PRD](docs/prd.md) with **mock workers**: it exercises the real graph, sync, queue, asset storage, streaming status, and ffmpeg export without calling paid model APIs.

## Run locally

Install Node 22+, pnpm 10, Docker and ffmpeg (`ffprobe` must also be on PATH).

```sh
cp .env.example .env.local
docker compose up -d --build --wait
pnpm install
pnpm dev
```

Open **http://127.0.0.1:5173**. Choose **Open pilot flow** to inspect the supplied example, or **New canvas** to build one from the palette. Click Run to produce two playable 12-second fixture clips. The original example's model parameters are retained; mock media duration is fixed at 12 seconds.

The first Docker build compiles MinIO from a pinned official source revision because the old official image is no longer available. Subsequent starts use the cached image. The database and object store use named volumes; `docker compose down` preserves them.

| Service | Address |
| --- | --- |
| Canvas (dev) | http://127.0.0.1:5173 |
| Canvas (production preview) | http://127.0.0.1:4173 |
| HTTP API + run events | http://127.0.0.1:4310 |
| Hocuspocus graph sync | ws://127.0.0.1:4311 |
| Postgres 16 | localhost:55432 |
| MinIO API / console | localhost:59000 / localhost:59001 |

All services bind to loopback. This is a single-user local POC, with no login or deployment setup. The example credentials are for these local containers only.

## Validate

With Docker services running:

```sh
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm e2e
```

`pnpm test` reproduces the supplied 20 contract tests, then runs Vitest integration tests against real Yjs, Hocuspocus, Postgres, pg-boss, MinIO and ffmpeg. `pnpm e2e` builds the production frontend and starts the API, runner and preview server. Tests use mock workers. API integration tests create isolated canvas/run IDs; they retain run and asset evidence in the local database.

For a persistent production preview:

```sh
pnpm build
pnpm start
```

Append `?debug=1` (or `&debug=1`) to show an FPS meter, frame-duration measurement, 128/256/512-node fixture controls, and mock failure injection while a run is active. Start frame measurement after the graph has loaded, then drag/pan/zoom.

## Use the canvas

- `/`, `+`, or double-click empty space opens the node palette. Each node has one input and one output +: click one, or drop its connection on empty space, to open a compatible palette. The canvas resolves the actual recipe ports automatically.
- Select a node for the registry-driven editor anchored beneath it. The editor follows dragging and pan/zoom; the node body shows common params. Invalid fields stay visible, and Run is blocked until fixed.
- Occupied single-value inputs reject new connections. Select an edge and press Delete to remove it before reconnecting. Multiple-value inputs accept additional connections.
- Drag nodes near an edge or center to align them: guides appear during dragging and snap within 5 screen pixels at every zoom. Multi-node selections and groups move together.
- Hover near the + icons to reveal their magnetic controls. Selected nodes signal along attached connections; reduced-motion preferences disable animation.
- `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`: undo/redo. `Cmd/Ctrl+C/V/D`: copy/paste/duplicate. `Cmd/Ctrl+G`: group. `Cmd/Ctrl+Enter`: run. `F`: fit view. Space-drag pans.
- The canvas-name menu exports/imports recipe JSON and saves presets. Opening a preset creates a new canvas.
- A run uses an immutable graph snapshot. Editing the graph does not change a running job. Use a fresh Run after changing params; cache reuse makes unchanged work free. Retry uses the previous run snapshot and reruns the selected node plus its descendants.
- Select older runs in the header. On reconnect, the client reloads their current state and resumes events from its last event ID.
- Edits persist in IndexedDB and sync through Hocuspocus. The production build caches its app shell for offline reload after the first successful visit; dev mode needs the Vite server to reload.

## Repository

| Directory | Responsibility |
| --- | --- |
| `contracts/` | Schemas, eight node definitions, shared TypeScript contracts, browser-safe validator |
| `graph/` | Yjs Graph API, atomic draft validation, import/export, grouping/layout, undo |
| `server/` | HTTP API, Hocuspocus persistence, pg-boss run processing, asset service, models boundary |
| `workers/` | Small worker functions using only `RunContext` |
| `web/` | React Flow canvas, registry-driven BaseNode, Zustand UI/run stores, IndexedDB |
| `fixtures/` | Original generated test media: portrait PNG, 12-second MP4, 12-second WAV |
| `e2e/` | Playwright production-build scenarios |
| `docs/` | Original source documents, implementation interpretations and verification evidence |

The graph contains only recipe data. Run state, outputs and validation issues never enter Yjs. All edits use the Graph API; node positions commit on drag stop. Per-key Yjs changes preserve references for unaffected nodes. Images use 300-pixel thumbnails; full media is fetched only for export/opening.

## Boundaries

Real model providers are deferred. `MOCK_WORKERS=0` fails explicitly when a model worker runs; there is no silent fallback or paid API call. Mock credits test accounting and are not actual charges. `userId` and `projectId` in usage records remain null.

The automated tests are evidence for the implementation, not acceptance of the human criteria. Thao's unassisted 10-minute usability test, the independent developer's one-hour extension test, and the 16 GB reference-laptop performance check still require those real observations. See [implementation notes](docs/implementation.md).
