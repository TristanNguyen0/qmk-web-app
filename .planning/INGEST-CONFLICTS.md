## Conflict Detection Report

Mode: new (no existing PROJECT.md / REQUIREMENTS.md / ROADMAP.md / STATE.md to check against).
Precedence applied: ADR > SPEC > PRD > DOC. No per-doc precedence overrides were set.
Docs consumed: 6 — 4 ADR (all locked), 1 SPEC, 1 DOC, 0 PRD, 0 UNKNOWN.

### BLOCKERS (0)

None outstanding. No LOCKED-vs-LOCKED contradiction remains unreconciled after the gate resolution
recorded below, no
UNKNOWN/low-confidence classification is present, and no same-tier cross-reference cycle exists.
See the INFO section for the cross-reference cycle that was found and why it does not gate.

### WARNINGS (0)

None outstanding. One warning was raised during synthesis and resolved at the conflict gate before
any destination file was written; it is recorded below under RESOLVED for audit.

### RESOLVED AT GATE (1)

[RESOLVED] Two locked ADRs stated different artifact-storage backends and neither was annotated
  Found: docs/adr/0001-technology-stack.md (Accepted, 2026-08-08, locked) decided "Artifact storage:
    S3-compatible object storage (MinIO in dev)", rationale "Signed URLs and retention policies
    without exposing storage keys or worker paths".
  Found: docs/adr/0004-the-builds-table-is-the-queue.md (Accepted, 2026-08-09, locked) decided
    "Artifacts go through an `ArtifactStore` interface, backed by the filesystem today", stated
    "Wiring MinIO in immediately was rejected", and replaced the signed-URL mechanism with
    "the API reads the object and streams it" / "A key never leaves the server".
  Found: README.md section "Known gaps" confirms the shipped state — "The `ArtifactStore` seam is in
    place, but S3 is not implemented, so the API and the worker must share a filesystem".
  Impact (as raised): the divergence covered both the backend and the download mechanism, and
    ADR 0001 carried no amendment marker, so a planner reading ADR 0001 alone would have scheduled
    MinIO provisioning and signed-URL download work that ADR 0004 deliberately deferred.
  Resolution: user directed annotation at the source rather than synthesis-side reconciliation.
    docs/adr/0001-technology-stack.md now carries "Status: Accepted (artifact-storage row amended by
    ADR 0004, 2026-08-09)" and its artifact-storage row is annotated inline with the amendment for
    both the backend and the download mechanism. ADR 0004 is the single current truth for
    "artifact storage backend" and "download mechanism". The synthesized intel in
    .planning/intel/decisions.md was updated to match. No decision was merged or rewritten by
    synthesis; both ADRs remain intact and separately recorded.
  Revisit trigger: named by ADR 0004 — "when the API and the worker no longer share a filesystem."

### INFO (3)

[INFO] Cross-reference cycle detected between ADR 0001 and claude.md — resolved by precedence, not gating
  Found: docs/adr/0001-technology-stack.md cross-references `claude.md`, and claude.md
    § "Technology decisions — intentionally open" cross-references `docs/adr/0001-technology-stack.md`.
    This is a 2-node cycle in the cross_refs graph.
  Note: The cycle spans two different precedence tiers (ADR and SPEC) and is broken deterministically
    without a tiebreaker: ADR outranks SPEC, and claude.md explicitly defers — "Decided 2026-08-08 —
    see ADR 0001 for rationale and migration constraints." No same-tier cycle exists (ADR→ADR edges
    form only 0004→0001, which is acyclic; README→{claude.md, 0001, 0004} is acyclic). Maximum
    traversal depth reached was 3, well inside the depth-50 cap. Synthesis of the cyclic pair
    therefore cannot loop, and both documents were synthesized. Recorded here for transparency
    because cycle detection did fire.

[INFO] Auto-resolved: ADR 0003 > claude.md rule 3 on where generated keymaps live
  Note: claude.md rule 3 (SPEC) permits the app to "create and own a generated keymap directory
    under the selected keyboard's `keymaps/` directory in an ephemeral workspace", while claude.md
    § Build isolation requires the QMK base source mounted read-only.
    docs/adr/0003-generated-keymaps-live-in-an-external-userspace.md (Accepted, locked) names this
    tension explicitly — "Taken together those two statements are in tension" — and decides that
    generated keymaps live in an external QMK userspace at
    `/workspace/userspace/keyboards/<keyboardId>/keymaps/<generatedKeymapName>/`, with `/qmk`
    mounted read-only "with no exceptions" and the build run from a `/workspace/qmkroot` symlink
    farm. ADR outranks SPEC, and the ADR itself supplies the reinterpretation: rule 3's wording
    "should be read as 'an application-owned keymap directory the build resolves as the selected
    keyboard's keymap'". ADR 0003 governs in the synthesized intel; the SPEC constraint is retained
    in constraints.md with this note attached.

[INFO] Auto-resolved: ADR 0003 generated-file allowlist is broader than the shipped generator
  Note: docs/adr/0003-generated-keymaps-live-in-an-external-userspace.md (locked) shows the
    workspace allowlist as `keymap.json`, `rules.mk`, `config.h`, `keymap.c` ("allowlisted set, see
    packages/qmk-generator"). README.md § Security properties currently enforced (DOC) states
    "Generation emits **only** `qmk.json` and `keymap.json`. C, Make, and headers are refused", and
    README § Layout describes `packages/qmk-generator/` as "deterministic keymap generation (JSON
    only — no C, no Make)". ADR outranks DOC, so ADR 0003's allowlist is what the synthesized intel
    records as permitted; the README describes a deliberately narrower current implementation, not a
    contradicting decision. This matters for planning Phase 4: claude.md § SOCD Cleaner integration
    requires generating "the exact, minimal required includes, feature flags, callbacks, and
    configuration definitions through versioned templates", which the current JSON-only generator
    cannot emit. Recorded so the roadmapper treats extending the generator beyond JSON as in-scope
    work for verified SOCD support rather than as a violation of a shipped security property.
