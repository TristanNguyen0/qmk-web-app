#!/bin/sh
# Backs up the application database.
#
# What this backs up: `configurations`, `configuration_revisions`, `builds`,
# `artifacts` and every other object in the application database, via a
# custom-format `pg_dump`, plus the cluster's roles and their grants via
# `pg_dumpall --globals-only`. Both dumps are needed together: a single-database
# custom-format dump does not carry roles, so restoring into a fresh cluster from
# only the database dump would silently lose `qwa_worker` and its narrow grant
# list — a security property (apps/api/migrations/003_worker_role.sql), not a
# convenience.
#
# What this deliberately does NOT back up: artifacts and build logs. They are
# seven-day ephemeral by policy (packages/domain/src/limits.ts
# BUILD_LIMITS.artifactRetentionMs / logRetentionMs) and are deterministically
# reproducible from a stored configuration revision plus the pinned catalog
# version, QMK commit, generator version and build image digest — every one of
# which is already recorded on the build row. Backing them up would duplicate a
# rebuild's job without buying a durability guarantee a rebuild does not already
# provide. See docs/runbooks/backup-restore.md for the full reasoning.
#
# Usage: infra/deploy/backup.sh <destination-directory>
#
# Reads connection details from QWA_DATABASE_URL, or from QWA_DB_HOST /
# QWA_DB_PORT / QWA_DB_USER / QWA_DB_NAME individually, falling back to the
# infra/deploy/docker-compose.yml development defaults. Runs pg_dump/pg_dumpall
# inside the compose postgres container via `docker compose exec` whenever that
# service is running, and falls back to a local pg_dump/pg_dumpall otherwise —
# matching the client tool version to the server version matters for
# pg_dump/pg_dumpall, and the container is guaranteed to have the right one.
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)

DEST_ROOT="${1:?usage: backup.sh <destination-directory>}"

# --- connection details -----------------------------------------------------
# Development defaults mirror infra/deploy/docker-compose.yml exactly.
QWA_DATABASE_URL="${QWA_DATABASE_URL:-}"
DB_HOST="${QWA_DB_HOST:-127.0.0.1}"
DB_PORT="${QWA_DB_PORT:-5433}"
DB_USER="${QWA_DB_USER:-qwa}"
DB_NAME="${QWA_DB_NAME:-qwa}"
DB_PASSWORD="${QWA_DB_PASSWORD:-qwa_dev_password}"

if [ -n "${QWA_DATABASE_URL}" ]; then
  # postgres://user:password@host:port/dbname — parsed with a single sed pass per
  # field rather than a URL library, since shell has none and the format here is
  # fixed by our own defaults and docs.
  DB_USER=$(printf '%s' "${QWA_DATABASE_URL}" | sed -E 's#^[a-zA-Z]+://([^:]+):.*#\1#')
  DB_PASSWORD=$(printf '%s' "${QWA_DATABASE_URL}" | sed -E 's#^[a-zA-Z]+://[^:]+:([^@]+)@.*#\1#')
  DB_HOST=$(printf '%s' "${QWA_DATABASE_URL}" | sed -E 's#^[a-zA-Z]+://[^@]+@([^:/]+).*#\1#')
  DB_PORT=$(printf '%s' "${QWA_DATABASE_URL}" | sed -E 's#^[a-zA-Z]+://[^@]+@[^:/]+:([0-9]+).*#\1#')
  DB_NAME=$(printf '%s' "${QWA_DATABASE_URL}" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')
fi

export PGPASSWORD="${DB_PASSWORD}"

# --- pick a tool runner ------------------------------------------------------
# Prefer running pg_dump/pg_dumpall *inside* the compose postgres container,
# because that is the one place the tool version is guaranteed to match the
# server exactly. A host's local client is frequently a different major version
# (e.g. the host OS ships pg_dump 17 against this project's pinned Postgres 16),
# and that skew is not cosmetic: a newer pg_dump embeds SET commands for GUCs
# the older server does not recognise (`transaction_timeout`, added in 17), and
# pg_restore replays them verbatim — silently corrupting the restore. Fall back
# to a local pg_dump/pg_dumpall only when the compose service is not running,
# e.g. a deployment where pg_dump is installed and pinned to the server version
# directly rather than through this project's dev compose file.
COMPOSE_FILE="${REPO_ROOT}/infra/deploy/docker-compose.yml"
if command -v docker >/dev/null 2>&1 \
  && docker compose -f "${COMPOSE_FILE}" ps --status running --services 2>/dev/null | grep -qx postgres; then
  echo "using pg_dump/pg_dumpall inside the compose postgres container (exact server version match)" >&2
  # Inside the container the server is reachable on its own default socket/port —
  # never through the host-mapped port, which is not visible from inside.
  HOST_ARGS=""
  run_pg_dump() {
    docker compose -f "${COMPOSE_FILE}" exec -T \
      -e PGPASSWORD="${DB_PASSWORD}" postgres pg_dump "$@"
  }
  run_pg_dumpall() {
    docker compose -f "${COMPOSE_FILE}" exec -T \
      -e PGPASSWORD="${DB_PASSWORD}" postgres pg_dumpall "$@"
  }
elif command -v pg_dump >/dev/null 2>&1 && command -v pg_dumpall >/dev/null 2>&1; then
  echo "compose postgres service not running; using local pg_dump/pg_dumpall" >&2
  # HOST_ARGS connect to the host-mapped port from outside the container.
  HOST_ARGS="--host=${DB_HOST} --port=${DB_PORT}"
  run_pg_dump() { pg_dump "$@"; }
  run_pg_dumpall() { pg_dumpall "$@"; }
else
  echo "neither the compose postgres service nor a local pg_dump/pg_dumpall was found" >&2
  exit 1
fi

# --- produce the backup -------------------------------------------------------
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT_DIR="${DEST_ROOT}/${TIMESTAMP}"
mkdir -p "${OUT_DIR}"
# A dump contains every session's configurations. Restrict before anything is
# written into it.
chmod 700 "${OUT_DIR}"

DB_DUMP="${OUT_DIR}/database.dump"
GLOBALS_DUMP="${OUT_DIR}/globals.sql"

echo "backing up database '${DB_NAME}' at ${DB_HOST}:${DB_PORT} to ${OUT_DIR}" >&2

# shellcheck disable=SC2086 # HOST_ARGS is deliberately unquoted: empty or two flags.
run_pg_dump \
  ${HOST_ARGS} --username="${DB_USER}" \
  --format=custom "${DB_NAME}" >"${DB_DUMP}"

# shellcheck disable=SC2086
run_pg_dumpall \
  ${HOST_ARGS} --username="${DB_USER}" \
  --globals-only >"${GLOBALS_DUMP}"

chmod 600 "${DB_DUMP}" "${GLOBALS_DUMP}"

echo "backup complete: ${OUT_DIR}" >&2
printf '%s\n' "${OUT_DIR}"
