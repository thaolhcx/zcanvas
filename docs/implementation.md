# Implementation and verification

Scope confirmed: the end-to-end POC with mock workers. Real model integration is deferred.
The original PRD and supplied contracts source are preserved in this directory.

## Build gates

- [x] Supplied 20 contract tests reproduced before changes.
- [x] Browser-safe contracts and TypeScript interfaces.
- [x] Graph API: atomic transactions, recipe round-trip, undo/redo.
- [x] Hocuspocus + Postgres: two clients, offline edits and reconnect.
- [x] pg-boss runner: pilot, fan-out, branch, failure/retry, cancellation and cache.
- [x] Canvas + production Playwright scenarios.
- [x] Performance instrumentation and automated measurement.
- [x] Extensibility example and developer instructions.

## Explicit interpretations

- Missing required params/inputs are allowed while editing; all issues block execution.
- Import retains recipe data; subsequent edits, including undo/redo, advance graph version. Tests compare graph content separately from revision metadata.
- Cache keys also include input values and port bindings. The PRD's asset-only key would incorrectly reuse images after changing a text prompt.
- Retry uses the original immutable run snapshot. Editing params requires a new Run, as specified in the Execution section.
- List inputs are zipped by item index, scalars broadcast; conflicting list lengths fail explicitly. Untaken branches are skipped per item, including downstream jobs.
- Mock exports mux a real fixture video and audio into playable files. They are not model-generated media.
- Human usability (<10 minutes), an independent developer's <1-hour extension test, and 16 GB reference-laptop performance acceptance cannot be self-certified by automation.

## Changes from the supplied contracts implementation

The original attachment remains unchanged in `contracts-source.md`. Schema files, eight definitions and pilot recipe were extracted verbatim. The validator now imports schema JSON without Node filesystem dependencies; `loadRegistry` lives in a Node-only module. The original 20 assertions still pass. Additional validation rejects non-finite/fractional numeric values, checks JSON params, and preserves union port kinds instead of silently choosing the first kind.

MinIO is built from official source at `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a` (`RELEASE.2025-10-15T17-29-55Z`). The old Docker Hub and Quay images could not be pulled in this environment. Postgres and MinIO use dedicated local volumes and loopback ports.

Run tasks are durable pg-boss queue entries; their node/item jobs and outputs are stored in `jobs`. Recovery resumes unfinished runs and reuses completed jobs. Per-type concurrency is enforced across runs within the single local runner process. Cache keys preserve port bindings, list order and inline values as well as asset IDs.

The numbered graph revision is metadata, not a global sequence for concurrent offline edits. A run always stores the full submitted snapshot, so revision collisions cannot change a running graph.
