# Constraints (from SPECs)

Source document classified `SPEC`: `claude.md` (confidence: medium, locked: false).
Precedence tier: SPEC — below ADR, above PRD/DOC. Where an ADR contradicts a constraint below,
the ADR wins; those cases are logged in .planning/INGEST-CONFLICTS.md.

---

## Non-negotiable implementation rules
- source: claude.md § Non-negotiable implementation rules
- type: protocol
- content:
  1. Treat the pinned QMK repository as trusted build input, not as editable user data.
  2. Never invent keyboard metadata, matrix positions, layouts, MCU targets, bootloaders, output extensions, or QMK compile targets. Parse and validate them from the pinned source tree and QMK tooling.
  3. Do not blindly edit arbitrary existing C source. The application may create and own a generated keymap directory under the selected keyboard's `keymaps/` directory in an ephemeral workspace. It may only write a short allowlisted set of generated files there.
  4. Generate source from a typed internal configuration model and approved templates. Do not concatenate free-form user text into C, Make, shell commands, paths, or compiler arguments.
  5. Do not use a user-controlled keyboard identifier as a filesystem path until it has been matched to a discovered, validated keyboard record.
  6. Pin the QMK commit used for discovery and builds. Persist that commit with every configuration and build so results are reproducible.
  7. Run every compilation without network access, with resource/time limits, a non-root user, a read-only QMK base, and an ephemeral writable workspace.
  8. Consider QMK source, generated source, build logs, and artifacts potentially sensitive. Do not expose one user's build/job/artifact to another user.
  9. SOCD functionality must be implemented against the exact QMK APIs present in the pinned revision. Verify headers, feature requirements, callbacks, and behavior with tests before exposing it.
  10. Clearly label SOCD behavior, supported directional-key groups, and game/tournament compliance as user responsibility; do not make compliance claims.
- note on rule 3: ADR 0003 (locked) reinterprets this rule as "an application-owned keymap directory the build resolves as the selected keyboard's keymap", satisfied by an external QMK userspace. ADR 0003 governs. See INGEST-CONFLICTS.md [INFO].

## Project boundaries
- source: claude.md § Recommended project boundaries
- type: protocol
- content: Keep the following domains separate even if they begin in one repository.
  - Catalog/discovery — responsibility: read and normalize QMK keyboard/layout metadata. Must not: guess metadata or compile user configurations.
  - Configuration API — responsibility: validate and persist typed user configuration. Must not: execute builds directly or accept source code.
  - Keymap generator — responsibility: convert validated configuration into owned generated QMK files. Must not: read/write arbitrary upstream keymaps.
  - Build orchestrator — responsibility: queue, track, cancel, and authorize builds. Must not: render UI or parse arbitrary browser input itself.
  - Build worker — responsibility: create workspace, generate, compile, collect output. Must not: access public application database with broad credentials.
  - Artifact service — responsibility: authorize download/retention/deletion. Must not: serve unvalidated paths or raw build workspaces.
  - Frontend — responsibility: render metadata and edit configuration. Must not: make QMK validity claims without server validation.
- note: ADR 0004 turns the "Build worker" boundary into a concrete grant list via the `qwa_worker` database role.

## Suggested repository shape
- source: claude.md § Recommended project boundaries
- type: protocol
- content:
  ```
  apps/web/                 frontend
  apps/api/                 configuration/catalog/build API (if separate)
  services/worker/          build worker
  packages/domain/          typed configuration schema and validation
  packages/qmk-catalog/     source-tree discovery/normalization
  packages/qmk-generator/   templates and deterministic generation
  packages/qmk-fixtures/    small pinned test keyboards/configs
  infra/qmk/                pinned revision and image/build definitions
  infra/deploy/             deployment configuration
  docs/
  ```
  Source adds: "Adapt the layout to the chosen stack, but keep generated QMK code, catalog parsing, and build execution independently testable."

## Pinned QMK revision
- source: claude.md § Pinned QMK revision
- type: schema
- content: Upstream `https://github.com/qmk/qmk_firmware.git`; Tag `0.33.13`; Commit `332fa30e173e5b0ecc0c70ff166974b6db86525e`. Authoritative copy lives in `infra/qmk/manifest.json`. Changing it is a new catalog version and a new build image, never an in-place update.
- note: identical to ADR-0001-qmk-pin. No conflict.

## Catalog source management
- source: claude.md § QMK source-tree catalog discovery — Source management
- type: protocol
- content: Maintain a manifest containing the QMK upstream URL, exact commit SHA, fetch date, and optional image digest. Create a catalog only from a checked-out pinned revision; never discover from a mutable branch at request time. Refresh catalog data through an explicit administrative pipeline: fetch, validate, parse, compare changes, publish a new catalog version, then select it for builds. Build configurations against their catalog version, never "latest."

## Catalog discovery process
- source: claude.md § Discovery process
- type: protocol
- content:
  1. Enumerate keyboard directories through QMK's own tooling where practical, then cross-check directory/metadata presence.
  2. Parse `info.json` and any QMK-approved inheritance/schema mechanism required by the pinned revision.
  3. Validate with the QMK tool/schema available at that revision.
  4. Normalize only facts that can be proven: canonical keyboard id, display name, manufacturer, layouts, layout macro names, matrix positions, supported keymaps/defaults where applicable, and compile target/output details as reported by QMK.
  5. Record a catalog entry as unsupported when metadata is incomplete, ambiguous, inherited data cannot be resolved, or it cannot pass a controlled smoke compile. Do not "fill in" missing fields.
  6. Cache the normalized immutable catalog for UI/API use. Keep source file paths and parser/version evidence for debugging.
- note: ADR 0002 (locked) makes step 1–3 concrete as a Python extractor inside the pinned build image plus a strict TypeScript normalizer. ADR 0002 governs.

## Catalog read interfaces
- source: claude.md § Catalog interfaces
- type: api-contract
- content: Minimum read interfaces (source states exact API style as TBD at time of writing; ADR 0001 later fixed REST + OpenAPI):
  - `listKeyboards(catalogVersion, filters)` → paginated keyboard summaries.
  - `getKeyboard(catalogVersion, keyboardId)` → layouts, supported positions, capability flags, and source provenance.
  - `listKeycodes(catalogVersion, capabilityContext)` → only keycodes currently supported by the product.
  - `listSocdCapabilities(catalogVersion, keyboardId)` → policies/key groups verified for that revision.
  The frontend must render from these server responses; it must not carry its own unofficial keyboard catalog.

## Configuration data model
- source: claude.md § Configuration model
- type: schema
- content:
  ```
  Configuration
    id, ownerId (nullable only for deliberate anonymous mode), schemaVersion
    catalogVersion, qmkCommit, keyboardId, layoutId
    name, revision, createdAt, updatedAt
    layers: Layer[]
    macros: Macro[]
    socd: SocdConfiguration | null
    generatorVersion

  Layer
    id, index, name
    bindings: Map<positionId, Binding>

  Binding (discriminated union)
    kind: keycode | transparent | no_op | layer_momentary | layer_toggle |
          layer_tap | mod_tap | macro
    ...only allowlisted, validated parameters

  Macro
    id, name, steps: MacroStep[]

  MacroStep
    kind: tap | key_down | key_up | delay
    keycode/duration parameters within strict allowlists and limits

  SocdConfiguration
    enabled, policyId, directionalKeys: { up, down, left, right }
    # each key must be a distinct validated position in the selected layout

  Build
    id, configurationId, configurationRevision, qmkCommit, generatorVersion
    status, requestedAt, startedAt, completedAt, attemptCount
    artifactId, outputFormat, checksum, logReference, failureCode

  Artifact
    id, buildId, storageKey, originalFilename, byteSize, sha256
    contentType, expiresAt, createdAt
  ```
  Use a versioned typed schema. Store the original validated JSON and a normalized representation; reject unknown fields by default.
- note: ADR 0004 adds `claimed_by`, `lease_expires_at`, and `cancel_requested` to the build row, and a unique index on `(owner_id, idempotency_key)`.

## Build workflow contract
- source: claude.md § Deterministic generation and build workflow
- type: protocol
- content:
  1. API receives a build request for an immutable configuration revision.
  2. Server performs authorization and full schema/capability validation. It stores a build record with `queued` status and an idempotency key.
  3. Orchestrator places a minimal job payload on the queue: build id, configuration revision id, catalog version, generator version.
  4. Worker loads the exact configuration and pinned QMK source/image, creates an ephemeral workspace, and verifies the source commit.
  5. Generator writes only an application-owned keymap directory and allowlisted generated files. Use a fixed safe keymap name derived from the build id; never use a raw user name.
  6. Worker executes the predetermined QMK compile command through an argument array (not a shell string), with the selected validated keyboard/keymap target.
  7. Worker identifies the artifact only from the expected build output manifest/known location; reject unexpected files and cap file size.
  8. Worker computes SHA-256, uploads the artifact and redacted/capped logs, then marks the build `succeeded`. On failure it stores a classified error and marks `failed`.
  9. Artifact service issues an authorized, short-lived download response/URL. Never expose a direct storage key or worker filesystem path.
  10. Cleanup removes ephemeral workspaces regardless of outcome and expires artifacts/logs according to policy.
  Build statuses: `queued`, `preparing`, `building`, `uploading`, `succeeded`, `failed`, `cancelled`, `expired`. State transitions must be atomic and auditable.
- note: step 9's "short-lived download response/URL" is resolved by ADR 0004 to an API-streamed response with no URL. See INGEST-CONFLICTS.md.

## Build isolation and security
- source: claude.md § Build isolation and security
- type: nfr
- content: Use a trusted, versioned build image matching the pinned QMK toolchain; record its digest with the build. Disable network access in workers after required trusted images/sources have been provisioned. Mount QMK base source read-only; use a separate temporary writable workspace. Run as an unprivileged user, drop Linux capabilities, prohibit privileged containers, and apply CPU, memory, process-count, disk, and wall-clock limits. Validate identifiers with an allowlist and resolve paths against a fixed workspace root; reject traversal, separators, NULs, and unexpected Unicode normalization issues. Avoid shell evaluation entirely — do not run `make`, `qmk`, or cleanup commands formed by string interpolation. Limit concurrent builds per user/IP/session and globally; add queue backpressure and abuse monitoring before public access. Keep secrets out of build jobs; workers should receive scoped credentials only for the specific artifact/log write they need. Encrypt data in transit; protect stored artifacts according to the chosen storage provider; use short retention by default. Redact credentials, signed URLs, environment variables, and absolute infrastructure paths from user-visible logs; cap logs and artifacts to prevent resource abuse. Add dependency/image update scanning and a controlled QMK refresh process. Establish legal/licensing review for QMK and any bundled dependencies/assets before public deployment.

## Error handling contract
- source: claude.md § Error handling and user experience
- type: api-contract
- content: Stable, user-safe error codes plus a diagnostic reference. Examples: `CATALOG_KEYBOARD_UNAVAILABLE` (selected keyboard/layout not supported by the active catalog); `CONFIG_INVALID` (server-side validation failed; return field-level errors); `CAPABILITY_UNAVAILABLE` (requested feature not verified for this keyboard/QMK revision); `BUILD_QUEUE_LIMITED` (rate/concurrency limit reached; provide retry guidance); `BUILD_TIMEOUT`, `BUILD_RESOURCE_LIMIT`, `BUILD_COMPILE_FAILED` (compilation did not complete; show a concise message and an authorized sanitized log link); `ARTIFACT_MISSING`, `ARTIFACT_EXPIRED`, `ARTIFACT_UNAUTHORIZED` (do not reveal internal storage details). Keep raw compiler output available only to the owner/authorized support role, sanitize it, and avoid presenting a compiler failure as a firmware that can be flashed. Preserve failed generated inputs internally for a short debugging retention period only if access controls permit.

## API/interface expectations
- source: claude.md § API/interface expectations
- type: api-contract
- content: Version all externally consumed payloads and the configuration schema. Use server-side validation for every write and build request, even if client validation exists. Require optimistic concurrency (`revision` or ETag) on configuration updates to prevent silent overwrites. Make build creation idempotent with a client-supplied idempotency key. Provide build status by polling, server-sent events, WebSocket, or equivalent chosen mechanism; clients must tolerate duplicate/out-of-order events. Authorize every configuration, build, log, and artifact read by ownership/entitlement. Publish API contracts/OpenAPI/schema equivalents and add contract tests once an API style is chosen.

## Testing strategy
- source: claude.md § Testing strategy
- type: nfr
- content:
  - Unit: catalog normalization, inheritance/error handling, identifier/path validation, keycode allowlists, configuration schema migrations, generator determinism, macro limits, and SOCD template selection. Assert that invalid/missing metadata never becomes fabricated UI data. Snapshot generated files for representative fixtures, reviewed deliberately when QMK/template versions change.
  - Integration: run discovery against small pinned QMK fixtures and at least a curated smoke set of real keyboards/layouts. Generate and compile known-good baseline, layered, macro, and each supported SOCD configuration in the isolated build image. Assert generated directory containment, read-only base-source behavior, artifact identification/checksums, timeout cleanup, queue retries, and authorization boundaries.
  - End-to-end: choose keyboard → edit layer → validate → submit build → observe completion → authorized download. Cover validation messages, failed compile presentation, expired artifacts, cross-user access denial, and interrupted/retried status updates. Include accessibility tests for keyboard navigation and non-color-only key state indicators.
  - Security and reliability: fuzz user-controlled ids, names, macro values, JSON payloads, and attempted traversal/shell metacharacters. Test resource-limit enforcement and cancellation at each worker state. Perform dependency/image vulnerability checks and periodic restore/reproducibility drills.
  - Gate: "No pull request that changes generator, QMK pin, templates, or build image should merge without compiling the curated smoke matrix."

## SOCD implementation constraints
- source: claude.md § SOCD Cleaner integration
- type: protocol
- content: SOCD support is revision-sensitive. Before coding it, inspect the pinned QMK tree for the feature's official headers, enablement requirements, API, and examples. The initial reference in the product brief (`socd_cleaner_process`) is illustrative only and must not be assumed correct for every QMK revision. Full requirement list recorded under REQ-socd-policy-choices in requirements.md.

## Phased plan
- source: claude.md § Phased plan
- type: protocol
- content:
  - Phase 0 — foundations and decisions: ask the user to select the technology decisions and record choices in ADRs; define QMK pin, catalog versioning, data schema, security/resource limits, artifact retention, and supported MVP keycode/SOCD scope; build a local reproducibility spike (one pinned keyboard/layout, one generated base keymap, one isolated successful compile).
  - Phase 1 — catalog and read-only UI: implement pinned-source fetch/validation/catalog publication; provide keyboard/layout read APIs and a visual layout renderer; add fixtures, parser tests, provenance, and unsupported-state UX.
  - Phase 2 — saved visual configurations: implement typed configurations, layer editor, allowlisted bindings, drafts/revisions, and server validation; add structured macros with strict limits; do not enable compilation until generated output tests are in place.
  - Phase 3 — generation and server builds: implement deterministic application-owned keymap generation; add queue, isolated worker, status updates, sanitized logs, artifact storage/download, quotas, and cleanup; ship with a small curated keyboard support set before expanding catalog availability.
  - Phase 4 — verified SOCD support: validate pinned-QMK SOCD interface; implement versioned templates and policy tests; enable only tested policies/keyboards and document input behavior in the editor.
  - Phase 5 — hardening and scale: add authentication if required by launch model, abuse controls, observability, backups, retention controls, security review, and broader compile matrix; expand keycode/features only through capability flags and generator/test additions.
  - Phase 6 — browser flashing research and rollout: build a read-only compatibility matrix from actual artifact formats, bootloaders, browsers, operating systems, and permissions; select the flashing approach only after user decision and compatibility testing; initially retain download/manual flashing as the reliable fallback; never claim a browser can flash a device unless detected support has been verified.

## Working checklist
- source: claude.md § Claude Code working checklist
- type: protocol
- content:
  - Before making a change: identify the selected catalog/QMK commit and the relevant schema/template version; inspect the pinned QMK feature/API rather than relying on remembered snippets; confirm the requested change belongs to one boundary above; add or update tests at the same layer as the change; treat all inputs, including catalog parsing output, as untrusted until validated.
  - Before declaring a build-related change complete: run format/lint/type checks chosen by the project; run generator unit tests and relevant fixture compilation(s) in the isolated environment; verify no arbitrary source editing, shell interpolation, path escape, secret/log leak, or artifact authorization regression was introduced; document any newly supported QMK feature, required QMK config, and catalog capability flag.

## Open technology decisions still marked TBD in the SPEC
- source: claude.md § Technology decisions — intentionally open
- type: protocol
- content:
  - Deployment/hosting: "Containers on a managed platform (specific provider still TBD)." No ADR in this ingest set records a deployment decision.
  - Browser flashing (future): "Still TBD — decide in Phase 6 after the compatibility matrix exists." Matches ADR-0001-browser-flashing.
  - Macro/product limits: exact limits recorded as TBD in claude.md § Visual keymap editor. README records concrete `BUILD_LIMITS` values (see context.md); the SPEC was not updated.
  - Process rule: "Do not introduce a stack choice without asking the user. When the user decides, record the choice, rationale, and migration constraints here or in an ADR."
