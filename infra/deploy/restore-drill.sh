#!/bin/sh
# Restores a backup.sh output into a scratch database and proves row-count
# parity for the four tables an operator actually cares about, then drops the
# scratch database — even on failure.
#
# This script MUST NEVER write to the source (live) database. It creates one
# scratch database, restores into it, reads `count(*)` from both the source
# and the scratch database, and drops the scratch database. Every query against
# the source is a read-only `SELECT count(*)`; nothing here ever issues a write
# against the database named by the connection defaults / QWA_DATABASE_URL.
#
# Usage: infra/deploy/restore-drill.sh <backup-directory>
#
# <backup-directory> is one timestamped directory produced by backup.sh,
# containing database.dump (and globals.sql, which this drill does not need —
# the scratch database is created inside the existing cluster, which already
# has the right roles).
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)

BACKUP_DIR="${1:?usage: restore-drill.sh <backup-directory>}"
DB_DUMP="${BACKUP_DIR}/database.dump"

if [ ! -f "${DB_DUMP}" ]; then
  echo "no database.dump found in ${BACKUP_DIR}" >&2
  exit 1
fi

# --- connection details, matching backup.sh -----------------------------
QWA_DATABASE_URL="${QWA_DATABASE_URL:-}"
DB_HOST="${QWA_DB_HOST:-127.0.0.1}"
DB_PORT="${QWA_DB_PORT:-5433}"
DB_USER="${QWA_DB_USER:-qwa}"
DB_NAME="${QWA_DB_NAME:-qwa}"
DB_PASSWORD="${QWA_DB_PASSWORD:-qwa_dev_password}"

if [ -n "${QWA_DATABASE_URL}" ]; then
  DB_USER=$(printf '%s' "${QWA_DATABASE_URL}" | sed -E 's#^[a-zA-Z]+://([^:]+):.*#\1#')
  DB_PASSWORD=$(printf '%s' "${QWA_DATABASE_URL}" | sed -E 's#^[a-zA-Z]+://[^:]+:([^@]+)@.*#\1#')
  DB_HOST=$(printf '%s' "${QWA_DATABASE_URL}" | sed -E 's#^[a-zA-Z]+://[^@]+@([^:/]+).*#\1#')
  DB_PORT=$(printf '%s' "${QWA_DATABASE_URL}" | sed -E 's#^[a-zA-Z]+://[^@]+@[^:/]+:([0-9]+).*#\1#')
  DB_NAME=$(printf '%s' "${QWA_DATABASE_URL}" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')
fi

export PGPASSWORD="${DB_PASSWORD}"

PSQL="psql --host=${DB_HOST} --port=${DB_PORT} --username=${DB_USER} -v ON_ERROR_STOP=1"
# The maintenance database used to CREATE/DROP the scratch database. Never the
# application database itself — you cannot drop the database you are connected to.
ADMIN_DB="postgres"

# pg_restore, specifically, must match the server's major version: a newer
# pg_restore (e.g. host-installed 17 against this project's pinned Postgres 16)
# unconditionally issues `SET transaction_timeout = 0` while restoring, a GUC
# the older server rejects outright — independent of what pg_dump produced the
# archive. Route it through the compose postgres container, whose pg_restore is
# guaranteed to match the server, when that service is running; fall back to a
# local pg_restore otherwise (e.g. a deployment with a version-pinned client).
# psql has no such issue, so it is used locally either way.
COMPOSE_FILE="${REPO_ROOT}/infra/deploy/docker-compose.yml"
if command -v docker >/dev/null 2>&1 \
  && docker compose -f "${COMPOSE_FILE}" ps --status running --services 2>/dev/null | grep -qx postgres; then
  echo "using pg_restore inside the compose postgres container (exact server version match)" >&2
  run_pg_restore() {
    # The dump lives on the host, not inside the container, so it is piped in via
    # stdin rather than passed as a container-side path.
    docker compose -f "${COMPOSE_FILE}" exec -T -e PGPASSWORD="${DB_PASSWORD}" postgres \
      pg_restore --username="${DB_USER}" --dbname="$1" --no-owner --no-privileges <"${DB_DUMP}"
  }
else
  run_pg_restore() {
    pg_restore --host="${DB_HOST}" --port="${DB_PORT}" --username="${DB_USER}" \
      --dbname="$1" --no-owner --no-privileges "${DB_DUMP}"
  }
fi

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
SCRATCH_DB="qwa_restore_drill_${TIMESTAMP}"

cleanup() {
  # A drill that leaves debris will stop being run. Best-effort: this runs even
  # when an earlier step already failed, so failures here must not mask the
  # original exit status.
  ${PSQL} -d "${ADMIN_DB}" -v ON_ERROR_STOP=0 \
    -c "DROP DATABASE IF EXISTS \"${SCRATCH_DB}\" WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "creating scratch database ${SCRATCH_DB}" >&2
${PSQL} -d "${ADMIN_DB}" -c "CREATE DATABASE \"${SCRATCH_DB}\""

echo "restoring ${DB_DUMP} into ${SCRATCH_DB}" >&2
run_pg_restore "${SCRATCH_DB}"

MISMATCH=0
for TABLE in configurations configuration_revisions builds artifacts; do
  # Read-only against the source: a single SELECT count(*), nothing else.
  SOURCE_COUNT=$(${PSQL} -d "${DB_NAME}" -tAc "SELECT count(*) FROM ${TABLE}")
  RESTORED_COUNT=$(${PSQL} -d "${SCRATCH_DB}" -tAc "SELECT count(*) FROM ${TABLE}")
  if [ "${SOURCE_COUNT}" != "${RESTORED_COUNT}" ]; then
    echo "MISMATCH: ${TABLE} source=${SOURCE_COUNT} restored=${RESTORED_COUNT}" >&2
    MISMATCH=1
  else
    echo "parity: ${TABLE} source=${SOURCE_COUNT} restored=${RESTORED_COUNT}"
  fi
done

if [ "${MISMATCH}" -ne 0 ]; then
  echo "restore drill FAILED: row-count parity did not hold for every table" >&2
  exit 1
fi

echo "restore drill passed: ${DB_DUMP} restores with row-count parity on all four tables" >&2
