-- A deliberately narrow database role for the build worker.
--
-- claude.md § Recommended project boundaries: the build worker "must not access
-- public application database with broad credentials". The worker needs exactly four
-- things and nothing else:
--
--   * claim and update rows in `builds` (the queue lease and terminal states),
--   * insert the one `artifacts` row for a build it owns,
--   * read the immutable `configuration_revisions` document it was told to build,
--   * nothing at all from `configurations`.
--
-- The last point is the one worth being strict about: the worker never needs a
-- configuration's name, owner, or draft state, and the job payload deliberately
-- carries only ids (§ Deterministic generation, step 3). Withholding SELECT on
-- `configurations` means a compromised worker cannot enumerate who owns what.
--
-- The role is created NOLOGIN and carries no password. A deployment grants it to a
-- login role that only the worker uses:
--
--   CREATE ROLE qwa_worker_login LOGIN PASSWORD '…';
--   GRANT qwa_worker TO qwa_worker_login;
--
-- In local development the worker runs as the owner role, so this migration is
-- preparation rather than enforcement. It is applied here so the grant list is
-- reviewed alongside every schema change instead of drifting in a deploy script.
--
-- A database user without CREATEROLE (common on managed Postgres) cannot run this.
-- That is not fatal to the application, so the block reports and continues rather
-- than aborting startup — the deployment is then responsible for provisioning the
-- role from this file.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qwa_worker') THEN
        CREATE ROLE qwa_worker NOLOGIN;
    END IF;

    -- No INSERT: a build row is created only by the API, in response to an
    -- authenticated, quota-checked request. No DELETE: build history is auditable.
    EXECUTE 'GRANT SELECT, UPDATE ON builds TO qwa_worker';

    -- No UPDATE or DELETE: an artifact row is written once and thereafter only read,
    -- or removed by the retention reaper running with owner credentials.
    EXECUTE 'GRANT SELECT, INSERT ON artifacts TO qwa_worker';

    -- Read-only, and only the append-only revision log.
    EXECUTE 'GRANT SELECT ON configuration_revisions TO qwa_worker';

EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE
            'skipping qwa_worker role: the migrating user lacks CREATEROLE. '
            'Provision the role and grants from migrations/003_worker_role.sql manually.';
END
$$;
