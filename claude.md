# QMK Firmware Customizer — Implementation Guide

## Purpose

Build a web application that lets a user select a QMK-supported keyboard, edit a visual keymap (including layers and macros), configure supported SOCD behavior, compile a custom QMK firmware image on the server, and download the resulting artifact. Browser-assisted flashing is a later phase.

This document is the operating guide for implementation work. Favor small, verifiable changes and preserve a strict boundary between user configuration and trusted QMK source/build infrastructure.

## Product scope

### MVP

- Discover supported keyboards from a pinned QMK Firmware source revision.
- Show only keyboards and layouts whose metadata has been parsed and validated.
- Let a user choose a keyboard, layout, and supported keymap positions.
- Edit a base layer and additional layers using a visual keyboard UI.
- Support a deliberately limited keycode catalog, transparent/no-op keys, basic layer actions, and simple macros.
- Offer supported SOCD policy choices for an explicitly selected set of directional keys.
- Generate an isolated, application-owned QMK keymap rather than editing upstream keymaps.
- Compile that keymap in a disposable isolated build environment.
- Store the build result, logs, metadata, and firmware artifact; provide a download only after a successful build.

### Out of scope for the MVP

- Editing arbitrary C, Make, JSON, or QMK rules files in the browser.
- Claiming support for every QMK keyboard feature, layout, or keycode.
- Importing/modifying a user-provided firmware binary.
- VIA binary modification.
- Arbitrary user-provided source code, headers, compiler flags, or shell commands.
- Browser flashing; design for it now, implement after the build/download path is reliable.
- Automatic compatibility guarantees beyond the pinned QMK revision and validated metadata.

## Product positioning and existing tools

This application is not a replacement for VIA or a generic clone of QMK Configurator. It occupies the source-level customization gap between them:

| Tool | Best at | Boundary |
| --- | --- | --- |
| VIA | Friendly, immediate remapping of a connected VIA-enabled keyboard: common keycodes, layers, macros, lighting, and device-exposed settings | Only works with compatible VIA firmware and is limited to the dynamic configuration capabilities included in that firmware |
| QMK Configurator | Visual keymap editing and compilation for supported QMK keyboards | Its JSON keymap model cannot express source-level functionality that requires custom code or build configuration |
| This application | A beginner-friendly visual workflow that generates and compiles advanced, source-level QMK configurations | Must expose only carefully tested features and clearly state compatibility/flash requirements |

The primary product promise is: **build advanced QMK firmware visually, without requiring a user to install a toolchain or write C.** The MVP should not attempt to win on basic remapping alone; VIA is generally the better choice for that use case.

### Community Modules and QMK Configurator

QMK Community Modules are not supported by QMK Configurator. The QMK documentation explicitly requires users who want modules to build their own firmware. This is because a module can contain C sources, headers, QMK build rules, feature dependencies, hooks, and custom keycodes, while Configurator accepts a constrained JSON keymap model.

Modules are ordinarily placed below a QMK firmware/userspace `modules/` directory and listed by relative path in the generated keymap's `keymap.json`. A QMK build then incorporates the module. This app can make that workflow accessible only by operating its own controlled source/build environment; it must not accept arbitrary repositories or user-supplied C code.

### Curated module registry

Treat every supported module as a product feature, not a generic plugin upload. The registry must pin its source revision, license, minimum QMK/community-module API version, generated configuration/template version, compatibility tests, supported options, and any keyboard/firmware prerequisites.

Initial candidate modules/features, subject to explicit product and compatibility review:

| Candidate | What it does for a user | Product/UI consideration |
| --- | --- | --- |
| SOCD Cleaner | Resolves simultaneous opposite directional inputs according to a selected policy; primarily useful for gaming layouts | High-risk behavioral feature: verify exact semantics, show a visual input preview, and avoid compliance claims |
| Achordion | Improves how dual-role keys decide between a tap and a held modifier/layer action, especially in home-row-mod layouts | Offer as an optional guided timing/behavior preset, not a set of unexplained source options |
| Tap Flow | Reduces accidental home-row modifier activation while a user is typing quickly | Explain it as a typing-friendly home-row-mod aid and test interaction with other tap-hold settings |
| Sentence Case | Automatically capitalizes the start of sentences while typing | A simple productivity toggle, with clear language/behavior limitations |
| Select Word | Provides key actions for selecting a word or line conveniently | Present as an OS/application-dependent text-navigation shortcut; make platform assumptions visible |
| Custom Shift Keys | Lets selected keys send a nonstandard output when shifted | Provide a visual per-key mapping editor and restrict outputs to supported keycodes |
| Cyclotab | Makes app switching behavior such as Alt+Tab easier to use | Present as an optional navigation behavior with platform-specific guidance |
| Mouse Turbo Click | Repeatedly clicks a mouse button while held | Keep out of early MVP unless there is a clear use case; rate/behavior must be obvious |
| Orbital Mouse | Controls mouse movement through a polar-style input approach | Advanced/niche; defer until the core editor/build pipeline is mature |
| Lumino / PaletteFx | Adds opinionated or palette-based RGB lighting behavior | Defer: keyboard LED hardware and QMK feature compatibility vary widely |

The product should launch with a very small catalog—potentially SOCD Cleaner plus one carefully tested typing feature—rather than promising all modules. Every enabled module must compile in the pinned QMK environment and have documented interaction rules with layers, macros, and other enabled features.

## Non-negotiable implementation rules

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

## Recommended project boundaries

Keep the following domains separate even if they begin in one repository:

| Boundary | Responsibility | Must not do |
| --- | --- | --- |
| Catalog/discovery | Read and normalize QMK keyboard/layout metadata | Guess metadata or compile user configurations |
| Configuration API | Validate and persist typed user configuration | Execute builds directly or accept source code |
| Keymap generator | Convert validated configuration into owned generated QMK files | Read/write arbitrary upstream keymaps |
| Build orchestrator | Queue, track, cancel, and authorize builds | Render UI or parse arbitrary browser input itself |
| Build worker | Create workspace, generate, compile, collect output | Access public application database with broad credentials |
| Artifact service | Authorize download/retention/deletion | Serve unvalidated paths or raw build workspaces |
| Frontend | Render metadata and edit configuration | Make QMK validity claims without server validation |

Suggested repository shape:

```text
apps/
  web/                    # frontend
  api/                    # configuration/catalog/build API (if separate)
services/
  worker/                 # build worker
packages/
  domain/                 # typed configuration schema and validation
  qmk-catalog/            # source-tree discovery/normalization
  qmk-generator/          # templates and deterministic generation
  qmk-fixtures/           # small pinned test keyboards/configs
infra/
  qmk/                    # pinned revision and image/build definitions
  deploy/                 # deployment configuration
docs/
```

Adapt the layout to the chosen stack, but keep generated QMK code, catalog parsing, and build execution independently testable.

## Technology decisions — intentionally open

Do not introduce a stack choice without asking the user. When the user decides, record the choice, rationale, and migration constraints here or in an ADR.

**Decided 2026-08-08 — see [ADR 0001](docs/adr/0001-technology-stack.md) for rationale and migration constraints.**

| Area | Decision |
| --- | --- |
| Frontend framework | Next.js (App Router) + React |
| Backend/runtime/framework | TypeScript/Node, Fastify API |
| Database | PostgreSQL 16 |
| Artifact/object storage | S3-compatible (MinIO in development) |
| Queue/job system | Database-backed queue (`FOR UPDATE SKIP LOCKED`) |
| Build isolation | Docker containers, one disposable container per build, behind a `BuildSandbox` interface |
| API style | REST + OpenAPI generated from the domain schemas |
| Authentication | Anonymous signed-cookie sessions; ownership authorization from day one |
| Deployment/hosting | Containers on a managed platform (specific provider still TBD) |
| Frontend styling/UI | Tailwind CSS + Radix headless primitives |
| Observability | Structured JSON logs now; OpenTelemetry exporters before public access |
| Testing tools | Vitest (unit/integration) + Playwright (e2e); fixture compiles run in the real build image |
| Browser flashing (future) | **Still TBD — decide in Phase 6 after the compatibility matrix exists.** |

### Pinned QMK revision

| Field | Value |
| --- | --- |
| Upstream | `https://github.com/qmk/qmk_firmware.git` |
| Tag | `0.33.13` |
| Commit | `332fa30e173e5b0ecc0c70ff166974b6db86525e` |

Authoritative copy lives in `infra/qmk/manifest.json`. Changing it is a new catalog version and a new build image, never an in-place update.

## QMK source-tree catalog discovery

### Source management

- Maintain a manifest containing the QMK upstream URL, exact commit SHA, fetch date, and optional image digest.
- Create a catalog only from a checked-out pinned revision. Never discover from a mutable branch at request time.
- Refresh catalog data through an explicit administrative pipeline: fetch, validate, parse, compare changes, publish a new catalog version, then select it for builds.
- Build configurations against their catalog version, never "latest."

### Discovery process

1. Enumerate keyboard directories through QMK's own tooling where practical, then cross-check directory/metadata presence.
2. Parse `info.json` and any QMK-approved inheritance/schema mechanism required by the pinned revision.
3. Validate with the QMK tool/schema available at that revision.
4. Normalize only facts that can be proven: canonical keyboard id, display name, manufacturer, layouts, layout macro names, matrix positions, supported keymaps/defaults where applicable, and compile target/output details as reported by QMK.
5. Record a catalog entry as unsupported when metadata is incomplete, ambiguous, inherited data cannot be resolved, or it cannot pass a controlled smoke compile. Do not "fill in" missing fields.
6. Cache the normalized immutable catalog for UI/API use. Keep source file paths and parser/version evidence for debugging.

### Catalog interfaces

Minimum read interfaces (exact API style is TBD):

- `listKeyboards(catalogVersion, filters)` → paginated keyboard summaries.
- `getKeyboard(catalogVersion, keyboardId)` → layouts, supported positions, capability flags, and source provenance.
- `listKeycodes(catalogVersion, capabilityContext)` → only keycodes currently supported by the product.
- `listSocdCapabilities(catalogVersion, keyboardId)` → policies/key groups verified for that revision.

The frontend must render from these server responses; it must not carry its own unofficial keyboard catalog.

## Configuration model

Use a versioned typed schema. Store the original validated JSON and a normalized representation; reject unknown fields by default.

```text
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

Validation must ensure all bound `positionId` values occur in the selected `layoutId`; layer references exist; macro counts/step counts/delays stay within limits; and SOCD keys are distinct and present in the intended directional layer semantics.

## Visual keymap editor

- Render a keyboard only from the selected layout's validated position metadata. Clearly distinguish physical positions from legends/keycodes.
- Show layer tabs, a selected-position inspector, a searchable allowlisted keycode picker, undo/redo, and validation feedback before a build is requested.
- Preserve unassigned and unsupported positions visibly; never silently remap them.
- Start with a compact keycode catalog: common keys, modifiers, media/system keys only if supported, `KC_TRNS`, `KC_NO`, and selected layer actions. Add advanced QMK features incrementally behind capability flags.
- Model macros as structured steps, not user-entered C. Enforce product limits such as maximum macros, steps, delay, and total generated size (exact limits: TBD).
- Preview a configuration as data plus a human-readable summary; do not initially expose raw generated C as an editing surface. A read-only generated-source preview is acceptable for transparency.
- Autosave only validated drafts, or mark drafts explicitly as incomplete and block builds until server validation passes.

## SOCD Cleaner integration

SOCD support is revision-sensitive. Before coding it, inspect the pinned QMK tree for the feature's official headers, enablement requirements, API, and examples. The initial reference in the product brief (`socd_cleaner_process`) is illustrative only and must not be assumed correct for every QMK revision.

Implementation requirements:

1. Define an application-level policy enum only for modes demonstrated to compile and behave correctly on the pinned QMK revision.
2. Expose SOCD only for keyboards/builds that meet its verified prerequisites.
3. Generate the exact, minimal required includes, feature flags, callbacks, and configuration definitions through versioned templates.
4. Compose generated callbacks safely. If macros or other product features require `process_record_user`, produce one application-owned callback that dispatches each enabled feature in a defined order. Do not append a second callback or inject snippets into arbitrary callbacks.
5. Use a deterministic conflict policy for layer/mod-tap behavior, macro playback, and SOCD inputs; document it in the UI and test it.
6. Test each selectable policy with compile fixtures and, where possible, unit/simulation tests covering simultaneous opposite presses, release ordering, and layer interaction.
7. If QMK changes/removes the relevant facility, mark it unavailable for that catalog version rather than generating guessed compatibility code.

## Deterministic generation and build workflow

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

## Build isolation and security

- Use a trusted, versioned build image matching the pinned QMK toolchain. Record its digest with the build.
- Disable network access in workers after required trusted images/sources have been provisioned.
- Mount QMK base source read-only; use a separate temporary writable workspace.
- Run as an unprivileged user, drop Linux capabilities, prohibit privileged containers, and apply CPU, memory, process-count, disk, and wall-clock limits.
- Validate identifiers with an allowlist and resolve paths against a fixed workspace root; reject traversal, separators, NULs, and unexpected Unicode normalization issues.
- Avoid shell evaluation entirely. Do not run `make`, `qmk`, or cleanup commands formed by string interpolation.
- Limit concurrent builds per user/IP/session and globally. Add queue backpressure and abuse monitoring before public access.
- Keep secrets out of build jobs. Workers should receive scoped credentials only for the specific artifact/log write they need.
- Encrypt data in transit; protect stored artifacts according to the chosen storage provider; use short retention by default.
- Redact credentials, signed URLs, environment variables, and absolute infrastructure paths from user-visible logs. Cap logs and artifacts to prevent resource abuse.
- Add dependency/image update scanning and a controlled QMK refresh process. A source update is a new catalog/build environment, not an in-place mutation.
- Establish legal/licensing review for QMK and any bundled dependencies/assets before public deployment.

## Error handling and user experience

Use stable, user-safe error codes plus a diagnostic reference. Examples:

- `CATALOG_KEYBOARD_UNAVAILABLE`: selected keyboard/layout is not supported by the active catalog.
- `CONFIG_INVALID`: server-side configuration validation failed; return field-level errors.
- `CAPABILITY_UNAVAILABLE`: requested feature is not verified for this keyboard/QMK revision.
- `BUILD_QUEUE_LIMITED`: rate/concurrency limit reached; provide retry guidance.
- `BUILD_TIMEOUT`, `BUILD_RESOURCE_LIMIT`, `BUILD_COMPILE_FAILED`: compilation did not complete; show a concise message and an authorized sanitized log link.
- `ARTIFACT_MISSING`, `ARTIFACT_EXPIRED`, `ARTIFACT_UNAUTHORIZED`: do not reveal internal storage details.

Keep raw compiler output available only to the owner/authorized support role, sanitize it, and avoid presenting a compiler failure as a firmware that can be flashed. Preserve failed generated inputs internally for a short debugging retention period only if access controls permit.

## API/interface expectations

Exact API technology is TBD; maintain these semantics:

- Version all externally consumed payloads and the configuration schema.
- Use server-side validation for every write and build request, even if client validation exists.
- Require optimistic concurrency (`revision` or ETag) on configuration updates to prevent silent overwrites.
- Make build creation idempotent with a client-supplied idempotency key.
- Provide build status by polling, server-sent events, WebSocket, or equivalent chosen mechanism; clients must tolerate duplicate/out-of-order events.
- Authorize every configuration, build, log, and artifact read by ownership/entitlement.
- Publish API contracts/OpenAPI/schema equivalents and add contract tests once an API style is chosen.

## Testing strategy

### Unit tests

- Catalog normalization, inheritance/error handling, identifier/path validation, keycode allowlists, configuration schema migrations, generator determinism, macro limits, and SOCD template selection.
- Assert that invalid/missing metadata never becomes fabricated UI data.
- Snapshot generated files for representative fixtures, reviewed deliberately when QMK/template versions change.

### Integration tests

- Run discovery against small pinned QMK fixtures and at least a curated smoke set of real keyboards/layouts.
- Generate and compile known-good baseline, layered, macro, and each supported SOCD configuration in the isolated build image.
- Assert generated directory containment, read-only base-source behavior, artifact identification/checksums, timeout cleanup, queue retries, and authorization boundaries.

### End-to-end tests

- Choose keyboard → edit layer → validate → submit build → observe completion → authorized download.
- Cover validation messages, failed compile presentation, expired artifacts, cross-user access denial, and interrupted/retried status updates.
- Include accessibility tests for keyboard navigation and non-color-only key state indicators.

### Security and reliability tests

- Fuzz user-controlled ids, names, macro values, JSON payloads, and attempted traversal/shell metacharacters.
- Test resource-limit enforcement and cancellation at each worker state.
- Perform dependency/image vulnerability checks and periodic restore/reproducibility drills.

No pull request that changes generator, QMK pin, templates, or build image should merge without compiling the curated smoke matrix.

## Phased plan

### Phase 0 — foundations and decisions

- Ask the user to select the technology decisions above; record choices in ADRs.
- Define QMK pin, catalog versioning, data schema, security/resource limits, artifact retention, and supported MVP keycode/SOCD scope.
- Build a local reproducibility spike: one pinned keyboard/layout, one generated base keymap, one isolated successful compile.

### Phase 1 — catalog and read-only UI

- Implement pinned-source fetch/validation/catalog publication.
- Provide keyboard/layout read APIs and a visual layout renderer.
- Add fixtures, parser tests, provenance, and unsupported-state UX.

### Phase 2 — saved visual configurations

- Implement typed configurations, layer editor, allowlisted bindings, drafts/revisions, and server validation.
- Add structured macros with strict limits.
- Do not enable compilation until generated output tests are in place.

### Phase 3 — generation and server builds

- Implement deterministic application-owned keymap generation.
- Add queue, isolated worker, status updates, sanitized logs, artifact storage/download, quotas, and cleanup.
- Ship with a small curated keyboard support set before expanding catalog availability.

### Phase 4 — verified SOCD support

- Validate pinned-QMK SOCD interface; implement versioned templates and policy tests.
- Enable only tested policies/keyboards and document input behavior in the editor.

### Phase 5 — hardening and scale

- Add authentication if required by launch model, abuse controls, observability, backups, retention controls, security review, and broader compile matrix.
- Expand keycode/features only through capability flags and generator/test additions.

### Phase 6 — browser flashing research and rollout

- Build a read-only compatibility matrix from actual artifact formats, bootloaders, browsers, operating systems, and permissions.
- Select the flashing approach only after user decision and compatibility testing.
- Initially retain download/manual flashing as the reliable fallback; never claim a browser can flash a device unless detected support has been verified.

## Definition of done for an MVP build

A user can select a catalog-validated keyboard/layout from a pinned QMK revision, edit only supported visual bindings and product-supported macros/SOCD options, save a versioned configuration, request a build, see its terminal state, and securely download a checksumed firmware artifact produced by a reproducible isolated QMK build. Invalid metadata/configurations and unverified features are rejected or shown as unavailable—never guessed.

## Claude Code working checklist

Before making a change:

- Identify the selected catalog/QMK commit and the relevant schema/template version.
- Inspect the pinned QMK feature/API rather than relying on remembered snippets.
- Confirm the requested change belongs to one boundary above.
- Add or update tests at the same layer as the change.
- Treat all inputs, including catalog parsing output, as untrusted until validated.

Before declaring a build-related change complete:

- Run format/lint/type checks chosen by the project.
- Run generator unit tests and relevant fixture compilation(s) in the isolated environment.
- Verify no arbitrary source editing, shell interpolation, path escape, secret/log leak, or artifact authorization regression was introduced.
- Document any newly supported QMK feature, required QMK config, and catalog capability flag.