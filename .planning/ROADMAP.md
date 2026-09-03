# Roadmap: QMK Firmware Customizer

## Overview

The journey is one long argument against guessing. Phase 0 pinned a single QMK commit and proved one
keyboard could compile reproducibly. Phase 1 turned that pinned tree into an immutable catalog using
QMK's own tooling, and rendered it read-only in a browser. Phase 2 let a user actually edit a keymap
and save it with revisions and ownership. Phase 3 closed the loop: generate an application-owned
keymap, compile it in a disposable container with no network and a read-only QMK tree, and stream the
firmware back with its checksum.

That leaves one MVP promise unkept. SOCD is modelled in the schema and deliberately refused by both
validation and generation, because the pinned revision's SOCD interface has not been verified.
**Phase 4 is that verification and the generation work it unblocks** — the first feature that forces
the generator past JSON into `rules.mk`, `config.h`, and `keymap.c`, all inside the allowlist ADR
0003 already permits. It ends not when the code compiles but when the firmware demonstrably applies
the chosen policy on a real board.

Phases 5 and 6 are what stands between a working developer tool and something safe to point strangers
at: abuse controls, telemetry, a real smoke matrix, and a decision about identity — then browser
flashing, which stays undecided until a compatibility matrix built from actual artifacts says what is
possible.

## Milestones

- ✅ **MVP foundations** — Phases 0–3 (complete)
- 🚧 **MVP completion: verified SOCD** — Phase 4 (current)
- 📋 **Post-MVP** — Phases 5–6 (planned)

## Phases

**Phase Numbering:**

- Integer phases (0, 1, 2, …): Planned milestone work
- Decimal phases (4.1, 4.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 0: Foundations and Decisions** - Stack decided and recorded in ADRs, QMK pinned, reproducibility spike passing
- [x] **Phase 1: Catalog and Read-Only UI** - Immutable catalog derived by QMK's own tooling, read API, visual layout renderer, unsupported-state UX
- [x] **Phase 2: Saved Visual Configurations** - Typed configurations with revisions, layer editor, structured macros, undo/redo, autosave, owner authorization
- [x] **Phase 3: Generation and Server Builds** - Deterministic keymap generation, queue, isolated worker, artifact storage, build API, quotas, retention, download
- [ ] **Phase 4: Verified SOCD Support** - Verify the pinned revision's SOCD interface, generate it through versioned templates, and prove it on hardware
- [ ] **Phase 5: Hardening and Scale** - Abuse controls, telemetry, curated smoke matrix, backups and retention, launch identity decision
- [ ] **Phase 6: Browser Flashing Research and Rollout** - Build the real compatibility matrix, decide the approach, ship flashing only where detection verifies it

## Phase Details

### Phase 0: Foundations and Decisions

**Status**: Complete
**Goal**: The stack is decided and recorded, QMK is pinned to one commit, and one keyboard compiles reproducibly on a developer machine.
**Depends on**: Nothing (first phase)
**Requirements**: None — this phase delivered decisions and a spike, not a product behaviour
**Success Criteria** (what became TRUE):

  1. Every stack choice is recorded in an ADR with its rationale and migration constraint, so a later reader can tell a decision from an accident — ADR 0001, 14 decisions.
  2. Discovery and builds resolve one commit, `332fa30e173e5b0ecc0c70ff166974b6db86525e` (tag `0.33.13`), from `infra/qmk/manifest.json` as the single source of truth.
  3. One pinned keyboard, one generated base keymap, and one isolated compile succeed end to end, twice, byte-identically.
  4. The spike's surprising finding is itself a recorded decision: with the working directory on the read-only mount, a *successful* `qmk compile` exits 2 — so builds run from a `/workspace/qmkroot` symlink farm instead (ADR 0003, verified on `crkbd/rev1`).

**Delivered**: ADR 0001 (technology stack), ADR 0002 (catalog derives from QMK tooling), ADR 0003 (external QMK userspace); `infra/qmk/manifest.json`; the build image; the reproducibility spike.
**Plans**: n/a (completed before GSD planning)

### Phase 1: Catalog and Read-Only UI

**Status**: Complete
**Goal**: A user can browse every keyboard the pinned revision actually supports, and see honestly why the rest are unavailable.
**Depends on**: Phase 0
**Requirements**: REQ-catalog-discovery, REQ-keyboard-selection
**Success Criteria** (what became TRUE):

  1. A user can search and page through the published catalog — 3,748 keyboards — rendered only from server responses, with no client-side keyboard data of its own.
  2. A user can open a keyboard and see its real layouts drawn from validated QMK position metadata, including rotated keys, with keys labelled by physical position index and matrix coordinate rather than invented legends.
  3. A keyboard the catalog cannot offer is reachable and explains *why* it is unsupported, instead of returning 404.
  4. The catalog is an immutable versioned artifact produced by an offline administrative pipeline: a Python extractor inside the pinned image using QMK's own API, then a strict TypeScript normalizer that records unresolvable entries as unsupported and never repairs them.

**Delivered**: `packages/qmk-catalog`, `infra/qmk/extract/extract_catalog.py`, `packages/qmk-fixtures`, the `/v1/catalog` read API, the sharded `catalogs/0.33.13-1/` format, the visual layout renderer, unsupported-state UX.
**Plans**: n/a (completed before GSD planning)

### Phase 2: Saved Visual Configurations

**Status**: Complete
**Goal**: A user can build a real keymap in the browser and trust that it is saved, theirs, and valid.
**Depends on**: Phase 1
**Requirements**: REQ-visual-keymap-editor, REQ-limited-keycode-catalog, REQ-structured-macros, REQ-configuration-persistence, REQ-ownership-authorization
**Success Criteria** (what became TRUE):

  1. A user can edit a keymap across layer tabs with a searchable allowlisted keycode picker, layer actions, mod-taps, a selected-position inspector, undo/redo, and debounced autosave.
  2. A user can define macros as structured steps within enforced limits — never by typing C — and a macro that would leave a key held is rejected with a field-level error.
  3. A user's configuration persists with revisions and reloads intact; every read and write is scoped by owner in the SQL predicate, and a cross-session request returns 404 so ids cannot be probed.
  4. A concurrent edit from a second tab produces a visible conflict through `If-Match` rather than a silent overwrite, and the client cannot set `id`, `ownerId`, `revision`, or `schemaVersion`.
  5. Selection state in the editor is signalled by fill, stroke width, and an inset ring — never by colour alone.

**Delivered**: `packages/domain` (typed schema, keycode allowlist, identifier validation, limits, server-side validation), Postgres persistence and revisions, anonymous signed-cookie sessions, `apps/web` keymap editor with undo/redo and autosave.
**Plans**: n/a (completed before GSD planning)

### Phase 3: Generation and Server Builds

**Status**: Complete
**Goal**: A user can turn a saved configuration into real, downloadable firmware without touching a toolchain.
**Depends on**: Phase 2
**Requirements**: REQ-owned-keymap-generation, REQ-isolated-compile, REQ-build-lifecycle-api, REQ-build-result-storage-and-download, REQ-error-codes
**Success Criteria** (what became TRUE):

  1. A user can request a build of a *stored revision*, watch it move through `queued → preparing → building → uploading → succeeded`, and cancel it — where cancelling a queued build stops it and cancelling a running one is a request the worker honours at a checkpoint.
  2. A successful build produces a downloadable firmware artifact with its SHA-256, streamed by the API; storage keys are derived from the build id and never reach a client, so there is no URL to share or replay.
  3. A failed build shows a redacted, capped compiler log and a stable error code — never a downloadable file presented as flashable firmware.
  4. Every compile runs in a disposable container with `--network=none`, `--read-only`, `--cap-drop=ALL`, `no-new-privileges`, an unprivileged user, and CPU/memory/pid/wall-clock caps; the QMK tree is verified unmodified after every build, and the artifact is accepted only at the one expected path.
  5. A build request needs an `Idempotency-Key` backed by a unique index, per-session quotas cap concurrent and hourly builds with `BUILD_QUEUE_LIMITED`, artifacts and logs expire after 7 days, and a worker that loses its lease returns the build to the queue rather than stranding it.

**Delivered**: `packages/qmk-generator` (JSON-only generation), `packages/qmk-sandbox` (`BuildSandbox` + hardened Docker), `packages/build-queue`, `packages/artifact-store`, `services/worker` (queue loop, generation, compile, artifact identification, log redaction, lease recovery, retention), the `/v1/builds` API, ADR 0004, the `qwa_worker` database role.
**Plans**: n/a (completed before GSD planning)

### Phase 4: Verified SOCD Support

**Status**: Not started — CURRENT
**Goal**: A user can enable a verified SOCD policy on a supported keyboard and download firmware that demonstrably applies that policy on a real board.
**Depends on**: Phase 3
**Requirements**: REQ-socd-policy-choices, REQ-curated-module-registry, REQ-mvp-definition-of-done
**Success Criteria** (what must be TRUE):

  1. A user can turn SOCD on for a supported keyboard, pick a policy from the verified list, and assign four distinct directional keys — and the editor states, in-product, how SOCD resolves against layers, mod-taps, and macro playback.
  2. A user on a keyboard or catalog version whose SOCD prerequisites are unverified sees SOCD offered as unavailable with `CAPABILITY_UNAVAILABLE` and a reason — never a silent failure, and never a guessed compile.
  3. A build with SOCD enabled compiles in the isolated image and produces a downloadable artifact, while the generated keymap directory still contains only allowlisted files and the QMK tree is still verified unmodified afterwards.
  4. Flashing that artifact to a real board demonstrably applies the chosen policy: simultaneous opposite presses resolve as the policy specifies, release ordering behaves as documented, and layer interaction matches the documented rule.
  5. Every clause of `REQ-mvp-definition-of-done` is true — select, edit, save, build, observe, download — with SOCD now among the product-supported options rather than a refused one.

**Plans**: 4/5 plans executed

Plans:
**Wave 1**

- [x] 04-01-PLAN.md — Land the `worktree-phase-4-socd` branch on main and prove SOCD compiles end to end (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02-PLAN.md — Curated module registry and catalog-version-scoped capability gating (wave 2)
- [x] 04-03-PLAN.md — Record the SOCD module version with every build (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04-04-PLAN.md — Module-hook startup assertion and `mode/m256wh` compile verification (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 04-05-PLAN.md — Hardware verification on `mode/m256wh` — the phase gate (wave 4)

**UI hint**: yes

**Scope notes** (Phase 4 is planned in the most detail; `/gsd-plan-phase 4` decomposes these):

- **Verify before writing any generator code.** `claude.md` rule 9 and § SOCD Cleaner integration
  require inspecting the pinned tree for the feature's official headers, enablement requirements,
  API, and examples first. `socd_cleaner_process` from the original brief is **illustrative only** and
  must not be assumed correct for `0.33.13`. The policy enum is defined *after* verification, and
  only for modes demonstrated to compile and behave. If the facility is absent or changed at the
  pinned revision, the correct output of this phase is a recorded unavailability for this catalog
  version — not guessed compatibility code.

- **Extending the generator beyond JSON is in-scope, not a regression.** ADR 0003's allowlist already
  permits `keymap.json`, `rules.mk`, `config.h`, and `keymap.c`. The shipped generator emits JSON only
  by choice, which is narrower than the decision, not a different one. SOCD needs feature flags in
  `rules.mk`, configuration definitions in `config.h`, and includes plus callbacks in `keymap.c`, all
  through versioned templates. The read-only `/qmk` mount and the external-userspace rules hold with
  no exceptions.

- **One dispatcher, defined order.** Macros and SOCD both want `process_record_user`. Produce one
  application-owned callback that dispatches each enabled feature in a defined order. Do not append a
  second callback and do not inject snippets into arbitrary callbacks.

- **Capability gating rides on the module registry.** `REQ-curated-module-registry` ships here with
  exactly one entry — SOCD Cleaner — pinning source revision, license, minimum QMK/module API version,
  template version, supported options, compatibility tests, and prerequisites. That entry is what
  `listSocdCapabilities(catalogVersion, keyboardId)` reads, and what lets the validator's current
  blanket refusal in `packages/domain/src/validate.ts` become a prerequisite-driven
  `CAPABILITY_UNAVAILABLE` instead of an unconditional one.

- **Test surface.** Compile fixtures per selectable policy in the real isolated image (not a mock,
  per ADR-0001-testing); unit or simulation tests for simultaneous opposite presses, release
  ordering, and layer interaction; snapshot tests on generated `rules.mk`/`config.h`/`keymap.c`
  reviewed deliberately when template or QMK versions change; containment assertions that the new
  file types cannot escape the generated keymap directory.

- **The hardware run is the gate, not a formality.** Criterion 4 is the milestone success metric.
  Compiling is necessary and not sufficient.

- **Labelling.** SOCD behaviour, supported directional-key groups, and game/tournament compliance are
  labelled user responsibility (`claude.md` rule 10). The product makes no compliance claims.

### Phase 5: Hardening and Scale

**Status**: Not started
**Goal**: The application is safe to expose to people who are not the developer who built it.
**Depends on**: Phase 4
**Requirements**: REQ-hardening-abuse-controls, REQ-observability-telemetry, REQ-smoke-matrix, REQ-backup-retention-controls, REQ-launch-identity-model
**Success Criteria** (what must be TRUE):

  1. A burst of build requests — from one IP, or from many fresh sessions — is absorbed by a global concurrency limit and queue backpressure, returning `BUILD_QUEUE_LIMITED` instead of saturating the single host.
  2. An operator can see queue depth, build throughput, failure classification, and worker liveness from exported OpenTelemetry-compatible telemetry, with redaction applied to every sink.
  3. A change to the generator, templates, QMK pin, or build image cannot merge without the curated smoke matrix compiling — so "catalogued" stops being quietly mistaken for "known to build".
  4. An operator can restore configurations and artifacts from a backup and can state what retention actually deleted and when.
  5. The launch identity model is decided and recorded: either accounts exist and a user can reach their configurations from a second device, or anonymous-only is a stated launch constraint whose data-loss behaviour is visible in-product.

**Plans**: 8 plans

Plans:
**Wave 1**

- [ ] 05-01-PLAN.md — Atomic build admission control: global queue-depth cap plus both per-owner caps in one advisory-locked insert (tracer, wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 05-02-PLAN.md — One curated smoke-matrix runner over toolchain-diverse fixture sets (wave 2)
- [ ] 05-03-PLAN.md — Anonymous-only launch identity: persistent data-loss notice, export/import, ADR 0006 (wave 2)
- [ ] 05-04-PLAN.md — Retention ledger, Postgres backups with a real restore drill, licensing review (wave 2)
- [ ] 05-05-PLAN.md — Session issuance IP limit, required session secret, explicit trusted proxy hop (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 05-06-PLAN.md — The merge gate: the repository's first CI, self-hosted runner, dependency and image scanning (wave 3)
- [ ] 05-07-PLAN.md — OpenTelemetry metrics export with redaction on every sink (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 05-08-PLAN.md — Phase close-out: README known gaps and the consolidated deployment requirements (wave 4)

**Scope notes**: `README.md` § Known gaps names the concrete targets — no global concurrency limit or
IP rate limiting, no curated smoke matrix (only `crkbd/rev1` has ever really compiled), no real
authentication, no end-to-end browser tests, and up to 120 seconds of lease-reclaim latency after a
worker dies. `claude.md` § Build isolation and security additionally requires dependency and image
vulnerability scanning, a controlled QMK refresh process, restore and reproducibility drills, and a
legal/licensing review for QMK and bundled assets before public deployment.

**Criterion 5 resolved to anonymous-only** (`05-CONTEXT.md` D-01), so the conditional "accounts"
branch never fired and this phase has **no UI contract** (D-05). The frontend work that remains is
the persistent data-loss notice and the export/import controls, planned in `05-03-PLAN.md` against
`apps/web`'s actual plain-CSS convention — the app carries no Tailwind or Radix, contrary to D-05's
stated rationale, and `globals.css` records that adoption as deliberately deferred since Phase 1.

### Phase 6: Browser Flashing Research and Rollout

**Status**: Not started
**Goal**: A user either flashes from the browser on hardware where support has been *detected*, or is told precisely why they cannot and handed the download path that has always worked.
**Depends on**: Phase 5
**Requirements**: REQ-flashing-compatibility-matrix, REQ-flashing-rollout
**Success Criteria** (what must be TRUE):

  1. A read-only compatibility matrix exists, built from actual artifact formats, bootloaders, browsers, operating systems, and permissions observed in practice — not from assumptions about what should work.
  2. The flashing approach is chosen by an explicit user decision *after* that matrix exists, and is recorded in a new ADR that supersedes ADR-0001-browser-flashing rather than letting it drift.
  3. A user on a detected-supported browser and board can flash from the browser; every other user is shown the download path and the specific reason their combination is unsupported.
  4. No flashing claim, button, or affordance appears anywhere before detection has verified it for that user's combination.
  5. Download and manual flashing remain fully working throughout the rollout and are never regressed into a fallback that nobody tested.

**Plans**: TBD
**UI hint**: yes

## Conditional Future Items

Not phases. Not scheduled. Each is gated on a named trigger and should be picked up only when the
trigger fires.

| Item | Trigger | Source |
|------|---------|--------|
| S3-backed `ArtifactStore` implementation | When the API and the worker no longer share a filesystem | ADR-0004-artifact-store |
| `LISTEN/NOTIFY` behind `BuildQueue.claim` | When idle-worker poll cost matters; fits behind the existing interface without changing anything else | ADR 0004 consequences |
| Redis/BullMQ queue | Only if the database-backed queue stops holding; touches one module by design | ADR-0001-queue |
| microVM `BuildSandbox` backend | If Docker isolation proves insufficient; the generator is unaffected by design | ADR-0001-build-isolation |
| QMK pin bump past `0.33.13` | A bump is a new catalog version and a new build image, never an in-place mutation. Re-verifies the userspace mechanism and the SOCD interface | ADR-0001-qmk-pin, ADR 0003, REQ-socd-policy-choices clause 7 |
| Second curated module (Achordion, Tap Flow, Sentence Case, …) | After SOCD Cleaner proves the registry mechanism end to end | `claude.md` § Curated module registry |

**Do not schedule MinIO provisioning or signed-URL download work.** ADR 0004 is the single current
truth for both artifact storage backend and download mechanism; ADR 0001's artifact-storage row is
annotated in the source as amended by it.

## Progress

**Execution Order:**
Phases execute in numeric order: 0 → 1 → 2 → 3 → **4** → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Foundations and Decisions | n/a (pre-GSD) | Complete | 2026-08-08 |
| 1. Catalog and Read-Only UI | n/a (pre-GSD) | Complete | - |
| 2. Saved Visual Configurations | n/a (pre-GSD) | Complete | - |
| 3. Generation and Server Builds | n/a (pre-GSD) | Complete | 2026-08-09 |
| 4. Verified SOCD Support | 4/5 | In Progress|  |
| 5. Hardening and Scale | 0/8 | Planned | - |
| 6. Browser Flashing Research and Rollout | 0/TBD | Not started | - |

Phases 0–3 were delivered before this planning directory existed and were not decomposed into GSD
plans. Their completion dates are taken from the ADRs accepted in each (`docs/adr/`); Phases 1 and 2
have no dated artifact to cite, so their dates are left blank rather than invented.

---
*Roadmap created: 2026-08-27 from document ingest (`.planning/intel/SYNTHESIS.md`)*
