# Requirements

**Provenance note:** No document in this ingest set was classified `PRD`. The entries below are
extracted from the PRD-signal sections of `claude.md`, which was classified `SPEC` (confidence:
medium) with the classifier note: *"Mixed-signal document: MVP/out-of-scope product sections (PRD
signal) plus data models, interface signatures, build workflow contracts… SPEC signals dominate and
outrank PRD per ambiguity rule."* Every entry below cites the exact section it came from. Nothing
here is inferred; acceptance criteria are only recorded where the source states them.

Precedence: these are SPEC-tier statements. Any ADR decision overrides them (see decisions.md).

---

## REQ-catalog-discovery
- source: claude.md § Product scope — MVP
- description: Discover supported keyboards from a pinned QMK Firmware source revision.
- acceptance: Show only keyboards and layouts whose metadata has been parsed and validated (claude.md § Product scope — MVP). Record a catalog entry as unsupported when metadata is incomplete, ambiguous, inherited data cannot be resolved, or it cannot pass a controlled smoke compile; do not "fill in" missing fields (claude.md § Discovery process, step 5).
- scope: catalog, discovery, pinned QMK revision

## REQ-keyboard-selection
- source: claude.md § Product scope — MVP
- description: Let a user choose a keyboard, layout, and supported keymap positions.
- acceptance: The frontend must render from server catalog responses; it must not carry its own unofficial keyboard catalog (claude.md § Catalog interfaces).
- scope: keyboard/layout selection

## REQ-visual-keymap-editor
- source: claude.md § Product scope — MVP; claude.md § Visual keymap editor
- description: Edit a base layer and additional layers using a visual keyboard UI.
- acceptance: Render a keyboard only from the selected layout's validated position metadata; clearly distinguish physical positions from legends/keycodes. Show layer tabs, a selected-position inspector, a searchable allowlisted keycode picker, undo/redo, and validation feedback before a build is requested. Preserve unassigned and unsupported positions visibly; never silently remap them. Autosave only validated drafts, or mark drafts explicitly as incomplete and block builds until server validation passes.
- scope: keymap editor, layers, accessibility

## REQ-limited-keycode-catalog
- source: claude.md § Product scope — MVP; claude.md § Visual keymap editor
- description: Support a deliberately limited keycode catalog, transparent/no-op keys, basic layer actions, and simple macros.
- acceptance: Start with a compact keycode catalog: common keys, modifiers, media/system keys only if supported, `KC_TRNS`, `KC_NO`, and selected layer actions. Add advanced QMK features incrementally behind capability flags.
- scope: keycode allowlist, layer actions

## REQ-structured-macros
- source: claude.md § Product scope — MVP; claude.md § Visual keymap editor
- description: Model macros as structured steps, not user-entered C.
- acceptance: Enforce product limits such as maximum macros, steps, delay, and total generated size. Source states exact limits as "TBD".
- scope: macros, product limits

## REQ-socd-policy-choices
- source: claude.md § Product scope — MVP; claude.md § SOCD Cleaner integration
- description: Offer supported SOCD policy choices for an explicitly selected set of directional keys.
- acceptance: Define an application-level policy enum only for modes demonstrated to compile and behave correctly on the pinned QMK revision. Expose SOCD only for keyboards/builds that meet its verified prerequisites. Generate the exact, minimal required includes, feature flags, callbacks, and configuration definitions through versioned templates. Compose generated callbacks safely into one application-owned `process_record_user` dispatcher; do not append a second callback or inject snippets into arbitrary callbacks. Use a deterministic conflict policy for layer/mod-tap behavior, macro playback, and SOCD inputs; document it in the UI and test it. Test each selectable policy with compile fixtures and, where possible, unit/simulation tests covering simultaneous opposite presses, release ordering, and layer interaction. If QMK changes/removes the relevant facility, mark it unavailable for that catalog version rather than generating guessed compatibility code.
- scope: SOCD Cleaner, directional key groups, generation templates
- delivery phase per source: claude.md § Phased plan — Phase 4 ("verified SOCD support")

## REQ-owned-keymap-generation
- source: claude.md § Product scope — MVP
- description: Generate an isolated, application-owned QMK keymap rather than editing upstream keymaps.
- acceptance: Generator writes only an application-owned keymap directory and allowlisted generated files; use a fixed safe keymap name derived from the build id, never a raw user name (claude.md § Deterministic generation, step 5).
- scope: keymap generator
- overriding decision: workspace layout and allowlist are fixed by ADR 0003 (see decisions.md, ADR-0003).

## REQ-isolated-compile
- source: claude.md § Product scope — MVP
- description: Compile the generated keymap in a disposable isolated build environment.
- acceptance: Run every compilation without network access, with resource/time limits, a non-root user, a read-only QMK base, and an ephemeral writable workspace (claude.md rule 7). Execute the predetermined QMK compile command through an argument array, not a shell string (claude.md § Deterministic generation, step 6).
- scope: build worker, build isolation

## REQ-build-result-storage-and-download
- source: claude.md § Product scope — MVP
- description: Store the build result, logs, metadata, and firmware artifact; provide a download only after a successful build.
- acceptance: Worker identifies the artifact only from the expected build output manifest/known location; rejects unexpected files and caps file size. Worker computes SHA-256, uploads the artifact and redacted/capped logs, then marks the build `succeeded`; on failure it stores a classified error and marks `failed`. Artifact service issues an authorized, short-lived download response/URL; never expose a direct storage key or worker filesystem path. Cleanup removes ephemeral workspaces regardless of outcome and expires artifacts/logs according to policy. (claude.md § Deterministic generation, steps 7–10.)
- scope: artifacts, logs, download authorization, retention
- overriding decision: the concrete download mechanism is fixed by ADR 0004 (API streams the object; no signed URL). See decisions.md, ADR-0004-artifact-store, and the WARNING in .planning/INGEST-CONFLICTS.md.

## REQ-build-lifecycle-api
- source: claude.md § Deterministic generation and build workflow; claude.md § API/interface expectations
- description: A build request against an immutable configuration revision flows API → queue → worker → artifact, with observable status.
- acceptance: Server performs authorization and full schema/capability validation, then stores a build record with `queued` status and an idempotency key. Orchestrator places a minimal job payload on the queue: build id, configuration revision id, catalog version, generator version. Build statuses are `queued`, `preparing`, `building`, `uploading`, `succeeded`, `failed`, `cancelled`, `expired`; state transitions must be atomic and auditable. Provide build status by polling, SSE, WebSocket, or an equivalent chosen mechanism; clients must tolerate duplicate/out-of-order events. Make build creation idempotent with a client-supplied idempotency key.
- scope: build orchestration, build state machine, status delivery

## REQ-configuration-persistence
- source: claude.md § Configuration model; claude.md § API/interface expectations
- description: Validate and persist a versioned, typed user configuration with revisions and optimistic concurrency.
- acceptance: Use a versioned typed schema; store the original validated JSON and a normalized representation; reject unknown fields by default. Validation must ensure all bound `positionId` values occur in the selected `layoutId`; layer references exist; macro counts/step counts/delays stay within limits; and SOCD keys are distinct and present in the intended directional layer semantics. Version all externally consumed payloads and the configuration schema. Use server-side validation for every write and build request even if client validation exists. Require optimistic concurrency (`revision` or ETag) on configuration updates to prevent silent overwrites.
- scope: configuration model, revisions, validation, concurrency

## REQ-ownership-authorization
- source: claude.md rule 8; claude.md § API/interface expectations
- description: Every configuration, build, log, and artifact read is authorized by ownership/entitlement.
- acceptance: Consider QMK source, generated source, build logs, and artifacts potentially sensitive; do not expose one user's build/job/artifact to another user.
- scope: authorization, multi-tenancy isolation

## REQ-error-codes
- source: claude.md § Error handling and user experience
- description: Use stable, user-safe error codes plus a diagnostic reference.
- acceptance: Examples given in source — `CATALOG_KEYBOARD_UNAVAILABLE`, `CONFIG_INVALID`, `CAPABILITY_UNAVAILABLE`, `BUILD_QUEUE_LIMITED`, `BUILD_TIMEOUT`, `BUILD_RESOURCE_LIMIT`, `BUILD_COMPILE_FAILED`, `ARTIFACT_MISSING`, `ARTIFACT_EXPIRED`, `ARTIFACT_UNAUTHORIZED`. Keep raw compiler output available only to the owner/authorized support role, sanitize it, and avoid presenting a compiler failure as a firmware that can be flashed.
- scope: error taxonomy, failure UX

## REQ-curated-module-registry
- source: claude.md § Curated module registry
- description: Treat every supported community module as a product feature, not a generic plugin upload.
- acceptance: The registry must pin its source revision, license, minimum QMK/community-module API version, generated configuration/template version, compatibility tests, supported options, and any keyboard/firmware prerequisites. The product should launch with a very small catalog — potentially SOCD Cleaner plus one carefully tested typing feature — rather than promising all modules. Every enabled module must compile in the pinned QMK environment and have documented interaction rules with layers, macros, and other enabled features. The app must not accept arbitrary repositories or user-supplied C code.
- scope: community modules registry
- candidate list recorded in source (subject to explicit product and compatibility review): SOCD Cleaner, Achordion, Tap Flow, Sentence Case, Select Word, Custom Shift Keys, Cyclotab, Mouse Turbo Click (keep out of early MVP unless a clear use case), Orbital Mouse (defer), Lumino / PaletteFx (defer).

## REQ-mvp-definition-of-done
- source: claude.md § Definition of done for an MVP build
- description: A user can select a catalog-validated keyboard/layout from a pinned QMK revision, edit only supported visual bindings and product-supported macros/SOCD options, save a versioned configuration, request a build, see its terminal state, and securely download a checksumed firmware artifact produced by a reproducible isolated QMK build.
- acceptance: Invalid metadata/configurations and unverified features are rejected or shown as unavailable — never guessed.
- scope: MVP acceptance gate

---

## Explicitly out of scope for the MVP
- source: claude.md § Product scope — Out of scope for the MVP
- Editing arbitrary C, Make, JSON, or QMK rules files in the browser.
- Claiming support for every QMK keyboard feature, layout, or keycode.
- Importing/modifying a user-provided firmware binary.
- VIA binary modification.
- Arbitrary user-provided source code, headers, compiler flags, or shell commands.
- Browser flashing; design for it now, implement after the build/download path is reliable.
- Automatic compatibility guarantees beyond the pinned QMK revision and validated metadata.

## Product positioning
- source: claude.md § Product positioning and existing tools
- Primary product promise: build advanced QMK firmware visually, without requiring a user to install a toolchain or write C.
- Not a replacement for VIA and not a generic clone of QMK Configurator; occupies the source-level customization gap between them.
- The MVP should not attempt to win on basic remapping alone; VIA is generally the better choice for that use case.
- Boundary stated for this application: must expose only carefully tested features and clearly state compatibility/flash requirements.
