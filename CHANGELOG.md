# Changelog

## 0.1.0 — 2026-09-30

First end-to-end local mock POC release.

- Build media graphs with registry-driven nodes, automatic compatible-port resolution, atomic graph edits, grouping, undo/redo and recipe import/export.
- Save locally, edit offline and synchronize through Yjs, IndexedDB and Hocuspocus.
- Run mock image, edit, video and audio workflows through Postgres, pg-boss, MinIO and ffmpeg, with live status, targeted retry, cancellation, cache reuse and usage accounting.
- Use a light canvas with a node-attached editor, reduced-motion support, selected-edge signals, alignment guides and magnetic + handles with smooth shared-anchor connections.
- Keep snapping within 5 screen pixels at every zoom, publish corrected drag positions once, and render only edges whose signal activation changes during selection.

Validation: 20 contract checks, 32 unit/integration tests and 26 production E2E scenarios pass. All five 128-node benchmarks recorded 60 FPS on the local host. See [verification evidence](docs/verification.md).

Model workers are mocked. Real model providers, authentication and cloud deployment are outside this release.
