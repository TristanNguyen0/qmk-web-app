# Runbook: backup, restore, and answering "what did retention delete?"

This runbook covers three operator questions: what is protected against loss, how to
prove a backup actually restores, and how to reconstruct what a retention sweep
deleted after the fact. It is a runbook, not a reference for the scripts' flags — read
`infra/deploy/backup.sh` and `infra/deploy/restore-drill.sh` themselves for those.

## What is backed up, and what deliberately is not

`infra/deploy/backup.sh` backs up the Postgres application database: `configurations`,
`configuration_revisions`, `builds`, `artifacts`, and every other object in it, via
`pg_dump -Fc`. It also backs up the cluster's roles and grants via
`pg_dumpall --globals-only`, because a single-database custom-format dump does not
carry roles — restoring from the database dump alone into a fresh cluster would
silently lose the `qwa_worker` role and its narrow grant list
(`apps/api/migrations/003_worker_role.sql`), which is a security property, not a
convenience.

**Firmware artifacts and build logs are deliberately not backed up.** Two reasons hold
together:

1. They are short-lived by product policy. `BUILD_LIMITS.artifactRetentionMs` and
   `BUILD_LIMITS.logRetentionMs` (`packages/domain/src/limits.ts`) are both seven days;
   nothing in the product promises them for longer than that, backup or no backup.
2. They are deterministically reproducible. Every build row already carries its
   `catalogVersion`, `qmkCommit`, `generatorVersion` and `buildImageDigest` — the
   complete reproducibility triple (and image) claude.md rule 6 requires. Given a
   configuration revision plus those four identifiers, re-running the build produces
   the same firmware. Backing the blob up would duplicate a rebuild's job without
   buying a durability guarantee a rebuild does not already provide.

If that reasoning ever stops holding — if a build's exact image digest becomes
unavailable, for instance — the right fix is recording whatever new fact restores
reproducibility, not switching artifacts to a backed-up store.

## Running a backup

```sh
infra/deploy/backup.sh var/backups
```

Produces `var/backups/<UTC timestamp>/database.dump` (custom-format `pg_dump`) and
`var/backups/<UTC timestamp>/globals.sql` (`pg_dumpall --globals-only`). The directory
is created `chmod 700` and both files `chmod 600`: **a dump contains every session's
configurations**, so treat the output directory like the database itself. `var/` is
gitignored — a dump must never be committed.

Connection details come from `QWA_DATABASE_URL`, or `QWA_DB_HOST` / `QWA_DB_PORT` /
`QWA_DB_USER` / `QWA_DB_NAME` / `QWA_DB_PASSWORD` individually, defaulting to this
project's `infra/deploy/docker-compose.yml` development credentials.

The script prefers to run `pg_dump`/`pg_dumpall` **inside** the compose `postgres`
container when that service is running, rather than a locally installed client. This
is not a convenience — a client whose major version differs from the server's is a
real compatibility hazard, not a cosmetic one: a newer `pg_restore` issues `SET`
commands for GUCs the older server does not recognise (`transaction_timeout`, added in
PostgreSQL 17) and the restore breaks. The container's client is guaranteed to match
this project's pinned Postgres 16 server exactly. A local client is used only when the
compose service is not running, e.g. a deployment where the installed `pg_dump` is
already pinned to the server's version directly.

## Running the restore drill

```sh
infra/deploy/restore-drill.sh var/backups/<the timestamp directory backup.sh printed>
```

Creates a scratch database named `qwa_restore_drill_<UTC timestamp>`, restores
`database.dump` into it, then compares `count(*)` for `configurations`,
`configuration_revisions`, `builds` and `artifacts` between the source database and
the scratch one. It prints a `parity: <table> source=<n> restored=<n>` line per table
and exits 0 only if every table matched; a mismatch prints
`MISMATCH: <table> source=<n> restored=<n>` and the script exits non-zero. The scratch
database is dropped on the way out **even on failure**, via a trap — it is never left
behind for a later drill to trip over.

The script never writes to the source (live) database: every query against it is a
read-only `SELECT count(*)`. For the same version-compatibility reason as `backup.sh`,
`restore-drill.sh` also prefers to run `pg_restore` inside the compose `postgres`
container when it is running, streaming the dump file in over stdin since the
container has no access to the host filesystem.

**How often to run it, and what "passing" means.** Run the drill immediately after
every backup — a backup that has never been restored is a hope, not a guarantee. In an
automated deployment, wire it as the last step of the backup job so a broken dump
fails the job loudly instead of being discovered the day it is needed. "Passing" means
exit 0: all four tables' row counts matched. A non-zero exit is not "close enough" —
investigate before trusting the backup that failed it.

### The half a script cannot do: prove a rebuild actually works

Row-count parity proves the *rows* survive a restore. It does not prove a worker
pointed at the restored database can still produce firmware from one of them — that
requires an actual compile. Do this by hand periodically (the compile is real work;
automating it is a reasonable future addition, not a script gap in this one):

```sh
# 1. Take a backup and restore it into a database you keep around for this check
#    (not the drill's dbname — that one gets dropped automatically).
infra/deploy/backup.sh var/backups
LATEST=$(ls -1d var/backups/*/ | tail -1)

docker compose -f infra/deploy/docker-compose.yml exec -T postgres \
  createdb -U qwa qwa_rebuild_check
docker compose -f infra/deploy/docker-compose.yml exec -T \
  -e PGPASSWORD=qwa_dev_password postgres \
  pg_restore --username=qwa --dbname=qwa_rebuild_check --no-owner --no-privileges \
  < "${LATEST}database.dump"

# 2. Find a configuration revision to rebuild from, and queue a fresh build that
#    cites it. (Adjust the ids — this reuses an existing, already-validated
#    configuration/revision pair rather than fabricating one.)
PGPASSWORD=qwa_dev_password psql -h 127.0.0.1 -p 5433 -U qwa -d qwa_rebuild_check -c "
  INSERT INTO builds (
    id, configuration_id, configuration_revision, owner_id,
    catalog_version, qmk_commit, generator_version, build_image_ref,
    status, idempotency_key, requested_at
  )
  SELECT gen_random_uuid(), c.id, c.revision, c.owner_id,
         c.catalog_version, c.qmk_commit, c.generator_version, 'qmk-web-app/qmk-build:0.33.13-1',
         'queued', 'rebuild-check-' || now()::text, now()
  FROM configurations c
  ORDER BY c.updated_at DESC
  LIMIT 1;
"

# 3. Point a worker at the restored database and let it claim the build.
QWA_DATABASE_URL='postgres://qwa:qwa_dev_password@127.0.0.1:5433/qwa_rebuild_check' \
  QWA_ARTIFACT_DIR=var/rebuild-check-artifacts \
  pnpm worker

# 4. Confirm firmware is produced: watch the worker's structured logs for a
#    "build succeeded" event, then check the artifact landed:
ls var/rebuild-check-artifacts/builds/

# 5. Clean up.
docker compose -f infra/deploy/docker-compose.yml exec -T postgres \
  dropdb -U qwa qwa_rebuild_check
rm -rf var/rebuild-check-artifacts
```

A successful run of this checklist is the actual claim "a restore has been performed,
not merely documented" rests on — the automated drill alone only proves the rows
survived.

## Answering "what did retention delete, and when?"

`QueueRunner.maintain()` (`services/worker/src/queue-runner.ts`) emits a structured
log event whenever a sweep reaps at least one object or expires at least one build.
The worker's `log()` function (`services/worker/src/main.ts`) prints every event as one
line of JSON to stdout — `{"level":"info","worker":"<id>","time":"<iso>", ...event}` —
so "what did retention delete" is answered by grepping the worker's log sink for
`"message":"retention"` and reading the `retention` field of each matching line. Its
shape:

```json
{
  "deletedAt": "2026-08-20T03:14:07.000Z",
  "buildsExpired": 2,
  "objects": [
    { "buildId": "…", "kind": "artifact", "outcome": "deleted" },
    { "buildId": "…", "kind": "log", "outcome": "already-absent" }
  ]
}
```

`buildsExpired` is how many builds transitioned to `expired` in that sweep.
`objects` has one entry per reaped storage object, naming the **build id** the object
belonged to — never the storage key itself, which is the one value this application
promises never to expose. `outcome` is `deleted`, `already-absent` (the object store
had nothing at that key — not an error), or `failed` (the delete threw; the database
row was still reaped, and a separate `warn`-level `failed to delete expired object`
event was also logged for it). The record's presence is conditioned on what `reap()`
returned from the database, not on how many blob deletes actually succeeded — a sweep
that deletes rows and then fails every blob delete still produces one of these events,
because that is exactly the case an operator must be able to see.

If a build id from a `retention` event needs its storage key back (to check whether an
object still exists at the path, for instance), derive it with
`artifactKey(buildId)` / `logKey(buildId)` from `@qmk-web-app/artifact-store` — never
reconstruct it by hand.

### Revisit trigger: when to add a `retention_events` table

This is deliberately a log event, not a database table, because
`apps/api/migrations/003_worker_role.sql` gives the worker's `qwa_worker` role no
`INSERT` anywhere except `artifacts`, and the retention reaper already runs with owner
credentials — a `retention_events` table would need a new grant on a role whose entire
design is a short grant list, for data the log sink already carries.

**Add the table the moment an operator cannot answer "what did retention delete last
month" from the log sink** — which will be true as soon as the sink's own retention
window is shorter than the horizon of the question being asked. That is a deployment
fact (how long the log sink keeps lines), not a code fact, which is why it belongs
here rather than in the source.
