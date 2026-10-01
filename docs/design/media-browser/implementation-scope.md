# Implementation scope update

On 2026-10-01, after the design notes were approved, the owner requested separate backend and frontend sub-issues under issue #11.

## Updated scope

- Build a general asset backend that can support future ways to organize data.
- Support both S3-compatible object storage and local filesystem storage.
- Provide fast media delivery, indexed browsing and semantic search.
- Implement the frontend from the approved basic prototype and the design notes.

This request replaces the original "local MinIO only" boundary. MinIO remains one supported S3-compatible target. It also replaces the design note's earlier statement that storage and semantic search were not yet in the agreed implementation scope.

The original "No cross-project sharing" rule now needs a clear distinction: assets may be reused by canvases that have access to the same space. Arbitrary sharing across unrelated spaces, moving ownership, public links and external storage connectors are not part of this release.

Personal and team spaces describe access and ownership. Projects group work inside a space. Keep those concepts separate. The current app has no login system; do not present sample spaces or client-supplied IDs as real access control.

## Work split

1. Asset catalog, space model and API contracts.
2. Local/S3 storage and fast media delivery.
3. Semantic search and its background index.
4. Media browser frontend and end-to-end integration.

Agree on catalog and storage contracts first. Storage and search can then proceed independently against those contracts. Frontend work can begin with contract-based fixtures and finish against the real services.

The child issues define implementation details, dependencies and acceptance checks. The parent issue stays open until all four parts and the end-to-end checks are complete.

## Extension points, not extra features

Keep asset identity separate from physical storage, and keep ownership separate from creator and source canvas. Future collections, tags and film roles should refer to asset IDs. They must not require moving files or changing existing canvas references.

Start with the existing Postgres, pg-boss and asset contracts where practical. Add small interfaces only where the current work needs them. Do not build a generic organization framework, full digital asset management system or provider marketplace.

A mini browser and film-specific organization remain out of scope.
