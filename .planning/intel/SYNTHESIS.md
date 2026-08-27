# Doc Ingest Synthesis

Entry point for downstream consumers (`gsd-roadmapper`). Mode: `new`.
Precedence applied: ADR > SPEC > PRD > DOC. No per-doc precedence overrides were set.

## Documents consumed (6)


- **ADR — 4** (all `locked: true`, all `Status: Accepted`, all confidence `high`)
  - docs/adr/0001-technology-stack.md
  - docs/adr/0002-catalog-derives-from-qmk-tooling.md
  - docs/adr/0003-generated-keymaps-live-in-an-external-userspace.md
  - docs/adr/0004-the-builds-table-is-the-queue.md
- **SPEC — 1** (`locked: false`, confidence `medium`)
  - claude.md — classifier note records it as a mixed-signal document: product MVP/out-of-scope
    sections carry PRD signal, but SPEC signals dominate and outrank PRD per the ambiguity rule.
- **DOC — 1** (`locked: false`, confidence `high`)
  - README.md
- **PRD — 0**
- **UNKNOWN — 0**

## Cycle detection

Ran on the `cross_refs` graph. One 2-node cycle found: `docs/adr/0001-technology-stack.md` ↔
`claude.md`. It spans two precedence tiers and is broken deterministically by ADR > SPEC (claude.md
explicitly defers to ADR 0001 in-text), so it is not a synthesis loop and did not gate. No same-tier
cycles. Max depth reached: 3 (cap: 50). Recorded as [INFO] in the conflicts report.

## Decisions extracted — 23, all locked

Written to `decisions.md`. All 23 come from the four locked ADRs; there are no proposed or unlocked
decisions in this set.

- From ADR 0001 (14): language, frontend, backend, API style, database, queue, artifact storage,
  build isolation, auth, styling, testing, observability, browser flashing (deferred/open), QMK pin.
- From ADR 0002 (1): two-stage catalog derivation — Python extractor inside the pinned image using
  QMK's own tooling, plus a strict TypeScript normalizer that records unsupported entries and never
  repairs data.
- From ADR 0003 (1): generated keymaps live in an external QMK userspace; `/qmk` read-only with no
  exceptions; build runs from a `/workspace/qmkroot` symlink farm; artifact collected from exactly
  one predetermined path.
- From ADR 0004 (7): builds-table-as-queue, cancellation-as-flag, requeue-on-lost-lease,
  idempotency-as-unique-index, `ArtifactStore` interface with filesystem backend, `qwa_worker`
  database role, retention via `QueueRunner.maintain()`.

One decision (ADR-0001-artifact-storage) is flagged in `decisions.md` and in the conflicts report —
see Conflicts below.

## Requirements extracted — 15

Written to `requirements.md`. **Provenance caveat:** no PRD was present in this ingest set. These
REQ entries were extracted from the PRD-signal sections of `claude.md` (§ Product scope — MVP,
§ Definition of done for an MVP build, and the product-behaviour sections it cross-references),
which the classifier itself identified as PRD-signal content inside a SPEC-classified document.
Every entry cites the exact source section. They are SPEC-tier and any ADR decision overrides them.
If the roadmapper requires strictly PRD-sourced requirements, treat these as SPEC-derived.

IDs: REQ-catalog-discovery, REQ-keyboard-selection, REQ-visual-keymap-editor,
REQ-limited-keycode-catalog, REQ-structured-macros, REQ-socd-policy-choices,
REQ-owned-keymap-generation, REQ-isolated-compile, REQ-build-result-storage-and-download,
REQ-build-lifecycle-api, REQ-configuration-persistence, REQ-ownership-authorization,
REQ-error-codes, REQ-curated-module-registry, REQ-mvp-definition-of-done.

`requirements.md` also records the verbatim out-of-scope list and product positioning from
claude.md § Product scope and § Product positioning.

No competing acceptance variants were found (a single SPEC source; nothing to compete with).

## Constraints extracted — 16

Written to `constraints.md`, all from `claude.md`. Type breakdown:

- `protocol` — 9: non-negotiable implementation rules (10 rules), project boundaries, suggested
  repository shape, catalog source management, catalog discovery process, build workflow contract,
  SOCD implementation constraints, phased plan, working checklist, open TBD technology decisions.
- `api-contract` — 3: catalog read interfaces, error handling contract, API/interface expectations.
- `schema` — 2: pinned QMK revision, configuration data model.
- `nfr` — 2: build isolation and security, testing strategy.

(9 + 3 + 2 + 2 = 16.)

## Context topics — 10

Written to `context.md`, all from `README.md`: delivery status against the phased plan, local run
workflow, web UI capabilities today, build API surface and lifecycle, concrete `BUILD_LIMITS`,
published catalog format, check/test commands, repository layout as built, security properties
currently enforced, known gaps, plus a restatement of the pinned QMK revision.

## Conflicts

- **0 blockers**
- **1 competing variant (WARNING)** — two locked ADRs state different artifact-storage backends
  (ADR 0001: S3/MinIO with signed URLs; ADR 0004: filesystem behind `ArtifactStore`, API-streamed
  downloads, S3 deferred). ADR 0004 explicitly cites and narrows ADR 0001, but ADR 0001 carries no
  amendment annotation. Requires user confirmation before routing.
- **3 auto-resolved / informational (INFO)** — the ADR 0001 ↔ claude.md cross-reference cycle
  (broken by precedence); ADR 0003 overriding claude.md rule 3 on generated-keymap location; ADR
  0003's generated-file allowlist being broader than the shipped JSON-only generator (relevant to
  Phase 4 SOCD planning).

Full detail: `/home/tristan/dev/qmk-web-app/.planning/INGEST-CONFLICTS.md`

## Open decisions carried forward (not conflicts)

Recorded in `constraints.md` § Open technology decisions still marked TBD in the SPEC:

- Deployment/hosting provider — claude.md says "containers on a managed platform (specific provider
  still TBD)"; no ADR in this set decides it.
- Browser flashing approach — deferred to Phase 6 by both ADR 0001 and claude.md; consistent, not a
  conflict.
- Macro/product limits — claude.md marks exact limits TBD; README records concrete `BUILD_LIMITS`
  values that were never written back into the SPEC.

## Files produced

- `/home/tristan/dev/qmk-web-app/.planning/intel/decisions.md`
- `/home/tristan/dev/qmk-web-app/.planning/intel/requirements.md`
- `/home/tristan/dev/qmk-web-app/.planning/intel/constraints.md`
- `/home/tristan/dev/qmk-web-app/.planning/intel/context.md`
- `/home/tristan/dev/qmk-web-app/.planning/INGEST-CONFLICTS.md`

Prior codebase-mapping intel is available for cross-reference at
`/home/tristan/dev/qmk-web-app/.planning/codebase/` (ARCHITECTURE, STACK, STRUCTURE, CONVENTIONS,
INTEGRATIONS, TESTING, CONCERNS). It was not merged into these files — this synthesis covers the
doc ingest set only.
