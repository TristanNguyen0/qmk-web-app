# QMK Firmware Customizer

Build advanced QMK firmware visually, without installing a toolchain or writing C.

`claude.md` is the operating guide for this project and takes precedence over this file.
Architectural decisions live in [`docs/adr/`](docs/adr/).

## Status

Phases 0 through 4 are complete: a user can select a keyboard, edit a keymap, configure verified
SOCD behaviour, request a build, and download compiled firmware.

| Phase | State |
| --- | --- |
| 0 — foundations and decisions | **Done.** Stack decided ([ADR 0001](docs/adr/0001-technology-stack.md)), QMK pinned, reproducibility spike passing |
| 1 — catalog and read-only UI | **Done.** 3,748 keyboards published, read API, visual layout renderer, unsupported-state UX |
| 2 — saved visual configurations | **Done.** Postgres persistence, revisions, anonymous sessions, layer editor, structured macros, undo/redo, autosave |
| 3 — generation and server builds | **Done.** Queue, isolated worker, artifact storage, build API, quotas, retention, download from the editor |
| 4 — verified SOCD support | **Done.** First-party community module ([ADR 0005](docs/adr/0005-socd-is-a-first-party-community-module.md)), two policies, host-run behavioural tests, real compile matrix |
| 5–6 — hardening, flashing | Not started |

## What works today

```bash
pnpm install
pnpm qmk:fetch --submodules            # fetch + verify the pinned QMK tree (~1.5 GB with submodules)
docker build -t qmk-web-app/qmk-build:0.33.13-1 infra/qmk

pnpm catalog:build                     # discover all 3,748 keyboards (~10 min)

docker compose -f infra/deploy/docker-compose.yml up -d   # Postgres
pnpm dev                               # API on :3001, web UI on :3000
pnpm worker                            # build worker, in a second terminal
```

Open a keyboard, edit its keymap, and press **Build firmware**. A `crkbd/rev1` build takes about
20 seconds end to end.

```bash
node --experimental-strip-types services/worker/scripts/smoke-build.ts catalogs/0.33.13-1
```

The smoke build bypasses the queue and takes a validated configuration straight through generation,
an isolated compile, and artifact collection, then builds it twice and checks the firmware is
byte-identical.

### The web UI

- Search and page through every keyboard in the catalog.
- Open one to see its real layouts drawn from validated QMK position metadata, including
  rotated keys.
- Keys show their **physical position index and matrix coordinates, not keycodes** — nothing is
  bound yet, and inventing legends would misrepresent the hardware.
- Keyboards the catalog cannot offer are reachable and explain *why*, rather than 404ing.
- Click or use arrow keys to inspect a key. Selection is signalled by fill, stroke width, and an
  inset ring, so it never depends on colour alone.
- **Edit a keymap**: layer tabs, a searchable keycode picker, layer actions, mod-taps, structured
  macros, undo/redo (Ctrl/Cmd-Z), and debounced autosave.
- Configurations belong to an anonymous session cookie. Every read and write is authorized by
  owner, so accounts later change only where the owner id comes from.
- Saves use `If-Match`; a concurrent edit produces a visible conflict rather than a silent
  overwrite.
- **SOCD**: on a compile-verified keyboard, enable SOCD resolution, choose a policy, and pick the
  four directional keys. On every other keyboard the panel says *why* it is unavailable instead of
  hiding. Compliance is stated as your responsibility; the product makes no claim.
- **Build and download**: request a build, watch it progress, cancel it, download the firmware with
  its SHA-256, or read the sanitized compiler log when it fails. A build compiles a *stored
  revision*, so the button is disabled until your edits have been saved.

### Builds

A build is a row in `builds` that carries its own queue lease — there is no separate job table
([ADR 0004](docs/adr/0004-the-builds-table-is-the-queue.md)). The lifecycle:

```text
POST /v1/configurations/:id/builds   validate, check quota, insert `queued`  (Idempotency-Key required)
  worker claims it                   UPDATE … FOR UPDATE SKIP LOCKED, lease + heartbeat
  preparing → building → uploading   re-validate, generate, compile in Docker, collect artifact
  succeeded                          artifact row + object, sanitized log
GET  /v1/builds/:id                  poll status
GET  /v1/builds/:id/artifact         authorized download, streamed by the API
GET  /v1/builds/:id/log              authorized, redacted, capped
POST /v1/builds/:id/cancel           cancels a queued build; requests it for a running one
```

Quotas and retention live in `BUILD_LIMITS` (`packages/domain/src/limits.ts`): 2 concurrent builds
and 20 per hour per session, a 2-minute lease, 3 attempts, and 7-day artifact and log retention.
`QueueRunner.maintain()` reclaims leases from dead workers and deletes expired objects.

### SOCD

The pinned QMK revision has **no SOCD implementation in core** — that was checked, not assumed, and
the only reference in the tree is a changelog line pointing at a third-party repository. So SOCD
ships as a first-party community module, `qmkweb/socd_cleaner`
([ADR 0005](docs/adr/0005-socd-is-a-first-party-community-module.md)).

The design keeps phase 3's strongest property: **the generator still emits no C**. A user's policy
choice is encoded in the *keycode*, so it travels as JSON:

```jsonc
{
  "modules": ["qmkweb/socd_cleaner"],
  "layers": [["SOCD_NEUTRAL_W", "SOCD_NEUTRAL_S", "SOCD_NEUTRAL_A", "SOCD_NEUTRAL_D", "..."]]
}
```

| Policy | Holding both directions sends |
| --- | --- |
| `neutral` | neither, until one is released |
| `last_input_priority` | the one pressed most recently |

Resolution applies to the four directional keys on the **base layer only**; those positions behave
normally on other layers. Because QMK runs `process_record_modules` before `process_record_user`,
SOCD resolves before macros, and a macro's own keypresses are never altered.

Three things have to agree for this to be safe — the module manifest, the C dispatch, and the
generator's keycode table — so tests cross-check all three against each other. The resolution logic
itself lives in a header that includes nothing but `stdbool.h`/`stdint.h`, which means `pnpm test`
compiles it with `-Wall -Wextra -Werror` and runs 2,070 behavioural assertions against the exact
code the firmware runs.

Compliance with any tournament or game rule is stated as the user's responsibility. The product
does not make that claim on anyone's behalf.

### Catalog format

A published catalog is a directory, not one file:

```text
catalogs/0.33.13-1/
  index.json              1.3 MB — metadata + one summary per keyboard
  keyboards/NNNN.json     sharded detail, loaded on demand
```

The full tree is ~150 MB of keyboard detail. Sharding keeps API startup fast and its heap small.
Detail lookups resolve through a `detailPath` recorded at publish time, never a path built from
a request.

### Checks

```bash
pnpm typecheck
pnpm test          # 357 tests, no Docker required
pnpm socd:matrix catalogs/0.33.13-1   # real SOCD compiles; needs Docker + the pinned tree
```

`pnpm test` runs the Postgres half of the repository contract suites too, when a database is
reachable; it skips them otherwise, so the default run stays hermetic.

## Pinned QMK revision

| Field | Value |
| --- | --- |
| Tag | `0.33.13` |
| Commit | `332fa30e173e5b0ecc0c70ff166974b6db86525e` |

`infra/qmk/manifest.json` is the single source of truth. Changing it means a new catalog version
and a new build image — never an in-place update.

## Layout

```text
apps/
  api/             Fastify API: catalog reads, configurations, builds, artifact download
  web/             Next.js keyboard picker, visual layout renderer, keymap editor, build panel
packages/
  domain/          typed configuration schema, keycode allowlist, identifier validation,
                   build state machine, product limits, server-side validation
  qmk-catalog/     normalizes extractor output into an immutable, versioned catalog
  qmk-generator/   deterministic keymap generation (JSON only — no C, no Make)
  qmk-sandbox/     the BuildSandbox contract and its hardened Docker implementation
  qmk-socd-module/ the first-party SOCD Cleaner QMK community module (static C) and the
                   digest-verified code that places it in a build workspace
  build-queue/     BuildRepository + BuildQueue contracts, in-memory and Postgres stores
  artifact-store/  ArtifactStore contract, key derivation, filesystem and in-memory stores
  qmk-fixtures/    small fixtures captured from real extractions of the pinned tree
infra/deploy/      docker-compose for local Postgres
services/
  worker/          queue loop, generation + compile, artifact identification, log redaction,
                   lease recovery and retention
infra/qmk/         pinned manifest, build image, catalog extractor, entrypoint
docs/adr/          architecture decision records
```

## Security properties currently enforced

Each is verified by a test or by the smoke build, not just intended:

- The QMK tree is mounted **read-only** and is never written to — verified after every build.
- Builds run with `--network=none`, `--read-only`, `--cap-drop=ALL`, `no-new-privileges`, an
  unprivileged user, and CPU/memory/pid/wall-clock caps.
- No shell evaluation anywhere; every command is an argument vector.
- Generation emits **only** `qmk.json` and `keymap.json`. C, Make, and headers are refused —
  including for SOCD, whose configuration travels as keycodes rather than generated defines
  ([ADR 0005](docs/adr/0005-socd-is-a-first-party-community-module.md)).
- The SOCD module's C is verified against SHA-256 digests pinned at review time before it is
  copied into a workspace; an unreviewed edit fails the build.
- Keyboard ids are rejected unless they match the catalog, so user text never becomes a path.
- The generated keymap directory name is derived from the build id, never from a user name.
- Generated writes are contained: traversal, NULs, absolute paths, and symlinked path components
  are all rejected.
- Artifacts are accepted only at the one expected path; stray or extra firmware files fail the build.
- Logs are redacted (paths, signed URLs, credentials) and capped before a user sees them.
- Configurations are scoped by owner **in the SQL WHERE clause**, so another session's row is
  never loaded. Cross-session access returns 404, not 403, so ids cannot be probed.
- Session cookies are HMAC-signed, `HttpOnly`, `SameSite=Lax`; a tampered cookie starts a fresh
  session rather than being honoured.
- Clients cannot set `id`, `ownerId`, `revision`, or `schemaVersion` — the server assigns them.
- Updates require `If-Match` and are applied under `SELECT … FOR UPDATE`, so concurrent writers
  cannot both win.
- Builds, logs, and artifacts are owner-scoped the same way; a cross-session request gets 404.
- Storage keys are derived from a build id and never returned to a client; downloads are streamed
  by the API, so there is no URL to share or replay.
- A build request needs an `Idempotency-Key`, and the key is a unique index — a retried request
  cannot start a second compile.
- Every worker write is conditional on holding the lease *and* on the status it is leaving, so a
  worker whose lease expired cannot finish a build another worker has taken over.
- A cancelled build's firmware is discarded even if the compile had already succeeded; its log is
  kept.
- Per-session quotas cap concurrent and hourly builds; both return `BUILD_QUEUE_LIMITED`.
- The worker re-validates the stored configuration against the catalog rather than trusting that
  the API validated it before queueing.
- The worker has its own database role with no access to `configurations` at all
  (`apps/api/migrations/003_worker_role.sql`).

## Known gaps

- **SOCD is enabled for exactly one keyboard.** `crkbd/rev1` is the only entry in
  `SOCD_VERIFIED_KEYBOARDS`, because it is the only one put through `pnpm socd:matrix`. Every other
  keyboard reports SOCD unavailable, with a reason. Widening that list means running the matrix, not
  editing the set.
- SOCD offers fixed opposing pairs (`W/S`, `A/D`, `UP/DOWN`, `LEFT/RIGHT`) and two policies.
  Arbitrary key pairs and per-pair policies are not offered.
- Only `crkbd/rev1` has been through a real compile; the curated smoke matrix does not exist yet.
  3,743 keyboards are *catalogued*, which is a weaker claim than *known to build*.
- No real authentication: sessions are anonymous cookies, so clearing cookies loses your work.
- Artifact storage is a shared directory. The `ArtifactStore` seam is in place, but S3 is not
  implemented, so the API and the worker must share a filesystem ([ADR 0004](docs/adr/0004-the-builds-table-is-the-queue.md)).
- The worker polls once a second per idle worker; there is no `LISTEN/NOTIFY` yet.
- No global build concurrency limit or IP-based rate limiting — only per-session quotas.
- No end-to-end browser tests yet; the UI is covered by API tests and pure geometry unit tests.
