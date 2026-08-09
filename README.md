# QMK Firmware Customizer

Build advanced QMK firmware visually, without installing a toolchain or writing C.

`claude.md` is the operating guide for this project and takes precedence over this file.
Architectural decisions live in [`docs/adr/`](docs/adr/).

## Status

Phases 0, 1 and 2 are complete. Phase 3 works end to end via CLI but has no queue, storage, or build API.

| Phase | State |
| --- | --- |
| 0 — foundations and decisions | **Done.** Stack decided ([ADR 0001](docs/adr/0001-technology-stack.md)), QMK pinned, reproducibility spike passing |
| 1 — catalog and read-only UI | **Done.** 3,748 keyboards published, read API, visual layout renderer, unsupported-state UX |
| 2 — saved visual configurations | **Done.** Postgres persistence, revisions, anonymous sessions, layer editor, structured macros, undo/redo, autosave |
| 3 — generation and server builds | Generation, isolated compile, artifact collection done; **no queue or storage yet** |
| 4 — verified SOCD support | Not started. Schema exists; generation deliberately refuses it |
| 5–6 — hardening, flashing | Not started |

## What works today

```bash
pnpm install
pnpm qmk:fetch --submodules            # fetch + verify the pinned QMK tree (~1.5 GB with submodules)
docker build -t qmk-web-app/qmk-build:0.33.13-1 infra/qmk

pnpm catalog:build                     # discover all 3,748 keyboards (~10 min)

node --experimental-strip-types services/worker/scripts/smoke-build.ts catalogs/0.33.13-1

docker compose -f infra/deploy/docker-compose.yml up -d   # Postgres
pnpm dev                               # API on :3001, web UI on :3000
```

The smoke build takes a validated configuration through generation, an isolated compile, and
artifact collection, then builds it twice and checks the firmware is byte-identical.

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
pnpm test          # 122 tests, no Docker required
```

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
  api/             catalog read API (Fastify): keyboards, layouts, keycodes, SOCD capabilities
  web/             Next.js keyboard picker + visual layout renderer
packages/
  domain/          typed configuration schema, keycode allowlist, identifier validation,
                   build state machine, server-side validation
  qmk-catalog/     normalizes extractor output into an immutable, versioned catalog
  qmk-generator/   deterministic keymap generation (JSON only — no C, no Make)
  qmk-sandbox/     the BuildSandbox contract and its hardened Docker implementation
  qmk-fixtures/    small fixtures captured from real extractions of the pinned tree
infra/deploy/      docker-compose for local Postgres
services/
  worker/          generation + compile + artifact identification + log redaction
infra/qmk/         pinned manifest, build image, catalog extractor, entrypoint
docs/adr/          architecture decision records
```

Not yet built: the job queue, artifact storage, and the build API.

## Security properties currently enforced

Each is verified by a test or by the smoke build, not just intended:

- The QMK tree is mounted **read-only** and is never written to — verified after every build.
- Builds run with `--network=none`, `--read-only`, `--cap-drop=ALL`, `no-new-privileges`, an
  unprivileged user, and CPU/memory/pid/wall-clock caps.
- No shell evaluation anywhere; every command is an argument vector.
- Generation emits **only** `qmk.json` and `keymap.json`. C, Make, and headers are refused.
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

## Known gaps

- **SOCD is not implemented.** The schema models it, and both validation and generation refuse to
  enable it, per `claude.md` rule 9 — the pinned revision's SOCD interface has not been verified yet.
- Only `crkbd/rev1` has been through a real compile; the curated smoke matrix does not exist yet.
  3,743 keyboards are *catalogued*, which is a weaker claim than *known to build*.
- No real authentication: sessions are anonymous cookies, so clearing cookies loses your work.
- No job queue, artifact storage, or build API — builds run only from the CLI smoke script.
- The editor cannot submit builds yet.
- No end-to-end browser tests yet; the UI is covered by API tests and pure geometry unit tests.
