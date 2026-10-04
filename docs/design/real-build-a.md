# Real build, Phase A (#25)

Real models run through our own queue. `@` links point at files, the Studio pages keep their
history on the server, and the library only shows results someone kept. Phase B (the canvas
on the shared kit) comes later.

## What is in

**A0 contracts**

- Model catalog: `contracts/models/*.json`, served by `GET /models`. A generate node has a `model`
  param, either `"auto"` or a key. `resolveModel` picks the catalog default that fits the
  connected inputs and mode. The model's own fields (ratio, duration, voice…) are validated
  against the catalog, and template validation accepts them too.
- Generate nodes are v2: `mode`, roles as target ports (`first`, `last`, `reference`, `source`…),
  `Port.max` and `Port.modes`. `migrateRecipe` upgrades v1 nodes once, on load, import, run and
  template use (video `image` → `first`, `aspect` → `ratio`, `durationSec` → `duration` clamped to
  4–30, `seed` dropped).
- Prompt tokens: `@[Label](asset:id)` and `@[Label](node:id)`. `validate` reports `REFERENCE` when
  a token's file is no longer connected. The Studio shows `@Label` and stores the token.
- `text.generate` (preset, system, effort). Runs carry `target` (run one node). Jobs keep the
  request, the intent (what was typed) and the final prompt (after Auto prompt).
- `assets.kept`: uploads are always kept. A result is kept once it is used as an input,
  downloaded, or kept by hand (`POST /assets/:id/keep`, `/unkeep`).

**A1 queue (D6)**

- `gen-submit` claims a model slot (advisory lock per model; oldest waiter first; per-user cap
  `GEN_USER_MAX`). It then submits and schedules `gen-fetch` at the ETA. A provider callback
  (`POST /providers/callback`, HMAC-signed, needs `PROVIDER_CALLBACK_BASE_URL`) only brings the
  fetch forward.
- ETA comes from `gen_stats` (p50/p90 per model and size bucket), falling back to the catalog's
  `eta.baseSec`. Cards show "≈ 1 min 40 s" and "In line · #N" instead of a fake progress bar.
- Cancel: a task still queued at the provider is cancelled there. A running one is dropped: its
  result is stored unkept and never shown. Transient errors retry with backoff, permanent ones
  fail the job. If the runner restarts it does not resubmit. A submit that was interrupted fails
  as `INTERRUPTED`.
- BytePlus port (owner's logic only, no NodeTool code):
  - Seedream (`images/generations`).
  - Seedance (task submit, fetch, `DELETE` cancel).
  - Seed Audio TTS (voice host, `X-Api-Key`).
  - Chat (`/chat/completions`, OpenAI-compatible, `thinking` from effort).
  - References go up through TOS, presigned with our own SigV4. Real-person references go
    through the Assets API as `asset://`.
- The mock adapter goes through the same queue (video is a `mock_tasks` row that is queued for
  the first half of its time), so everything above runs without keys.

**A2 Studio** (`/studio/text|image|video|audio`, link on the home page)

- One hidden canvas per user and kind (`GET/PUT /studio/:kind`): the generate node `studio`, plus
  an `input.asset` node and an edge (with its role) per reference. Runs are `POST /runs` with
  `target: "studio"`, so the Studio and the canvas share one runner.
- Feed = that node's history from the server (`GET /canvases/:id/nodes/:nodeId/history`).
  Cards show the queue stage and ETA. Each card has Stop, Re-edit (fills the composer with the
  intent), Regenerate (runs the entry again with its final prompt and leaves the composer alone),
  Delete with Undo, Keep / Unkeep and Download (which keeps).
- References: Upload (`POST /assets?canvasId=`) or From library (kept files of the kinds the page
  takes). Each file lands on the first free role. With nothing attached yet, a page switches mode
  when it has to (Text to video + an image → First & last frame). Removing the last image falls
  back to a mode that fits. Typing `@` offers the attached files.
- Detail modal: the result, what was typed, what was sent to the model, every parameter,
  Keep / Download, Clone & try (fills the page of that kind), and a filmstrip.
- History dock: generated media across Studio pages and canvases (`GET /history`), filtered by
  prompt words, time and type. Below 900 px it overlays the feed.

**A3 text**: `text.generate` and Auto prompt both use the LLM adapter through the queue. Auto
prompt only uses a rewrite that keeps every `@` token. The Text page has the presets.

**A4 library**: the media browser lists kept files only. "Show results not kept" lists
everything (`kept=all`), and asset details have Keep / Kept next to Download.

## Running it

- Mocks (default, `MOCK_WORKERS=1`): `pnpm build && pnpm start`, then open `/studio/image`.
  `MOCK_DELAY_MS` and `MOCK_VIDEO_MS` set how long the mock takes.
- BytePlus (`MOCK_WORKERS=0`): set the `BYTEPLUS_*` keys in `.env.local` (see `.env.example`).
  Keys live in the environment only.
- Live probe (**costs money**, run only when asked, cheapest first):
  `pnpm probe:byteplus` runs C1 I1 A1. Add `--only V1,V2` for Seedance at 480p / 4 s,
  `--only P1,P2 --person <photo>` for TOS + `asset://`, and `--only X1` to cancel.

## Verified on mocks

- `pnpm typecheck` and `pnpm build` pass. Changed files are formatted with Prettier.
- `pnpm test`: 37 + 10 contract checks and 146 Vitest tests (18 files). The queue and BytePlus
  suites replay recorded provider answers, including the AWS SigV4 test vector.
- Playwright: 39 of 44 pass, including the 7 scenarios in `e2e/studio.spec.ts`:
  - image: run, Keep, details, History dock search, Delete + Undo
  - upload + `@` + Re-edit + Regenerate
  - video: ETA and Stop while queued
  - a finished video plays
  - text preset; Auto prompt (detail shows what was sent) + Clone & try
  - audio
  - library picker + narrow-screen dock

  The canvas, motion, template, palette and media specs were updated for v2 nodes and kept
  results.
- The 5 that fail are the 128-node FPS gates. They also fail on `main` in this cloud container
  (headless, no GPU). On `main`, edge-signal ran at 28 FPS (31 on this branch), and the max
  frame was 133 ms and 100 ms against a 100 ms gate. Run on their own, two of the five pass here.
  They need a check on the reference laptop.

## Not proven live yet

These were never run against the real account. Check them with the probe before turning them on:

- `asset://` passing the real-person screen on this account
- `asset://` for video and audio
- the exact format of the input-screen error
- Seed Audio TTS (voice ids, formats)
- callbacks reaching a public URL

## Later (Phase B and beyond)

- The canvas on the shared kit: composer on nodes, roles and modes in the node UI. Today the
  canvas only switches a node's mode when the first input lands on a mode-only port.
- Voice library UI. Seed Audio's `voice` is a free-text speaker id for now.
- Audio waveforms (no peaks are stored yet).
- Credits and quotas.
