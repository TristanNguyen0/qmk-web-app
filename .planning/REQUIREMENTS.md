# Requirements: QMK Firmware Customizer

**Defined:** 2026-08-27 (from document ingest — see `.planning/intel/SYNTHESIS.md`)
**Core Value:** A user gets real, compiled QMK firmware for features that require a source-level
build — and every feature offered has been verified to compile and behave on the pinned revision,
never guessed.

## Provenance

**No PRD exists in this repository.** Every requirement below is **SPEC-tier**, extracted from the
PRD-signal sections of `claude.md`, which the ingest classifier labelled `SPEC` (confidence: medium)
with the note: *"Mixed-signal document: MVP/out-of-scope product sections (PRD signal) plus data
models, interface signatures, build workflow contracts… SPEC signals dominate and outrank PRD per
ambiguity rule."*

Consequences of that tier, which must not be lost:

- **Any ADR decision overrides any requirement here.** Where an ADR narrows or replaces a
  requirement's acceptance criteria, the requirement carries an `overriding decision` line.

- **Every requirement cites the exact source section it came from.** Nothing below is inferred from
  the codebase; acceptance criteria are recorded only where the source states them.

- Post-MVP requirements (Phases 5–6) carry a mixed tier: the phase intent is SPEC-tier
  (`claude.md` § Phased plan), and the concrete gaps they close are DOC-tier (`README.md` § Known
  gaps). Each is marked.

Full extracted text: `.planning/intel/requirements.md`. Conflict record:
`.planning/INGEST-CONFLICTS.md`.

---

## v1 Requirements (MVP)

Phases 0–4. Phases 0–3 are complete and shipped; Phase 4 closes the MVP gate.

### Catalog

- [x] **REQ-catalog-discovery** — Discover supported keyboards from a pinned QMK Firmware source
  revision.

  - *Source:* `claude.md` § Product scope — MVP
  - *Acceptance:* Show only keyboards and layouts whose metadata has been parsed and validated.
    Record a catalog entry as unsupported when metadata is incomplete, ambiguous, inherited data
    cannot be resolved, or it cannot pass a controlled smoke compile; do not "fill in" missing fields
    (`claude.md` § Discovery process, step 5).

  - *Overriding decision:* ADR 0002 fixes the two-stage extractor/normalizer boundary.

- [x] **REQ-keyboard-selection** — Let a user choose a keyboard, layout, and supported keymap
  positions.

  - *Source:* `claude.md` § Product scope — MVP
  - *Acceptance:* The frontend must render from server catalog responses; it must not carry its own
    unofficial keyboard catalog (`claude.md` § Catalog interfaces).

### Editor

- [x] **REQ-visual-keymap-editor** — Edit a base layer and additional layers using a visual keyboard
  UI.

  - *Source:* `claude.md` § Product scope — MVP; § Visual keymap editor
  - *Acceptance:* Render a keyboard only from the selected layout's validated position metadata;
    clearly distinguish physical positions from legends/keycodes. Show layer tabs, a
    selected-position inspector, a searchable allowlisted keycode picker, undo/redo, and validation
    feedback before a build is requested. Preserve unassigned and unsupported positions visibly;
    never silently remap them. Autosave only validated drafts, or mark drafts explicitly as
    incomplete and block builds until server validation passes.

- [x] **REQ-limited-keycode-catalog** — Support a deliberately limited keycode catalog, transparent
  and no-op keys, basic layer actions, and simple macros.

  - *Source:* `claude.md` § Product scope — MVP; § Visual keymap editor
  - *Acceptance:* Start with a compact keycode catalog — common keys, modifiers, media/system keys
    only if supported, `KC_TRNS`, `KC_NO`, and selected layer actions. Add advanced QMK features
    incrementally behind capability flags.

- [x] **REQ-structured-macros** — Model macros as structured steps, not user-entered C.
  - *Source:* `claude.md` § Product scope — MVP; § Visual keymap editor
  - *Acceptance:* Enforce product limits such as maximum macros, steps, delay, and total generated
    size. The source states exact limits as "TBD"; the shipped values live in
    `packages/domain/src/limits.ts` and were never written back to the SPEC.

### Configuration

- [x] **REQ-configuration-persistence** — Validate and persist a versioned, typed user configuration
  with revisions and optimistic concurrency.

  - *Source:* `claude.md` § Configuration model; § API/interface expectations
  - *Acceptance:* Use a versioned typed schema; store the original validated JSON and a normalized
    representation; reject unknown fields by default. Validation must ensure all bound `positionId`
    values occur in the selected `layoutId`; layer references exist; macro counts, step counts and
    delays stay within limits; and SOCD keys are distinct and present in the intended directional
    layer semantics. Version all externally consumed payloads and the configuration schema. Validate
    server-side on every write and build request even if client validation exists. Require optimistic
    concurrency (`revision` or ETag) on updates to prevent silent overwrites.

- [x] **REQ-ownership-authorization** — Every configuration, build, log, and artifact read is
  authorized by ownership or entitlement.

  - *Source:* `claude.md` rule 8; § API/interface expectations
  - *Acceptance:* Consider QMK source, generated source, build logs, and artifacts potentially
    sensitive; do not expose one user's build, job, or artifact to another user.

  - *Overriding decision:* ADR-0001-auth fixes anonymous signed-cookie sessions as the identity
    source, with `ownerId` authorization present from day one.

### Generation and Build

- [x] **REQ-owned-keymap-generation** — Generate an isolated, application-owned QMK keymap rather
  than editing upstream keymaps.

  - *Source:* `claude.md` § Product scope — MVP
  - *Acceptance:* The generator writes only an application-owned keymap directory and allowlisted
    generated files; use a fixed safe keymap name derived from the build id, never a raw user name
    (`claude.md` § Deterministic generation, step 5).

  - *Overriding decision:* ADR 0003 fixes the workspace layout, the external userspace, the
    read-only `/qmk` mount, and the generated-file allowlist (`keymap.json`, `rules.mk`, `config.h`,
    `keymap.c`).

- [x] **REQ-isolated-compile** — Compile the generated keymap in a disposable isolated build
  environment.

  - *Source:* `claude.md` § Product scope — MVP
  - *Acceptance:* Run every compilation without network access, with resource and time limits, a
    non-root user, a read-only QMK base, and an ephemeral writable workspace (`claude.md` rule 7).
    Execute the predetermined QMK compile command through an argument array, not a shell string
    (`claude.md` § Deterministic generation, step 6).

- [x] **REQ-build-lifecycle-api** — A build request against an immutable configuration revision flows
  API → queue → worker → artifact, with observable status.

  - *Source:* `claude.md` § Deterministic generation and build workflow; § API/interface expectations
  - *Acceptance:* The server performs authorization and full schema/capability validation, then
    stores a build record with `queued` status and an idempotency key. The orchestrator places a
    minimal job payload on the queue: build id, configuration revision id, catalog version, generator
    version. Build statuses are `queued`, `preparing`, `building`, `uploading`, `succeeded`,
    `failed`, `cancelled`, `expired`; transitions must be atomic and auditable. Provide status by
    polling, SSE, WebSocket, or an equivalent; clients must tolerate duplicate and out-of-order
    events. Make build creation idempotent with a client-supplied idempotency key.

  - *Overriding decision:* ADR 0004 fixes the builds-table-as-queue, lease semantics,
    cancellation-as-flag, requeue-on-lost-lease, and idempotency-as-unique-index.

- [x] **REQ-build-result-storage-and-download** — Store the build result, logs, metadata, and
  firmware artifact; provide a download only after a successful build.

  - *Source:* `claude.md` § Product scope — MVP; § Deterministic generation, steps 7–10
  - *Acceptance:* The worker identifies the artifact only from the expected build output
    manifest/known location, rejects unexpected files, and caps file size. It computes SHA-256,
    uploads the artifact and redacted/capped logs, then marks the build `succeeded`; on failure it
    stores a classified error and marks `failed`. The artifact service issues an authorized download
    response and never exposes a storage key or worker filesystem path. Cleanup removes ephemeral
    workspaces regardless of outcome and expires artifacts and logs according to policy.

  - *Overriding decision:* ADR-0004-artifact-store fixes the download mechanism — the API reads the
    object and streams it. **There is no signed URL.** S3/MinIO is deliberately deferred.

- [x] **REQ-error-codes** — Use stable, user-safe error codes plus a diagnostic reference.
  - *Source:* `claude.md` § Error handling and user experience
  - *Acceptance:* `CATALOG_KEYBOARD_UNAVAILABLE`, `CONFIG_INVALID`, `CAPABILITY_UNAVAILABLE`,
    `BUILD_QUEUE_LIMITED`, `BUILD_TIMEOUT`, `BUILD_RESOURCE_LIMIT`, `BUILD_COMPILE_FAILED`,
    `ARTIFACT_MISSING`, `ARTIFACT_EXPIRED`, `ARTIFACT_UNAUTHORIZED`. Keep raw compiler output
    available only to the owner or an authorized support role, sanitize it, and never present a
    compiler failure as a firmware that can be flashed.

### SOCD and Module Registry

- [ ] **REQ-socd-policy-choices** — Offer supported SOCD policy choices for an explicitly selected
  set of directional keys.

  - *Source:* `claude.md` § Product scope — MVP; § SOCD Cleaner integration; rules 9 and 10
  - *Delivery phase per source:* `claude.md` § Phased plan — Phase 4 ("verified SOCD support")
  - *Acceptance:*
    1. Define an application-level policy enum only for modes demonstrated to compile and behave
       correctly on the pinned QMK revision.

    2. Expose SOCD only for keyboards and builds that meet its verified prerequisites.
    3. Generate the exact, minimal required includes, feature flags, callbacks, and configuration
       definitions through versioned templates.

    4. Compose generated callbacks safely into one application-owned `process_record_user`
       dispatcher with a defined feature order. Do not append a second callback or inject snippets
       into arbitrary callbacks.

    5. Use a deterministic conflict policy for layer/mod-tap behaviour, macro playback, and SOCD
       inputs; document it in the UI and test it.

    6. Test each selectable policy with compile fixtures and, where possible, unit or simulation
       tests covering simultaneous opposite presses, release ordering, and layer interaction.

    7. If QMK changes or removes the relevant facility, mark it unavailable for that catalog version
       rather than generating guessed compatibility code.

    8. Label SOCD behaviour, supported directional-key groups, and game/tournament compliance as user
       responsibility; make no compliance claims (`claude.md` rule 10).

  - *Constraint:* `socd_cleaner_process` in the original brief is **illustrative only** and must not
    be assumed correct for the pinned revision. Inspect the pinned tree first.

  - *Note:* ADR 0003's allowlist already permits `rules.mk`, `config.h`, and `keymap.c`. Extending
    the generator beyond JSON to satisfy this requirement is in-scope work under that allowlist, not
    a regression of a shipped security property.

- [x] **REQ-curated-module-registry** — Treat every supported community module as a product feature,
  not a generic plugin upload.

  - *Source:* `claude.md` § Curated module registry
  - *Acceptance:* The registry must pin its source revision, license, minimum QMK/community-module
    API version, generated configuration/template version, compatibility tests, supported options,
    and any keyboard or firmware prerequisites. The product should launch with a very small catalog —
    potentially SOCD Cleaner plus one carefully tested typing feature — rather than promising all
    modules. Every enabled module must compile in the pinned QMK environment and have documented
    interaction rules with layers, macros, and other enabled features. The app must not accept
    arbitrary repositories or user-supplied C code.

  - *Scope for Phase 4:* the registry ships with **exactly one entry — SOCD Cleaner**. Additional
    entries from the candidate list are post-MVP.

  - *Candidate list recorded in source* (subject to explicit product and compatibility review): SOCD
    Cleaner, Achordion, Tap Flow, Sentence Case, Select Word, Custom Shift Keys, Cyclotab, Mouse
    Turbo Click (keep out of early MVP unless a clear use case), Orbital Mouse (defer),
    Lumino / PaletteFx (defer).

### MVP Gate

- [ ] **REQ-mvp-definition-of-done** — A user can select a catalog-validated keyboard and layout from
  a pinned QMK revision, edit only supported visual bindings and product-supported macros and SOCD
  options, save a versioned configuration, request a build, see its terminal state, and securely
  download a checksummed firmware artifact produced by a reproducible isolated QMK build.

  - *Source:* `claude.md` § Definition of done for an MVP build
  - *Acceptance:* Invalid metadata, invalid configurations, and unverified features are rejected or
    shown as unavailable — never guessed.

  - *Note:* Every clause except the SOCD one is satisfied by Phases 1–3. This requirement closes when
    Phase 4 makes the SOCD clause true.

---

## Post-MVP Requirements (Phases 5–6)

These are in the roadmap, not deferred out of it. Phase intent is SPEC-tier (`claude.md` § Phased
plan, Phases 5 and 6); the concrete gaps each one closes are DOC-tier (`README.md` § Known gaps).
They sit **outside** the `REQ-mvp-definition-of-done` gate.

### Hardening and Scale

- [ ] **REQ-hardening-abuse-controls** — Abuse controls sufficient for public access.
  - *Source:* `claude.md` § Phased plan — Phase 5; § Build isolation and security ("Limit concurrent
    builds per user/IP/session and globally; add queue backpressure and abuse monitoring before
    public access")

  - *Gap closed (DOC):* `README.md` § Known gaps — "No global build concurrency limit or IP-based
    rate limiting — only per-session quotas."

- [ ] **REQ-observability-telemetry** — Observability adequate to operate the service.
  - *Source:* `claude.md` § Phased plan — Phase 5
  - *Overriding decision:* ADR-0001-observability — structured JSON logs now, OpenTelemetry-compatible
    exporters before public access. Log redaction rules apply to every sink added later.

- [ ] **REQ-smoke-matrix** — A curated smoke matrix that gates every change to the generator, QMK
  pin, templates, or build image.

  - *Source:* `claude.md` § Testing strategy — *"No pull request that changes generator, QMK pin,
    templates, or build image should merge without compiling the curated smoke matrix."*; § Phased
    plan — Phase 5 ("broader compile matrix")

  - *Gap closed (DOC):* `README.md` § Known gaps — "Only `crkbd/rev1` has been through a real
    compile; the curated smoke matrix does not exist yet. 3,743 keyboards are *catalogued*, which is
    a weaker claim than *known to build*."

- [ ] **REQ-backup-retention-controls** — Backups, retention controls, and a security review before
  public access.

  - *Source:* `claude.md` § Phased plan — Phase 5 ("backups, retention controls, security review");
    § Build isolation and security ("periodic restore/reproducibility drills",
    "dependency/image update scanning", "legal/licensing review for QMK and any bundled dependencies
    before public deployment")

- [ ] **REQ-launch-identity-model** — Decide and record the launch identity model, adding
  authentication only if the launch model requires it.

  - *Source:* `claude.md` § Phased plan — Phase 5 ("add authentication if required by launch model")
  - *Overriding decision:* ADR-0001-auth — ownership authorization is already present; only the
    identity source changes when accounts arrive. No code may assume `ownerId` is anonymous-only.

  - *Gap closed (DOC):* `README.md` § Known gaps — "No real authentication: sessions are anonymous
    cookies, so clearing cookies loses your work."

### Browser Flashing

- [ ] **REQ-flashing-compatibility-matrix** — Build a read-only compatibility matrix from actual
  artifact formats, bootloaders, browsers, operating systems, and permissions.

  - *Source:* `claude.md` § Phased plan — Phase 6
  - *Overriding decision:* ADR-0001-browser-flashing — the approach is deferred and undecided
    precisely because it requires this matrix from real artifacts and bootloaders.

- [ ] **REQ-flashing-rollout** — Select and roll out the flashing approach only after the matrix
  exists and the user decides.

  - *Source:* `claude.md` § Phased plan — Phase 6
  - *Acceptance:* Retain download and manual flashing as the reliable fallback throughout. **Never
    claim a browser can flash a device unless detected support has been verified**
    (ADR-0001-browser-flashing: "No flashing claim may ship before verified detection").

---

## Out of Scope

Verbatim from `claude.md` § Product scope — Out of scope for the MVP, plus the ingest-resolved
storage deferral.

| Feature | Reason |
|---------|--------|
| Editing arbitrary C, Make, JSON, or QMK rules files in the browser | The product generates from a typed model through approved templates; free-form source is never accepted |
| Claiming support for every QMK keyboard feature, layout, or keycode | The keycode catalog is deliberately small and grows only behind capability flags with tests |
| Importing or modifying a user-provided firmware binary | Out of the product's trust model |
| VIA binary modification | Out of the product's trust model |
| Arbitrary user-provided source code, headers, compiler flags, or shell commands | `claude.md` rule 4 — no free-form user text reaches C, Make, shell, paths, or compiler arguments |
| Browser flashing in the MVP | Design for it now, implement after the build/download path is reliable — Phase 6 |
| Automatic compatibility guarantees beyond the pinned QMK revision and validated metadata | Reproducibility is anchored to one commit; anything else is a guess |
| Basic remapping as the product's selling point | VIA is generally the better choice for that use case (`claude.md` § Product positioning) |
| S3/MinIO artifact storage and signed-URL downloads | Deliberately deferred by ADR-0004-artifact-store — adds a dependency, credentials, and a failure mode without buying a usable property while API and worker share a host. Conditional revisit only |
| Arbitrary community-module repositories or user-supplied C | Every supported module is a reviewed product feature in a curated registry |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REQ-catalog-discovery | Phase 1 | Complete |
| REQ-keyboard-selection | Phase 1 | Complete |
| REQ-visual-keymap-editor | Phase 2 | Complete |
| REQ-limited-keycode-catalog | Phase 2 | Complete |
| REQ-structured-macros | Phase 2 | Complete |
| REQ-configuration-persistence | Phase 2 | Complete |
| REQ-ownership-authorization | Phase 2 | Complete |
| REQ-owned-keymap-generation | Phase 3 | Complete |
| REQ-isolated-compile | Phase 3 | Complete |
| REQ-build-lifecycle-api | Phase 3 | Complete |
| REQ-build-result-storage-and-download | Phase 3 | Complete |
| REQ-error-codes | Phase 3 | Complete |
| REQ-socd-policy-choices | Phase 4 | Pending |
| REQ-curated-module-registry | Phase 4 | Complete |
| REQ-mvp-definition-of-done | Phase 4 | Pending |
| REQ-hardening-abuse-controls | Phase 5 | Pending |
| REQ-observability-telemetry | Phase 5 | Pending |
| REQ-smoke-matrix | Phase 5 | Pending |
| REQ-backup-retention-controls | Phase 5 | Pending |
| REQ-launch-identity-model | Phase 5 | Pending |
| REQ-flashing-compatibility-matrix | Phase 6 | Pending |
| REQ-flashing-rollout | Phase 6 | Pending |

**Coverage:**

- v1 (MVP) requirements: 15 total — 12 Complete (Phases 1–3), 3 Pending (Phase 4)
- Post-MVP requirements: 7 total — all Pending (Phases 5–6)
- Mapped to phases: 22 / 22 ✓
- Unmapped: 0 ✓

**Phase 0** carries no requirement. It delivered the locked decision set (ADR 0001–0003) and the
reproducibility spike, not a product behaviour. This is deliberate, not an orphan.

---
*Requirements defined: 2026-08-27 from document ingest (`.planning/intel/requirements.md`)*
*Last updated: 2026-08-27 after roadmap creation*
