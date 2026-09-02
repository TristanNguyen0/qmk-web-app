# ADR 0004 — The `builds` table is the queue, and artifacts live behind a store interface

- **Status:** Accepted
- **Date:** 2026-08-09

## Context

[ADR 0001](0001-technology-stack.md) chose "a database-backed queue (`FOR UPDATE SKIP LOCKED`)" and
"S3-compatible object storage (MinIO in development)". Phase 3 had to turn both into something
concrete, and two questions were left open by that decision:

1. Does a job live in its own table, separate from the `builds` record the API serves?
2. Is S3 wired up now, when the API and the worker still run on one machine?

`claude.md` § Deterministic generation requires that "state transitions must be atomic and
auditable", and § Error handling forbids ever presenting a compile failure as flashable firmware.
Both constraints are about a build having exactly one truth at any instant.

## Decision

### The queue is the `builds` table

There is no separate jobs table. A build row carries its own lease:

```text
status            queued | preparing | building | uploading | succeeded | failed | cancelled | expired
claimed_by        worker id holding the lease
lease_expires_at  when an un-heartbeated claim becomes reclaimable
cancel_requested  a request, observed by the worker at a checkpoint
```

A worker claims with a single `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, and
**every** subsequent write is conditional on `claimed_by = $workerId` *and* the status the worker
believes it is leaving. A worker whose lease expired therefore cannot complete a build another
worker has since picked up: its write matches zero rows and it abandons the build.

The alternative — a queue table beside the build record — makes two states representable that
cannot be true: a job with no build, and a `queued` build with no job. Neither can be expressed
here, so neither needs handling.

Three consequences follow, all deliberate:

- **Cancellation is a flag, not a status.** Only the queue (while `queued`) or the worker holding
  the lease may write `cancelled`. The API sets `cancel_requested` and the worker observes it at a
  checkpoint. This is what stops a cancel racing a completing build into two different terminal
  states.
- **`preparing|building|uploading → queued` is a legal transition** ([`packages/domain/src/build.ts`](../../packages/domain/src/build.ts)).
  A lost lease returns the build to the queue rather than stranding it. Generation is
  deterministic and the workspace is destroyed per attempt, so a re-run is not a partial resume.
  After `BUILD_LIMITS.maxBuildAttempts` the build fails instead.
- **Idempotency is a unique index** on `(owner_id, idempotency_key)`, not a read-then-write in the
  API, which would race with itself.

### Artifacts go through an `ArtifactStore` interface, backed by the filesystem today

`packages/artifact-store` defines `put`/`get`/`delete` over opaque keys, mirroring how
`BuildSandbox` isolates the container runtime. The filesystem implementation is what runs now; an
S3 implementation is a new class behind the same interface and nothing above it changes.

Wiring MinIO in immediately was rejected: with the API and the worker on one host, S3 would add a
dependency, credentials, and a failure mode without buying a property the application can currently
use. The seam is what ADR 0001 actually needed; the backend is a deployment concern. The point at
which S3 becomes necessary is precise and easy to notice — when the API and the worker no longer
share a filesystem.

Two rules hold regardless of backend:

- **Keys are derived from a build id by `keys.ts` and nowhere else.** No user-supplied text ever
  reaches a path (`claude.md` rule 4), and there is exactly one function to audit.
- **A key never leaves the server.** A client sees a build id and a filename; the API reads the
  object and streams it (`claude.md` § Error handling: "Never expose a direct storage key").

### The worker gets its own database role

`migrations/003_worker_role.sql` creates `qwa_worker` with `SELECT, UPDATE` on `builds`,
`SELECT, INSERT` on `artifacts`, and `SELECT` on `configuration_revisions` — and deliberately
**nothing on `configurations`**. The worker is handed ids and reads the immutable revision document;
it never needs to know who owns what. This makes the boundary in `claude.md` § Recommended project
boundaries ("must not access public application database with broad credentials") a grant list
rather than a convention.

The migration reports and continues if the migrating user lacks `CREATEROLE`, since managed
Postgres often withholds it; the deployment is then responsible for provisioning the role from the
same file.

## Consequences

- One `pnpm test` run exercises the queue's real concurrency semantics against Postgres
  (`apps/api/src/builds/store-contract.test.ts`), and skips them when no database is reachable.
- Retention is a worker responsibility: `QueueRunner.maintain()` reclaims dead leases, expires
  artifacts, and deletes the corresponding objects. Database rows are removed **before** their
  blobs, so a failure leaves an orphaned object rather than a build promising a download that no
  longer exists.
- A second worker process is `pnpm worker` again; no coordination beyond the database is required.
- Polling costs one query per worker per idle second. If that becomes material, `LISTEN/NOTIFY`
  fits behind `BuildQueue.claim` without changing anything else.
