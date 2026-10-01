# Asset platform: catalog, storage and search

Backend for [issue #11](https://github.com/thaolhcx/zcanvas/issues/11), covering the catalog ([#16](https://github.com/thaolhcx/zcanvas/issues/16)), storage and delivery ([#17](https://github.com/thaolhcx/zcanvas/issues/17)) and semantic search ([#18](https://github.com/thaolhcx/zcanvas/issues/18)). The media browser frontend ([#19](https://github.com/thaolhcx/zcanvas/issues/19)) builds on these contracts. The design handoff is [PR #15](https://github.com/thaolhcx/zcanvas/pull/15).

Shared types are in [`contracts/assets.ts`](../contracts/assets.ts). Example responses are in [`contracts/examples/assets/`](../contracts/examples/assets), and a test checks them against the live API.

## Plan and status

| Step | Scope | Status |
| --- | --- | --- |
| 1. Contracts | Space, asset, list/search/delete/usage types, error shape | Done |
| 2. Schema and migration | Spaces, members, projects, catalog columns, objects, indexes, rerunnable legacy migration | Done |
| 3. Access | Server-resolved actor, space roles on every route and on the graph/run path | Done |
| 4. Storage | `ObjectStore` with local and S3 adapters, opaque keys, a storage profile per object | Done |
| 5. Ingest and lifecycle | Streamed uploads, upload/processing/ready/failed/deleted states, previews (video in the background), cleanup, sweeper | Done |
| 6. Delivery | Streaming range/HEAD/validators, private caching, safe names, disconnect handling | Done |
| 7. Catalog API | Spaces, paged list, details, upload, rename, delete, usage, media URLs | Done |
| 8. Runner integration | Space-scoped `input.asset`, generation metadata, publish-on-success, cache safety | Done |
| 9. Semantic search | Provider boundary, pgvector index, background jobs, hybrid query, fallback states | Done |
| 10. Evidence | Contract, access and search tests; 10k-row benchmark; 100 MB storage benchmark; real-embedding evaluation | Done (local and MinIO) |

## Ownership and access model

- **User**: the actor. The POC has no login. The server takes one identity from configuration (`ZCANVAS_ACTOR_ID`, default `usr_local`). Request data never chooses the identity or grants a permission. Tests create a second app instance with another configured actor to check isolation.
- **Space**: owns canvases and assets. Each user has one personal space (`spc_<user>`; the default actor's is `spc_local`). Team spaces have explicit members. A member's role is `owner`, `editor` or `viewer`.
- **Project**: groups canvases *inside* a space (`projects.space_id`, `canvases.project_id`). A project is not a team and grants no access of its own.
- **Canvas**: belongs to exactly one space. Its runs inherit that space.
- **Asset**: has exactly one owning space (`space_id`). `creator_id` (who uploaded it or started the run), `source` (upload or generated, with canvas/run/node) and the physical location (`asset_objects`: storage profile and key) are separate fields. Ownership never changes when a file is renamed, reused or moved between stores.

Rules, enforced on the server in `server/src/access.ts`:

1. Any member may read the space's canvases, runs, assets, files, previews, usage and search results.
2. Owners and editors may also write: upload, rename, delete, create canvases, and start, retry or cancel runs. Viewers get `403`. A viewer's sync connection is read-only.
3. A non-member gets `404` for everything in the space, so a space's existence is not revealed. Unmapped records (no space) are visible to nobody.
4. A canvas may use an asset only from its own space. `POST /runs` rejects other-space, deleted and missing assets with `INPUT_REQUIRED`, and the runner checks again at execution time. The output cache key includes the space, so cached outputs cannot cross spaces.
5. Search uses the same space check, and its filters run inside candidate retrieval.

Not built (extension points only): login, invitations, team admin UI, cross-space sharing, public links, ownership transfer, folders, collections and film roles. Future collections should reference asset IDs (for example a `collection_items(collection_id, asset_id)` table) and never file paths.

## Generation history

Only assets made by a run on the platform have `source.type = "generated"` and a `generation` record. Files made elsewhere are uploads: they have a name, description and tags, never a `generation` record, and clients cannot set one. The runner writes the record once, from the run snapshot, when the output is stored (`generationInfo` in `server/src/runner.ts`). Later node edits, renames and deletes never rewrite it.

| Field | Content |
| --- | --- |
| `nodeType`, `typeVersion` | The node that made the asset |
| `prompts` | Text inputs by input port (for example `prompt`, `negative`), or `prompt` when the text came from the node param |
| `prompt` | All prompts joined. Used for display and search |
| `model` | The model the node asked for |
| `settings` | The other node params as JSON, including objects and lists |
| `references` | One `{ name, id, port }` per input file. `name` is the file name at run time, as plain text. `id` is lineage only, not permission: the asset may since have been deleted. Records saved before IDs were kept have only `name`; `migrate()` converts the old plain-string form and is safe to rerun |
| `provider` | What the model provider reported, when it reports it: `name`, the `model` and version that actually ran, `seed`, `requestId`. A worker passes it as `meta.provider` to `putAsset`; unknown fields are dropped. The mock provider reports `mock` |
| `truncated` | `prompt` and/or `settings` when a value went over a limit: 4,000 characters per prompt and 8,000 characters of settings JSON. Over that limit only short scalar settings are kept. Nothing is dropped without this mark |

Credits stay in the `usage` table by job, and `source.runId` leads to the run's full recipe snapshot.

## Lifecycle

```
upload:     uploading ──► ready ──► deleted ──(grace period, no running reader)──► purged bytes
               │                        ▲
               └──► failed ──► purged   │ DELETE
generated:  uploading ──► processing ──► ready (only when the job finishes on the current run)
                              └──► failed (job failed, cancelled or superseded by a retry)
preview:    pending ──► ready | failed      (audio: none)
```

- `beginAsset` records the asset and its intended storage key *before* any bytes arrive. An interrupted request therefore leaves a `failed` row that cleanup can find. A crash is caught by the sweeper, which fails uploads/outputs stuck longer than `ASSET_STALE_WRITE_SEC` and queues cleanup.
- Uploads stream to a private temp file (SHA-256, byte limit). The file is checked with sharp or ffprobe, written to the store, and then marked `ready`. Postgres and the object store do not share a transaction. Each step is ordered so that a failure leaves a `failed` row and a cleanup job, never a `ready` row without bytes.
- Previews are 300 px JPEGs. Image thumbnails take milliseconds, so they are made during upload from the temp file. Video posters, and any failed image thumbnail, are built by the `asset-derive` pg-boss job with retries; a job that keeps failing marks the preview `failed`. While an image preview is pending or failed, the thumbnail URL serves the original with an `X-Preview-Status` header, so a broken preview never blocks a valid file. Video returns `404 PREVIEW_PENDING` or `PREVIEW_FAILED`.
- Dimensions and duration are read during upload because that read is also the validity check, and it takes milliseconds.
- **Delete** sets `status=deleted`, increments `revision`, removes the search entry in the same transaction and queues cleanup after `ASSET_CLEANUP_DELAY_SEC`. The row is kept as history: name, kind, source and timestamps. `GET /assets/:id` and file URLs return `410 ASSET_DELETED` with a small tombstone, so the UI can show a clear missing-file state.
- **In-flight runs**: bytes stay readable through the grace period. Cleanup also waits while a running run in the space references the asset. An `input.asset` node that executes after the delete fails with `INPUT_REQUIRED`.
- **Retries**: a finished job whose output asset was deleted reruns and produces a new asset. It does not reuse the deleted one.
- **Cache**: a cache entry that points at a deleted or failed asset is dropped and recomputed. A deleted asset is never brought back from the cache.
- **Recipes** are never rewritten. Deleting an asset reports the affected nodes on the given canvas (`DELETE /assets/:id?canvasId=…`, `GET /assets/:id/usage?canvasId=…`).

## HTTP API

All responses are JSON unless noted. Errors use `{ error, code, details? }`; `error` stays a readable string for existing clients. `code` is one of `ApiErrorCode`.

| Method and path | Purpose | Notes |
| --- | --- | --- |
| `GET /spaces` | Spaces the actor belongs to, with role and projects | `SpacesResponse` |
| `GET /assets?spaceId&q&kind&source&sort&cursor&limit` | Paged catalog list | Ready assets only. `sort`: `created_desc` (default), `created_asc`, `name_asc`. `limit` 1–100 (default 50). Keyset cursor with an ID tie-breaker. `q` is a case-insensitive name match with LIKE wildcards escaped. |
| `GET /assets/search?q&spaceId&kind&source&limit` | Hybrid name + semantic search | `limit` 1–50 (default 20), `q` ≤ 200 characters. See below. |
| `POST /assets?spaceId` or `?canvasId` | Multipart upload (`file`, optional `name` field before the file) | `201 Asset`. The default space is the actor's personal space. `413 TOO_LARGE`, `415 UNSUPPORTED_MEDIA`, `400 UPLOAD_INTERRUPTED` |
| `GET /assets/:id` | Details | `410` when deleted |
| `PATCH /assets/:id` | `{ name?, description?, tags? }` | Name 1–200 visible characters, description ≤ 2000, up to 20 tags of 1–40 characters. Unknown fields are rejected. |
| `DELETE /assets/:id?canvasId` | Soft delete plus affected nodes | `AssetDeleteResponse` |
| `GET /assets/:id/usage?canvasId` | Nodes on that canvas that reference the asset | Current canvas only, not the whole space |
| `GET`/`HEAD /assets/:id/file[?download=1]` | Original bytes | Ranges, `ETag`, `If-None-Match`, `If-Range` |
| `GET`/`HEAD /assets/:id/thumbnail` | Preview | See Lifecycle |

`Asset.url` and `Asset.thumbUrl` keep their old form (`/assets/:id/file`), so stored run outputs and old clients keep working. The new catalog fields on `Asset` are optional because older records do not have them.

The agent/MCP surface can call the same routes, or the service functions directly (`listAssets`, `searchAssets`, `patchAsset`, `deleteAsset`, `assetUsage`), with a server-resolved `Actor`.

## Storage and delivery

`server/src/storage.ts` defines one interface: `put` (exact byte count, atomic), `stat`, `read` (optional range, abort signal), `delete` (idempotent) and `check`.

- **Local** (`STORAGE_DRIVER=local`, default): files under `LOCAL_STORAGE_ROOT`. Keys are server-generated (`YYYY/MM/<uuid>[-thumb]`) and validated against a strict pattern. The adapter rejects `..`, absolute paths and other characters, and checks the real path of every directory against the root, so symlinked directories cannot escape. Files open with `O_NOFOLLOW`. Writes go to a `.part-*` file and are renamed only after the byte count matches. MinIO is not needed.
- **S3** (`STORAGE_DRIVER=s3`): endpoint, bucket, region, credentials, path style and optional key prefix are server configuration. MinIO is one supported target. The startup check runs `HeadBucket`. The bucket is created only when `S3_AUTO_CREATE_BUCKET=1` (intended for local MinIO).
- **Profiles**: every object row stores its `profile` and `key`. New writes use the active profile. Reads use the profile recorded on the object, and the server never searches another bucket or root. If an asset's profile is not configured, the response is an explicit `503 STORAGE_UNAVAILABLE`. Legacy POC objects are recorded in the `s3` profile under their old key (the asset ID). Further read-only profiles, such as an old bucket, can be declared with `STORAGE_READ_PROFILES` (JSON). A bulk copy tool is deferred.
- Credentials and paths never appear in API responses.
- **Delivery** (`server/src/media.ts`) streams from the store to the socket. It supports full, open-ended and suffix single ranges. A request outside the file gets `416` with `Content-Range: bytes */size`. Multi-range and non-byte units get a full `200`, which RFC 9110 allows. `HEAD` sends the real `Content-Length` without opening storage. A client disconnect destroys the upstream stream and aborts the S3 request.
- **Caching**: the old `public, max-age=31536000, immutable` policy was replaced with `private, no-cache` plus a strong `ETag` (content SHA-256). Browsers revalidate cheaply (`304`), and every use passes the access check. Short-lived signed URLs are not issued.

## Semantic search

- **What is searched**: one text per asset, built from the file name (stem, separators turned into spaces), kind, description, tags, the generation prompt and reference file names (`searchText`). Media bytes are never embedded or sent anywhere. A file with only an opaque name, such as `IMG_0001.jpg`, has very little to match. Image captions, transcription and pixel or audio similarity are future metadata sources. They would feed `searchText` without changing the index.
- **Providers** (`server/src/embeddings.ts`): `local` runs `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (384 dimensions, English and Vietnamese) in-process with transformers.js. It is an optional dependency, the model is downloaded once, and no text leaves the server. `openai` calls any OpenAI-compatible `/embeddings` endpoint; with it, the search text above (names, descriptions, tags, prompts, reference names) is sent to that provider. `hash` gives deterministic test vectors that match words, not meaning, and is used only in automated tests. `none` turns semantic search off.
- **Index**: Postgres with pgvector. The `asset_search_index` table holds `(asset_id, model)`, the asset `revision`, state, vector and content hash. pgvector keeps vectors next to the catalog rows and access columns, so scope filters and retrieval run in one SQL statement and no extra service is needed. Retrieval is an exact scan inside the allowed space: 10k vectors take about 26 ms at p95 (below). That makes filtering exact, with no global top-k followed by a filter. HNSW is the next step once one space holds hundreds of thousands of assets; it needs pgvector ≥ 0.8 iterative scans to stay exact under filters.
- **Jobs**: `asset-index` (pg-boss) runs after upload, publish, rename or metadata edit. Jobs are idempotent: unchanged text only moves the revision forward. A write lands only if the asset still has the revision the text came from, and it never replaces a newer revision, so late or duplicate jobs cannot overwrite newer data. Failures are recorded (`state=failed`, error, attempts) and retried. `pnpm assets reindex` backfills; `--all` re-embeds everything and `--prune` drops other models' vectors.
- **Model changes**: queries use only vectors whose `model` matches the active provider. After a switch, unindexed assets show up as `semantic.state = "indexing"` with a `pending` count until reindexing finishes. Vectors from different models are never compared.
- **Query**: name matches (exact name or stem first, then substring, then trigram similarity) are fused with semantic matches by reciprocal rank. An exact file name always ranks first. Both queries filter by space, `status='ready'`, kind and source in SQL. A final hydration step checks scope and state again at response time. Bounds: `q` ≤ 200 characters, `limit` ≤ 50, an embedding plus SQL timeout (`SEARCH_TIMEOUT_MS`, default 2500 ms).
- **Fallback**: when the provider is off, fails or times out, or pgvector is missing, the response still returns name results with `mode: "name"` and `semantic.state` set to `disabled`, `unavailable` or `timeout`. Browse and upload never depend on search.
- **Caches**: only query vectors are cached, keyed by model and query text. Results are always read fresh with the actor's scope, so a deleted or revoked asset cannot come back from a cache.

## Operations

```sh
docker compose up -d --wait           # Postgres + pgvector (MinIO only for STORAGE_DRIVER=s3)
pnpm assets migrate                   # also runs automatically at startup; prints unmapped records
pnpm assets assign <spaceId> [ids…]   # explicitly adopt reported legacy assets
pnpm assets sweep                     # fail stuck writes and queue cleanup
pnpm assets reindex [--all] [--prune] # semantic index backfill or rebuild (the runner processes it)
pnpm assets search-status             # index coverage for the active model
SEARCH_SEMANTIC=0                      # turn semantic search off (name search still works)
```

**Migration**: the API and runner run it at startup, and it is safe to rerun. Canvases without a space move to the configured actor's personal space; they all belonged to the single local workspace. Runs take their canvas's space. Generated assets take the space of the run that made them. Uploaded assets take the space of the canvases that reference them, but only when exactly one space does. Everything else is left unowned, recorded in `catalog_migration_issues` and reported. Asset IDs, `input.asset` params, worker contracts and stored run outputs are unchanged.

Configuration is listed in [`.env.example`](../.env.example).

## Evidence

Measured on a cloud container (4 vCPU Xeon 2.8 GHz, 16 GB), with Postgres 16.14 and pgvector 0.6.0 on the same host, default settings and a warm cache.

**Catalog, 10,000 rows in the space plus 10,000 in another space** ([`asset-catalog-bench.json`](evidence/asset-catalog-bench.json), query plans included). Target: 200 ms per page of 100.

| Query | p50 | p95 |
| --- | --- | --- |
| List first page (100, newest first) | 1.6 ms | 2.3 ms |
| List page 51 via cursor | 1.9 ms | 2.2 ms |
| List filtered by kind | 1.9 ms | 2.2 ms |
| List by name | 2.0 ms | 2.5 ms |
| Name search `lantern` | 5.8 ms | 10.7 ms |
| Semantic retrieval top 20, excluding embedding (target 500 ms) | 20.8 ms | 25.7 ms |
| Hybrid search service path (hash query vector) | 89 ms | 117 ms |
| Query embedding (local MiniLM) + retrieval | 33 ms | 49 ms |

**Storage, 99 MiB WAV, local adapter** ([`storage-bench-local.json`](evidence/storage-bench-local.json)): upload 1.6 s, with peak API RSS +20 MB; full download 0.36 s, +22 MB; 1 MiB range at start, middle and end ≈ 20 ms each, +0 MB. A client abort stops the read. A route that buffered whole files would need at least +100 MB.

**Storage, same 99 MiB WAV, S3 adapter against MinIO** ([`storage-bench-s3.json`](evidence/storage-bench-s3.json); MinIO `RELEASE.2025-10-15T17-29-55Z` on the same host, 4 vCPU Xeon 2.1 GHz, 16 GB): upload 1.2 s, +22 MB; full download 0.32 s, +37 MB; 1 MiB range at start, middle and end 24–48 ms, +0 MB; suffix range 22 ms. A client abort after 1 MiB stops the upstream read (+0.1 MB). The storage contract suite also passes against this MinIO (`S3_TEST_ENDPOINT=http://127.0.0.1:59000`).

**Search quality with real embeddings** ([fixture](../fixtures/search-eval.json): 32 assets with opaque names, 26 queries, 14 English and 12 Vietnamese, with expected IDs; several queries are cross-lingual).

| Model | recall@10 | English | Vietnamese | MRR |
| --- | --- | --- | --- | --- |
| `paraphrase-multilingual-MiniLM-L12-v2` (default) | **0.962** | 1.000 | 0.917 | 0.917 |
| `multilingual-e5-small` | 0.769 | 0.929 | 0.583 | 0.601 |

The only miss for the default model is "ruộng bậc thang" (rice terraces): the relevant clip is described only in English ("Drone shot flying over rice terraces…"). Reports: [`search-eval-local-xenova-paraphrase-multilingual-minilm-l12-v2.json`](evidence/search-eval-local-xenova-paraphrase-multilingual-minilm-l12-v2.json) and [`search-eval-local-xenova-multilingual-e5-small.json`](evidence/search-eval-local-xenova-multilingual-e5-small.json). Hash embeddings are never used as quality evidence.

**Automated tests** (`pnpm test`):

- `storage.test.ts`: adapter contract (write, stat, read, range, delete, short/long/failed writes, key validation) against a temporary directory and, with `S3_TEST_ENDPOINT`, MinIO; symlink escape, range parsing, download names.
- `assets.test.ts`: upload, preview fallback, pagination with identical timestamps, filters and validation, rename, generated metadata and history, publish-on-success, cancelled runs, access on every route and on the run path, team viewer roles, delivery (range, suffix, 416, HEAD, 304, disconnect), delete, `INPUT_REQUIRED` and retry, cache safety, purge, interrupted upload, size limit, legacy migration and rerun.
- `search.test.ts`: description and prompt matches, exact-name priority, filters, cross-space isolation, immediate removal on delete even with a cached query, revision ordering, model change and reindex, failure, timeout and disabled fallbacks, recorded index failures, bounds.
- `fixtures.test.ts`: example responses match the live API.

## Limits

- **S3 coverage** is the contract suite and the 100 MB benchmark against one MinIO release. Only the S3 operations the app uses are covered, and no vendor is claimed as certified. In a cloud session without Docker, [`scripts/cloud-setup.sh`](../scripts/cloud-setup.sh) installs Postgres + pgvector and builds and starts MinIO.
- The `openai` provider is implemented but was not called here (no key). Quality evidence uses the in-process model.
- The frontend media browser is issue #19. The only frontend change here is that uploads now go to the canvas space.
- E2E: 25 of 26 Playwright scenarios pass in this container. `pans a 128-node canvas above 50 FPS while four selected edges signal` measured 37–39 FPS. That scenario imports 128 `image.generate` nodes with no assets or runs, so it does not exercise this backend; the result reflects this headless 4-vCPU container. The other 128-node FPS scenarios passed.
