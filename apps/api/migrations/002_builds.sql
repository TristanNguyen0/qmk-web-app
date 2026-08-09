-- Builds, their queue, and the artifacts they produce.
--
-- claude.md § Deterministic generation and build workflow. Three properties are
-- structural here rather than enforced by convention in application code:
--
--  1. **A build cites an immutable revision.** The composite foreign key into
--     `configuration_revisions` means a build can only ever name a revision that was
--     actually stored, and that revision cannot be deleted while the build cites it.
--  2. **The queue is the `builds` table.** ADR 0004: a separate queue store would let
--     a job exist without a build row, or a build row sit `queued` with no job. One
--     table with a lease makes those states unrepresentable.
--  3. **Idempotency is a unique index**, not a read-then-write in the API. Two
--     concurrent submissions of the same key cannot both create a build.

CREATE TABLE IF NOT EXISTS builds (
    id                     UUID PRIMARY KEY,

    configuration_id       UUID        NOT NULL,
    -- The exact revision built. Never "current": the configuration may move on while
    -- this build is queued, and the artifact must describe what was compiled.
    configuration_revision INTEGER     NOT NULL,

    -- Denormalised from the configuration so authorization never needs a join, and so
    -- ownership survives as an audit fact even if the configuration is deleted.
    owner_id               UUID        NOT NULL,

    -- Reproducibility triple (claude.md rule 6 and § Build isolation).
    catalog_version        TEXT        NOT NULL,
    qmk_commit             CHAR(40)    NOT NULL,
    generator_version      TEXT        NOT NULL,
    build_image_ref        TEXT        NOT NULL,
    build_image_digest     TEXT,

    status                 TEXT        NOT NULL,

    -- Client-supplied. Makes build creation idempotent (claude.md § API/interface
    -- expectations).
    idempotency_key        TEXT        NOT NULL,

    requested_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at             TIMESTAMPTZ,
    completed_at           TIMESTAMPTZ,
    attempt_count          INTEGER     NOT NULL DEFAULT 0,

    -- Queue lease. A worker claims a build by writing these; a crashed worker's lease
    -- expires and the build becomes claimable again rather than being stuck forever.
    claimed_by             TEXT,
    claimed_at             TIMESTAMPTZ,
    lease_expires_at       TIMESTAMPTZ,

    -- Cancellation is a request, not a state change: a running worker observes it at
    -- its next checkpoint. Only the worker (or the queue, while still `queued`) may
    -- move the build to `cancelled`, so the state machine stays authoritative.
    cancel_requested       BOOLEAN     NOT NULL DEFAULT FALSE,

    artifact_id            UUID,
    output_format          TEXT,
    -- Storage key of the sanitized log. Internal; never returned to a client.
    log_reference          TEXT,
    failure_code           TEXT,

    CONSTRAINT builds_status_known CHECK (status IN (
        'queued', 'preparing', 'building', 'uploading',
        'succeeded', 'failed', 'cancelled', 'expired'
    )),
    CONSTRAINT builds_failure_code_known CHECK (failure_code IS NULL OR failure_code IN (
        'COMPILE_FAILED', 'TIMEOUT', 'RESOURCE_LIMIT', 'GENERATION_FAILED',
        'ARTIFACT_NOT_PRODUCED', 'ARTIFACT_REJECTED', 'SANDBOX_ERROR', 'CANCELLED'
    )),
    CONSTRAINT builds_attempt_count_positive CHECK (attempt_count >= 0),

    -- Deleting a configuration deletes its builds; an artifact row goes with them.
    CONSTRAINT builds_configuration_fk FOREIGN KEY (configuration_id)
        REFERENCES configurations (id) ON DELETE CASCADE,
    -- The revision must exist, and cannot be removed out from under a build.
    CONSTRAINT builds_revision_fk FOREIGN KEY (configuration_id, configuration_revision)
        REFERENCES configuration_revisions (configuration_id, revision) ON DELETE CASCADE
);

-- Idempotency, scoped per owner so one session's key cannot collide with another's —
-- or be used to probe whether another session submitted a given key.
CREATE UNIQUE INDEX IF NOT EXISTS builds_owner_idempotency_key
    ON builds (owner_id, idempotency_key);

-- The claim query: oldest queued build first. Partial, so the index stays the size of
-- the backlog rather than the size of all history.
CREATE INDEX IF NOT EXISTS builds_queue_idx
    ON builds (requested_at)
    WHERE status = 'queued';

-- Reclaiming builds whose worker died.
CREATE INDEX IF NOT EXISTS builds_lease_idx
    ON builds (lease_expires_at)
    WHERE status IN ('preparing', 'building', 'uploading');

-- Listing a configuration's builds, and counting a session's in-flight builds for the
-- per-owner concurrency quota.
CREATE INDEX IF NOT EXISTS builds_configuration_idx
    ON builds (configuration_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS builds_owner_status_idx
    ON builds (owner_id, status);

CREATE TABLE IF NOT EXISTS artifacts (
    id                UUID PRIMARY KEY,
    -- One artifact per build. A second row would mean two firmwares claim to be the
    -- output of one compile, which § Deterministic generation step 7 forbids.
    build_id          UUID        NOT NULL UNIQUE REFERENCES builds (id) ON DELETE CASCADE,

    -- Opaque, server-derived storage key. claude.md § Error handling: "Never expose a
    -- direct storage key or worker filesystem path."
    storage_key       TEXT        NOT NULL,
    original_filename TEXT        NOT NULL,
    byte_size         BIGINT      NOT NULL,
    sha256            CHAR(64)    NOT NULL,
    content_type      TEXT        NOT NULL,
    -- Short retention by default (claude.md § Build isolation and security).
    expires_at        TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT artifacts_byte_size_positive CHECK (byte_size > 0)
);

-- The reaper scans by expiry.
CREATE INDEX IF NOT EXISTS artifacts_expires_at_idx ON artifacts (expires_at);

-- Added after `artifacts` exists. SET NULL rather than CASCADE: reaping an expired
-- artifact must not delete the build record that explains what happened.
ALTER TABLE builds
    DROP CONSTRAINT IF EXISTS builds_artifact_fk;
ALTER TABLE builds
    ADD CONSTRAINT builds_artifact_fk FOREIGN KEY (artifact_id)
        REFERENCES artifacts (id) ON DELETE SET NULL;
