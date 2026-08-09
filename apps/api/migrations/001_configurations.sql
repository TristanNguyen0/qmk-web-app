-- Configurations and their immutable revisions.
--
-- claude.md § Configuration model: "Store the original validated JSON and a normalized
-- representation". § API/interface expectations: "Require optimistic concurrency
-- (revision or ETag) on configuration updates to prevent silent overwrites."
--
-- Shape: `configurations` holds current state and the head revision number.
-- `configuration_revisions` is an append-only log — a build references an exact
-- revision, so revisions must never be mutated or deleted while a build cites them.

CREATE TABLE IF NOT EXISTS configurations (
    id                UUID PRIMARY KEY,
    -- Null only in deliberate anonymous mode. Anonymous sessions still set this to
    -- the session's stable id, so ownership checks work identically either way.
    owner_id          UUID,
    schema_version    INTEGER     NOT NULL,

    catalog_version   TEXT        NOT NULL,
    qmk_commit        CHAR(40)    NOT NULL,
    keyboard_id       TEXT        NOT NULL,
    layout_id         TEXT        NOT NULL,

    name              TEXT        NOT NULL,
    -- Head revision. Bumped on every accepted write; the client must echo the value
    -- it read, which is what makes concurrent overwrites detectable.
    revision          INTEGER     NOT NULL,
    -- A draft has not passed full server validation and must not be buildable
    -- (claude.md § Visual keymap editor: "mark drafts explicitly as incomplete and
    -- block builds until server validation passes").
    is_draft          BOOLEAN     NOT NULL DEFAULT TRUE,

    -- The validated configuration document, exactly as accepted.
    document          JSONB       NOT NULL,
    generator_version TEXT        NOT NULL,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT configurations_revision_positive CHECK (revision >= 0)
);

-- Every list query is scoped by owner, so this is the index that matters.
CREATE INDEX IF NOT EXISTS configurations_owner_updated_idx
    ON configurations (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS configuration_revisions (
    configuration_id  UUID        NOT NULL REFERENCES configurations (id) ON DELETE CASCADE,
    revision          INTEGER     NOT NULL,
    document          JSONB       NOT NULL,
    is_draft          BOOLEAN     NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (configuration_id, revision)
);
