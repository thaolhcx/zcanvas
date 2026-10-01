#!/usr/bin/env bash
# Setup for Claude Code cloud sessions (no Docker daemon): Postgres 16 with
# pgvector, and MinIO for STORAGE_DRIVER=s3 and the S3 storage contract tests.
# Same ports and credentials as compose.yaml and .env.example. Idempotent.
# Paste into the environment's Setup script, or run: bash scripts/cloud-setup.sh
set -euo pipefail

PG_BIN=/usr/lib/postgresql/16/bin
PG_ROOT=/opt/pg
PG_DATA=$PG_ROOT/data
# Same pinned MinIO source revision as infra/minio.Dockerfile.
MINIO_TAG=RELEASE.2025-10-15T17-29-55Z
MINIO_COMMIT=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a
MINIO_DIR=/opt/minio

# --- Postgres 16 + pgvector -------------------------------------------------
if ! dpkg -s postgresql-16-pgvector >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq postgresql-16 postgresql-16-pgvector >/dev/null
fi
if [ ! -f "$PG_DATA/PG_VERSION" ]; then
  mkdir -p "$PG_ROOT"
  chown postgres "$PG_ROOT"
  su postgres -c "$PG_BIN/initdb -D $PG_DATA -U postgres -A trust >/dev/null"
fi
if ! su postgres -c "$PG_BIN/pg_ctl -D $PG_DATA status" >/dev/null 2>&1; then
  su postgres -c "$PG_BIN/pg_ctl -D $PG_DATA -o '-p 55432 -k /tmp -c listen_addresses=127.0.0.1' -l $PG_ROOT/log -w start"
fi
psql_admin() { psql -h 127.0.0.1 -p 55432 -U postgres -tAc "$1"; }
[ "$(psql_admin "SELECT 1 FROM pg_roles WHERE rolname='zcanvas'")" = 1 ] ||
  psql_admin "CREATE USER zcanvas PASSWORD 'zcanvas' SUPERUSER"
[ "$(psql_admin "SELECT 1 FROM pg_database WHERE datname='zcanvas'")" = 1 ] ||
  psql_admin "CREATE DATABASE zcanvas OWNER zcanvas"

# --- MinIO (built from the pinned source; official binaries are no longer published)
if [ ! -x "$MINIO_DIR/minio" ]; then
  rm -rf "$MINIO_DIR/src"
  mkdir -p "$MINIO_DIR"
  git clone -q --depth 1 --branch "$MINIO_TAG" https://github.com/minio/minio.git "$MINIO_DIR/src"
  test "$(git -C "$MINIO_DIR/src" rev-parse HEAD)" = "$MINIO_COMMIT"
  (cd "$MINIO_DIR/src" && CGO_ENABLED=0 GOTOOLCHAIN=auto go build -trimpath -o "$MINIO_DIR/minio" .)
  rm -rf "$MINIO_DIR/src"
fi
if ! curl -sf --noproxy 127.0.0.1 http://127.0.0.1:59000/minio/health/live >/dev/null; then
  mkdir -p "$MINIO_DIR/data"
  MINIO_ROOT_USER=zcanvas MINIO_ROOT_PASSWORD=zcanvas-local-only \
    nohup "$MINIO_DIR/minio" server "$MINIO_DIR/data" \
    --address 127.0.0.1:59000 --console-address 127.0.0.1:59001 >"$MINIO_DIR/log" 2>&1 &
  for _ in $(seq 1 30); do
    curl -sf --noproxy 127.0.0.1 http://127.0.0.1:59000/minio/health/live >/dev/null && break
    sleep 1
  done
fi
curl -sf --noproxy 127.0.0.1 http://127.0.0.1:59000/minio/health/live >/dev/null
echo "Postgres+pgvector on 127.0.0.1:55432, MinIO on 127.0.0.1:59000"
