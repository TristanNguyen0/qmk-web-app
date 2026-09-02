# Phase 4: Verified SOCD Support - Research

**Researched:** 2026-09-02
**Domain:** QMK community-module integration, curated-module registry design, hardware
verification workflow
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Carried forward from ADR 0005 (accepted — not reopened):**
- **D-00a:** The pinned revision (`0.33.13`) has no SOCD in core — verified by inspection, not assumed. The only reference is a changelog line pointing at a third-party repository. SOCD therefore ships as a first-party QMK community module, `qmkweb/socd_cleaner`. — Reversibility: one-way.
- **D-00b:** A user's policy choice travels in the keycode (16 keycodes = 8 directions × 2 policies), so `keymap.json` carries `"modules": [...]` plus four keycode tokens and the generator still emits no C. The ROADMAP's expectation that Phase 4 extends generation to `rules.mk`/`config.h`/`keymap.c` is superseded — Phase 3's no-generated-C property survives intact. — Reversibility: one-way.
- **D-00c:** Policy set is closed by construction: `neutral`, `last_input_priority`. A policy with no keycodes cannot be selected.
- **D-00d:** Opposing pairs (`W/S`, `A/D`, `↑/↓`, `←/→`) are static C — geometry, not preference. The user chooses which pair and which policy, never what opposes what.
- **D-00e:** Module source is pinned by SHA-256 digests at review time; an unreviewed edit fails the build. Regeneration is a deliberate act (`pnpm socd:manifest`).
- **D-00f:** Resolution applies on the base layer only; `process_record_modules` runs before `process_record_user`, so SOCD resolves before macros and a macro's own key events pass through untouched.

**Curated module registry:**
- **D-01:** The seven fields `REQ-curated-module-registry` demands live in one typed registry entry — a single `MODULE_REGISTRY` structure with SOCD Cleaner as its only entry, which the capability function reads. — Reversibility: costly.
- **D-02:** The entry declares the verified `(catalogVersion, qmkCommit)` pairs it applies to, and the capability function takes `catalogVersion`. A QMK pin bump then reports SOCD unavailable until `socd:matrix` re-runs. — Reversibility: costly.
- **D-03:** `SOCD_MODULE_VERSION` and the registry entry version are recorded on the build/artifact, the way `qmkCommit` already is. — Reversibility: one-way.
- **D-04:** The entry names the minimum community-module hook API version, and the worker asserts it against the pinned tree at startup — mirroring the existing external-userspace assertion required by ADR 0003. — Reversibility: reversible.

**Hardware verification (criterion 4):**
- **D-05:** The verification board is `mode/m256wh` (Mode Envoy). Catalog entry confirms: `supported: true`, STM32F401, `stm32-dfu` bootloader, layouts `LAYOUT_65_ansi_blocker` (67 positions) and `LAYOUT_65_ansi_blocker_tsangan` (66). W/A/S/D and arrow keys are both present, so the pair choice is unconstrained.
- **D-06:** `mode/m256wh` must pass `socd:matrix` and enter the registry as compile-verified before the hardware run.
- **D-07:** The on-hardware test matrix is both policies on one pair, covering: simultaneous opposite press; both release orderings; the base-layer-only rule checked on a raised layer; and one macro that types a direction key.
- **D-08:** Evidence lives in `04-VERIFICATION.md` in this phase directory — board, firmware SHA-256, module version, catalog version, per-check result, date — and `README.md`'s phase table gains a one-line "verified on hardware" claim pointing at it.
- **D-09:** If the hardware run cannot happen this cycle: the code lands on `main` with the registry's hardware-verified list empty, so every keyboard reports `CAPABILITY_UNAVAILABLE` with a reason. Phase 4 closes only when the hardware run passes.

**Verified-keyboard scope:**
- **D-10:** The registry records both boards with the distinction explicit — `crkbd/rev1` as compile-verified (AVR), `mode/m256wh` as compile- and hardware-verified (ARM/STM32). SOCD is offered on compile-verified boards; the phase gate requires at least one hardware-verified board. — Reversibility: costly.

**Landing the branch:**
- **D-11:** Merge `worktree-phase-4-socd` into `main`, resolving `docs/adr/0001-technology-stack.md` in favour of main's version, then remove the worktree. The registry, gating, provenance, matrix and hardware work lands as new plans on top of the merge.

### Claude's Discretion
- Exact shape and location of the `MODULE_REGISTRY` type (`packages/domain` vs. its own package) — decided at planning time against how much a second module would actually share.
- Which pair (`W/S` + `A/D`, or the arrow cluster) the hardware run uses; both are present on the board.
- Migration mechanics for D-03.

### Deferred Ideas (OUT OF SCOPE)
- A second curated module (Achordion, Tap Flow, Sentence Case, …) — explicitly post-MVP; gated on "after SOCD Cleaner proves the registry mechanism end to end."
- Hardware-verifying `crkbd/rev1` — it stays compile-verified under D-10.
- Browser flashing — Phase 6, undecided (`ADR-0001-browser-flashing`). The hardware run in this phase is a manual flash.
- Widening the SOCD compile matrix beyond two boards — belongs with `REQ-smoke-matrix` in Phase 5.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-socd-policy-choices | Offer supported SOCD policy choices for an explicitly selected set of directional keys (8 acceptance clauses) | Verified against pinned QMK tree: no core SOCD, community-module system present and used correctly (Code Examples, Pattern 1–2). Gaps mapped clause-by-clause in Validation Architecture § Phase Requirement → Test Map. Mod-tap UI-copy gap identified (Pitfall 3). |
| REQ-curated-module-registry | Treat every supported community module as a product feature, ships with exactly one entry — SOCD Cleaner | D-01/D-02/D-03/D-04 gaps located precisely in existing code (`socd.ts`, `catalog.ts` route, `queue-runner.ts`, `docker-sandbox.ts` + `container-entrypoint.sh`); no registry structure exists yet — Wave 0 item. |
| REQ-mvp-definition-of-done | Every clause true, SOCD among supported options | Software path (select/edit/save/build/observe/download) already implemented on the branch; the SOCD clause's actual gate is the hardware run (criterion 4) — not yet satisfied, per D-09. See Validation Architecture final row. |
</phase_requirements>

## Summary

Phase 4 is **not greenfield**. A complete, tested implementation already exists on branch
`worktree-phase-4-socd` (commit `683270f`, worktree at
`.claude/worktrees/phase-4-socd`), on top of an **accepted ADR 0005**. This research
re-verifies every load-bearing claim in that branch and in ADR 0005 directly against the
pinned QMK source tree (checked out at
`.cache/qmk/332fa30e173e5b0ecc0c70ff166974b6db86525e`) and against the running build image
(`qmk-web-app/qmk-build:0.33.13-1`, present locally), rather than trusting the branch's own
account of itself. Every claim below that carries a `.cache/qmk/...` or worktree file
citation was opened and read this session; none of ADR 0005's factual claims about the
pinned tree were found to be wrong.

The phase is genuinely **reconciliation plus four gaps**, not implementation from scratch:
(1) land the branch on `main` — verified safe, see Pitfall 1; (2) consolidate the module
registry and close three concrete metadata gaps (`catalogVersion` plumbing, build/artifact
provenance, startup API-version assertion); (3) add `mode/m256wh` to the compile matrix —
its exact catalog metadata and directional-key position indices are extracted below,
ready to drop into a fixture; (4) flash that board and record the result. Nothing here
requires new third-party packages, new research into unfamiliar frameworks, or design
exploration — the shape of every remaining task is already implied by the existing code's
own seams (a parameter that's ignored, a table with one entry, a startup check that's
missing one assertion).

**Primary recommendation:** Treat this as a **verification-and-extension** plan, not a
build-from-spec plan. Merge the branch first (D-11, pre-verified safe below), then extend
the two or three files the gaps actually live in (`packages/domain/src/socd.ts`,
`packages/domain/src/validate.ts`, `apps/api/src/routes/catalog.ts`,
`packages/qmk-sandbox/.../docker-sandbox.ts` + `infra/qmk/scripts/container-entrypoint.sh`,
`apps/api/migrations/`, `services/worker/src/queue-runner.ts`), add the `mode/m256wh`
fixture to `socd-compile-matrix.ts`, run it for real, then flash the board.

## Project Constraints (from CLAUDE.md)

`claude.md` is SPEC-tier (outranks ROADMAP.md and PROJECT.md per the ingest classifier).
Directives most load-bearing for this phase:

- **Rule 9:** "SOCD functionality must be implemented against the exact QMK APIs present
  in the pinned revision. Verify headers, feature requirements, callbacks, and behavior
  with tests before exposing it." — driven this entire research session; every QMK-side
  claim above was verified against the pinned tree, not assumed.
- **Rule 10:** "Clearly label SOCD behavior, supported directional-key groups, and
  game/tournament compliance as user responsibility; do not make compliance claims." —
  already implemented in `SocdPanel.tsx`'s compliance line; verify it survives the merge
  unchanged.
- **Rule 3:** No blind editing of arbitrary existing C source; only a short allowlisted
  set of generated files in an application-owned keymap directory. Satisfied — the
  generator writes only `keymap.json`; the module's static C is copied, never generated.
- **Rule 4:** No free-form user text concatenated into C, Make, shell, paths, or compiler
  arguments. Satisfied — a user's SOCD choice is two enum-constrained strings
  (`policyId`, `keycode`), never concatenated into source.
- **§ SOCD Cleaner integration, requirement 7:** "If QMK changes/removes the relevant
  facility, mark it unavailable for that catalog version rather than generating guessed
  compatibility code." — this is exactly what D-02's `(catalogVersion, qmkCommit)`
  registry dimension is for; do not implement it as a global on/off flag.
- **§ Curated module registry:** "The app must not accept arbitrary repositories or
  user-supplied C code." — satisfied; the module is first-party and digest-pinned, not
  a plugin-upload mechanism.
- **§ Testing strategy:** "No pull request that changes generator, QMK pin, templates,
  or build image should merge without compiling the curated smoke matrix." — applies
  directly to adding `mode/m256wh`: `socd:matrix` must pass before the registry entry
  changes land.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SOCD policy/pair selection UI | Browser / Client | — | `SocdPanel.tsx` renders only from the server's capability response; no client-side capability logic |
| Capability gating (`CAPABILITY_UNAVAILABLE`) | API / Backend | Database (registry data) | `socdCapabilitiesFor` / `validate.ts` decide availability server-side; the frontend never guesses |
| Curated module registry (metadata) | API / Backend | Database / Storage (persisted provenance) | A typed structure read by the capability route, the validator, and the generator — single source of truth, not duplicated logic |
| Keymap generation (module reference + keycodes) | API / Backend (generator runs in worker process, but is pure/deterministic) | — | `packages/qmk-generator` emits only JSON; no browser or DB involvement |
| Module materialization + digest verification | Build Worker | — | Runs inside the ephemeral workspace immediately before compile; must never touch anything outside `/workspace/userspace/modules/qmkweb/socd_cleaner/` |
| Compile verification (`socd:matrix`) | Build Worker / CI | Database / Storage (build image) | Runs the real isolated image, not a mock (ADR-0001-testing) |
| Build/artifact provenance (module version) | Database / Storage | API (write path in `queue-runner.ts`) | Extends the existing `qmkCommit`/`generatorVersion` provenance columns |
| Hardware behavioral verification | Physical device (outside all tiers) | Phase record (`04-VERIFICATION.md`) | Not automatable; the phase's actual gate per D-09 |

## Package Legitimacy Audit

**N/A — this phase introduces no new external (npm) dependencies.** Verified by diffing
the worktree branch against its baseline (`git diff 72cc65c HEAD -- package.json
packages/qmk-socd-module/package.json services/worker/package.json`, this session): the
only changes are two new `pnpm` scripts (`socd:manifest`, `socd:matrix`) and a new
internal workspace package `@qmk-web-app/qmk-socd-module` whose only dependency is
`@qmk-web-app/domain` (`workspace:*`, first-party, not from a registry). The SOCD Cleaner
"module" itself is **first-party C source written for this repo** (ADR 0005 rejected
vendoring tzarc's third-party module specifically to avoid this exact risk class), so
there is no third-party module package to audit for typosquatting/slopsquatting. `[VERIFIED: packages/qmk-socd-module/package.json, services/worker/package.json — diffed 72cc65c..HEAD this session]`

If the planner introduces any new tooling (e.g., a hardware-flashing CLI helper for
criterion 4), run the Package Legitimacy Gate on it at that point — none is anticipated
by this research.

## Standard Stack

No new stack decisions. The phase operates entirely inside the stack ADR 0001/0003/0004
already fixed: TypeScript/Fastify API, Postgres, Docker build sandbox, Vitest. `[CITED: claude.md, docs/adr/0001-technology-stack.md]`

### Alternatives Considered (already closed by ADR 0005 — do not reopen)

| Instead of | Could Use | Tradeoff | Status |
|------------|-----------|----------|--------|
| First-party `qmkweb/socd_cleaner` module | Vendor tzarc's third-party module as a submodule | Third-party code compiled into user firmware, pinned to a repo the project doesn't control | **Rejected in ADR 0005 — do not reopen** |
| Keycode-encoded policy (no generated C) | Generate a `config.h` with `#define`s for policy/pairs | Spends Phase 3's "no generated C" property for no new capability | **Rejected in ADR 0005 — do not reopen** |
| Community module (QMK 0.33.13 feature) | Patch QMK core to add SOCD | Violates the read-only pinned tree (ADR 0003) and rule 3 | **Rejected in ADR 0005 — do not reopen** |

**Installation:** none required.

## Architecture Patterns

### System Architecture Diagram

```
 Browser (SocdPanel.tsx)
     │  GET /v1/catalog/:catalogVersion/socd-capabilities/:keyboardId
     ▼
 API route (catalog.ts) ──reads──► MODULE_REGISTRY entry (D-01)
     │  { available, reason?, policies, verticalPairs, horizontalPairs }     ▲
     ▼                                                                       │
 User picks policy + 4 positions → PUT configuration ──validated by──► validate.ts
     │  (server-side, every write — claude.md § API expectations)      (reads registry:
     ▼                                                                  catalogVersion,
 POST /builds  { configurationRevisionId, catalogVersion, generatorVersion }  qmkCommit,
     │                                                                  verified-keyboard
     ▼                                                                  set)
 Queue (builds table, ADR 0004) ──claimed by──► Build Worker
     │
     ▼
 Generator (packages/qmk-generator) ──reads registry (module id, keycode table)──►
     emits keymap.json ONLY:  { "modules": ["qmkweb/socd_cleaner"], layer bindings
     use SOCD_* keycode tokens at the 4 directional positions }
     │
     ▼
 Worker: materializeSocdModule() ──verifies SHA-256 against pinned digests──►
     copies static C into /workspace/userspace/modules/qmkweb/socd_cleaner/
     │
     ▼
 DockerSandbox.verify() (startup) ──asserts──► pinned tree has the module-hook API
     version the registry declares as minimum (D-04 — NEW, not yet implemented)
     │
     ▼
 qmk compile (argument vector, /qmk read-only, symlink farm workspace) ──►
     firmware.bin / .hex / .uf2 (collect-artifact.ts, single predetermined path)
     │
     ▼
 Artifact stored + build marked succeeded, WITH module version recorded (D-03 — NEW)
     │
     ▼
 Authorized download ──► user flashes mode/m256wh (manual, criterion 4) ──►
     04-VERIFICATION.md records board / firmware SHA-256 / module version / result
```

### Recommended Project Structure (already in place on the branch — no new layout needed)
```
packages/
├── domain/src/socd.ts        # policies, pairs, keycode table, capability function
├── domain/src/validate.ts    # prerequisite-driven CAPABILITY_UNAVAILABLE
├── qmk-generator/src/generate.ts  # emits keymap.json modules[] + keycode substitution
├── qmk-socd-module/          # first-party module C, digest manifest, host tests
└── qmk-sandbox/              # DockerSandbox.verify() — target for D-04's new check
services/worker/
├── scripts/socd-compile-matrix.ts  # the compile matrix (add mode/m256wh fixture here)
└── src/queue-runner.ts       # build/artifact write path — target for D-03's new field
apps/api/migrations/          # 004_socd_module_version.sql would be the next migration
```

### Pattern 1: Policy-in-keycode configuration (no generated C)
**What:** A user's SOCD choice (policy × direction) is expressed entirely by *which of
16 static module keycodes* the generator emits at a base-layer position — never by a
generated `#define` or C snippet.
**When to use:** Any community-module feature whose only per-user variable is a small,
enumerable choice. This is the pattern to replicate for a second curated module later.
**Example (verified from generator, this session):**
```typescript
// Source: packages/qmk-generator/src/generate.ts (worktree-phase-4-socd @ 683270f)
if (socd) {
  keymapJson['modules'] = [SOCD_MODULE_ID]; // 'qmkweb/socd_cleaner'
}
// socdOverrides.set(position, socdModuleKeycode(socd.policyId, keycode))
// — the ONLY per-build value written for SOCD is a keycode token string.
```
`[VERIFIED: .claude/worktrees/phase-4-socd/packages/qmk-generator/src/generate.ts:233-335]`

### Pattern 2: One dispatcher, defined QMK-level order (not application code)
**What:** The scope notes ask for "one dispatcher... defined order" for macros and SOCD
both wanting `process_record_user`. **This is already solved at the QMK level, not by
application code**: QMK's own `process_record_modules()` runs *before*
`process_record_kb()` → `process_record_user()` (where JSON-defined macros execute).
Verified directly in the pinned tree:
```c
// Source: .cache/qmk/332fa30e.../quantum/quantum.c:354-355
process_record_modules(keycode, record) && // modules must run before kb
process_record_kb(keycode, record) &&
```
The module's `process_record_socd_cleaner()` returns `false` (stops propagation) only
for its own 16 keycodes; every other keycode — including a macro's own key events —
passes through to `process_record_user` untouched. **There is no second
`process_record_user` callback to compose**; SOCD and macros already run in QMK-defined
order without any application-owned dispatcher. `[VERIFIED: .cache/qmk/332fa30e173e5b0ecc0c70ff166974b6db86525e/quantum/quantum.c:354-355 — read this session]`

If a second curated module is ever added that *also* needs `process_record_<module>`
(not `process_record_user`), the same QMK-level ordering applies automatically — no
new dispatcher is needed unless a future module specifically requires
`process_record_user` itself (macros use JSON-defined introspection, not that hook,
at this revision).

### Pattern 3: Registry-gated capability, keyed by `(catalogVersion, keyboardId)`
**What:** `CAPABILITY_UNAVAILABLE` must become prerequisite-driven per `(catalogVersion,
keyboardId)`, not a single global set.
**Current gap (verified this session):**
```typescript
// Source: apps/api/src/routes/catalog.ts:161-170 (worktree, matches main's shape)
const version = resolveVersion(store, request.params.catalogVersion); // computed...
...
const capabilities = socdCapabilitiesFor(keyboardId); // ...then IGNORED
```
```typescript
// Source: packages/domain/src/socd.ts:143 — signature takes no catalogVersion
export function socdCapabilitiesFor(keyboardId: string): SocdCapabilities { ... }
```
`[VERIFIED: .claude/worktrees/phase-4-socd/apps/api/src/routes/catalog.ts:161-170, packages/domain/src/socd.ts:143 — read this session]`
**Fix shape:** `socdCapabilitiesFor(catalogVersion, keyboardId)` reading a registry
entry that declares verified `(catalogVersion, qmkCommit)` pairs (D-02). `validate.ts`'s
`SOCD_VERIFIED_KEYBOARDS.has(configuration.keyboardId)` check (line 135) needs the same
dimension added.

### Anti-Patterns to Avoid
- **Generating C for SOCD.** ADR 0005 already rejected this and it is a one-way
  reversal (would need to supersede an accepted ADR). Do not have the planner "extend
  the generator to rules.mk/config.h/keymap.c for SOCD" — D-00b explicitly supersedes
  that ROADMAP expectation; the generator emits JSON only, as it does today.
- **Marking Phase 4 "Done" before the hardware run passes.** The branch's own
  `README.md` diff already claims `4 — verified SOCD support | **Done.**` — this
  is **not yet true** per D-09 and must not be carried into `main` verbatim (see
  Pitfall 4).
- **Treating registry existence as a two-tier (available/unavailable) flag.** D-10
  requires three real states per keyboard: unverified, compile-verified, and
  compile-*and*-hardware-verified. Collapsing the last two loses the honesty property
  the whole registry exists to provide.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SOCD resolution logic | A custom keycode-interception layer bolted onto `process_record_user` | QMK's existing community-module hook system (`process_record_<module>`, `process_record_modules` ordering) | Already the correct, documented QMK 0.33.13 extension point; verified present at the pinned revision |
| Macro/SOCD callback composition | A hand-rolled "feature dispatcher" inside `process_record_user` | Nothing — QMK's built-in `process_record_modules` → `process_record_kb` → `process_record_user` chain already orders these correctly (Pattern 2) | Building a dispatcher for a problem QMK's own hook order already solves adds a maintenance surface with no new capability |
| Module source integrity | An ad-hoc "trust the file exists" check | SHA-256 digest pinning already implemented in `packages/qmk-socd-module/src/index.ts` (`verifySocdModuleIntegrity`) | Already built, tested, and exercises `wx` flag (fails loudly on unexpected overwrite) |
| Module-hook API version compatibility | A version string comparison scattered across call sites | One assertion in the sandbox's existing `verify-env` startup check (mirrors the ADR-0003 userspace-mechanism assertion already there) | Keeps one place responsible for "is this pinned tree usable," consistent with the existing pattern |

**Key insight:** Everything this phase needs from QMK's side (module system, hook
ordering, keycode range, schema support for a `modules` array) is a **built-in feature
of the pinned revision**, verified present. The only genuine engineering work is
*metadata plumbing* (registry, catalogVersion dimension, provenance column, startup
assertion) — not new firmware-side mechanism.

## Common Pitfalls

### Pitfall 1: Assuming the branch merge needs conflict resolution beyond the ADR
**What goes wrong:** Treating "land the branch on main" as a nontrivial merge task.
**Why it happens:** `main`'s working tree has a large `git status` diff (renamed
`build-queue`/`artifact-store` packages, new `apps/api/src/routes/builds.ts`, etc.)
that looks like divergent Phase 3 work needing reconciliation.
**How to avoid:** It isn't divergent. Verified this session by diffing file *contents*
(not just `git diff --stat`, which is misleading here because most of these files are
**untracked** in `main`'s git index): `git show 72cc65c:services/worker/src/queue-runner.ts`
and `git show 72cc65c:apps/api/src/builds/service.ts` are **byte-identical** to the
current files on disk in `main`'s working tree. `main`'s HEAD commit (`cc41087`) never
committed Phases 1–3's code at all (only `ffe6ac4` + docs-only commits since); that code
has sat as uncommitted working-tree state that happens to equal `72cc65c`. The only
real diff is the ADR 0001 annotation D-11 already documents. `[VERIFIED: docs/adr/0001-technology-stack.md diffed against .claude/worktrees/phase-4-socd:docs/adr/0001-technology-stack.md, this session]`
**Warning signs:** Don't trust `git diff --stat <commit>` with no second ref against a
repo containing large numbers of untracked files — it can render confusingly. Diff
specific file *contents* to confirm identity before planning any "reconciliation" tasks.

### Pitfall 2: Believing the CONTEXT.md's stated file/insertion count
**What goes wrong:** CONTEXT.md states "~6,400 insertions over 66 files" for the branch.
**Actual (verified this session):** `git diff --stat 72cc65c HEAD` inside the worktree
reports **38 files changed, 2,531 insertions(+), 66 deletions(-)**.
**Why it matters:** Not itself a blocker, but the planner should size the "gap closure"
work against the real diff, not the larger stated figure, and should not be surprised
if the branch's actual scope is smaller than described.

### Pitfall 3: Missing the mod-tap gap in the in-product resolution-rules copy
**What goes wrong:** Success criterion 1 requires the editor state "how SOCD resolves
against layers, mod-taps, and macro playback." The current `SocdPanel.tsx` copy
(verified this session) covers **layers** ("base layer only... other layers behave
normally") and **macros** ("SOCD runs before macros, so a macro's own keypresses are
never altered") but contains **no text about mod-taps** at all. `[VERIFIED: .claude/worktrees/phase-4-socd/apps/web/src/components/SocdPanel.tsx:254-258 — read this session, quoted above]`
**Why it happens:** The underlying rule is actually simple and already enforced by
`validate.ts` (a directional position must be bound to the exact SOCD keycode on the
base layer — see line 170: `binding.keycode !== expected` — which makes it
**structurally impossible** for that same position to also be a mod-tap binding), but
that fact was never surfaced as UI copy.
**How to avoid:** Add one sentence to `SocdPanel.tsx`'s "What this does" copy stating
mod-taps and SOCD keys are mutually exclusive by construction on the same position (a
directional position bound for SOCD cannot simultaneously be a mod-tap). This closes
success criterion 1 without any validation-logic change — it is a documentation gap,
not a behavior gap.

### Pitfall 4: Carrying the branch's own "Done" claim into main's README
**What goes wrong:** The branch's `README.md` diff (verified this session) already
states `4 — verified SOCD support | **Done.**` — written before any hardware run.
**Why it happens:** The branch was developed to the point of "compiles and passes
host-run behavioral tests," which felt complete, but D-09 is explicit: "Phase 4 closes
only when the hardware run passes... nothing ships as verified that is not."
**How to avoid:** When merging, replace the branch's README phase-table entry with
language that distinguishes compile-verified from hardware-verified (per D-10), and
only mark the phase "Done" after `04-VERIFICATION.md` (D-08) records a passing hardware
run. If the hardware run cannot happen this cycle, the phase table entry must say so
plainly (D-09) — not "Done."

### Pitfall 5: Assuming the `.bin` artifact path is exercised for ARM
**What goes wrong:** `collect-artifact.ts`'s `ACCEPTED_FIRMWARE_EXTENSIONS` already
includes `hex | bin | uf2` and its logic is extension-agnostic (verified this session,
full function read) — so it *should* work for `mode/m256wh`'s `.bin` output. But **only
`.hex` (AVR, `crkbd/rev1`) has ever actually been produced by a real compile**. The
`stm32-dfu` bootloader path, `qmk compile`'s exact output filename pattern for STM32,
and `MAX_ARTIFACT_BYTES` (8 MiB cap — should be generous for a 256 KB-flash STM32F401,
but unverified in practice) are all first exercised by this phase's `socd:matrix` run.
**How to avoid:** Treat the first real `mode/m256wh` compile as also a smoke test of
the ARM artifact-collection path, not just the SOCD module. If `expectedTargetName()`'s
assumption (keyboard id with `/` → `_`, then `_<keymapName>`) doesn't match QMK's actual
STM32 build output filename, this is where it will surface.

### Pitfall 6: Adding the module-hook version assertion in the wrong layer
**What goes wrong:** D-04 asks for an assertion "mirroring the existing external-userspace
assertion" at worker startup. It would be easy to add this check inside application
TypeScript code that calls into the sandbox, duplicating logic.
**How to avoid:** The existing mechanism (verified this session) lives entirely inside
`infra/qmk/scripts/container-entrypoint.sh`'s `verify-env` verb, which emits a JSON
`{checks: {...}, ok: bool}` blob that `DockerSandbox.verify()` (in
`packages/qmk-sandbox/src/docker-sandbox.ts`) parses and requires `ok === true`. Add
the new check (e.g., `module_hook_api_version_ok`, parsing
`data/constants/module_hooks/*.hjson` filenames and comparing the highest version
against the registry's declared minimum) as a **new key in that same `checks` dict** —
do not build a parallel assertion path. `[VERIFIED: infra/qmk/scripts/container-entrypoint.sh (verify-env verb, full contents read this session), .claude/worktrees/phase-4-socd/packages/qmk-sandbox/src/docker-sandbox.ts:114-124]`

## Code Examples

### The exact directional-key position indices for the `mode/m256wh` compile fixture

Needed to write the `FIXTURES['mode/m256wh']` entry in `socd-compile-matrix.ts`,
mirroring the existing `crkbd/rev1` entry. Extracted this session by parsing
`catalogs/0.33.13-1/keyboards/0009.json`'s `mode/m256wh` → `LAYOUT_65_ansi_blocker`
entry directly (3,748-keyboard catalog file; grep alone cannot safely isolate one
keyboard's position array, so this was read via a full JSON parse of the file this
session, not assumed from a schema):

| Key | Position index | Matrix | Label in catalog |
|-----|----------------|--------|-------------------|
| W | 17 | `[1,0]` | `Q`... wait — see note below |
| A | 31 | `[2,1]` | `A` |
| S | 32 | `[2,2]` | `S` |
| D | 33 | `[2,3]` | `D` |
| ↑ (Up) | 56 | `[3,13]` | `↑` |
| ↓ (Down) | 65 | `[4,12]` | `↓` |
| ← (Left) | 64 | `[4,11]` | `←` |
| → (Right) | 66 | `[4,13]` | `→` |

**Correction on W:** the raw position dump (quoted below verbatim) shows index 17 is
labeled `W` (position 16 is `Q`, immediately before it) — the table row above
mis-stated the label; use the verbatim dump, not the paraphrase, as source of truth:
```
16 [1, 1] 1.5 1 Q
17 [1, 2] 2.5 1 W
```
`[VERIFIED: catalogs/0.33.13-1/keyboards/0009.json — mode/m256wh.layouts[LAYOUT_65_ansi_blocker].positions, parsed via python3 json.load this session; full position dump: indices 0-66 for this layout, quoted in the research session transcript]`

**Also confirmed this session, same parse:**
```
keyboardId       mode/m256wh
supported        True
manufacturer     Mode Designs
processor        STM32F401
bootloader       stm32-dfu
platform         STM32
layout: LAYOUT_65_ansi_blocker positions: 67
layout: LAYOUT_65_ansi_blocker_tsangan positions: 66
```
This matches D-05's claims in CONTEXT.md exactly — `supported: true`, STM32F401,
`stm32-dfu`, both 65% layouts present, both W/A/S/D and arrow-cluster pairs available
in the same layout (so either pair, or both, can be exercised in the fixture and on
hardware per D-07's discretion).

### QMK module system facts verified against the pinned tree (backing ADR 0005)

```
# Source: .cache/qmk/332fa30e173e5b0ecc0c70ff166974b6db86525e — read/grepped this session
grep -ril socd --include=*.c --include=*.h --include=*.mk --include=*.md .
  → only lib/chibios-contrib/.../fsl_pmu.h (false positive: "SOCD" substring in an
    unrelated MCU driver macro name); no SOCD facility anywhere in core.

docs/ChangeLog/20250223.md:16
  → "...a community module port of getreuer's SOCD Cleaner can be found in tzarc's
     modules repo" — confirms SOCD was never in core at this revision, only referenced
     as pointing elsewhere.

quantum/keycodes.h:85-86
  → QK_COMMUNITY_MODULE = 0x77C0, QK_COMMUNITY_MODULE_MAX = 0x77FF   (64-slot range)

data/constants/module_hooks/{0.1.0,1.0.0,1.1.0,1.1.1,1.1.2}.hjson  → present, confirmed
data/constants/module_hooks/0.1.0.hjson → defines process_record hook at API 0.1.0

quantum/quantum.c:354-355
  → process_record_modules(keycode, record) && // modules must run before kb
     process_record_kb(keycode, record) &&

data/schemas/community_module.jsonschema  → $id "qmk.community_module.v1", present
data/schemas/keymap.jsonschema:86-91      → "modules": {"type":"array","items":{"type":"string"}}
modules/qmk/{hello_world,super_alt_tab,split_data_sync,flow_led_matrix_effect,
             flow_rgb_matrix_effect}/qmk_module.json  → 5 first-party modules present
             (ADR 0005 only cites hello_world; there are more first-party precedents)
```
`[VERIFIED: .cache/qmk/332fa30e173e5b0ecc0c70ff166974b6db86525e/{docs/ChangeLog/20250223.md, quantum/keycodes.h, data/constants/module_hooks/, quantum/quantum.c, data/schemas/community_module.jsonschema, data/schemas/keymap.jsonschema, modules/qmk/} — all read this session]`

### The exact D-02 gap, ready to fix

```typescript
// Source: .claude/worktrees/phase-4-socd/packages/domain/src/socd.ts:143 (read this session)
export function socdCapabilitiesFor(keyboardId: string): SocdCapabilities {
  if (!SOCD_VERIFIED_KEYBOARDS.has(keyboardId)) { ... }
  // ^ no catalogVersion parameter; SOCD_VERIFIED_KEYBOARDS is a flat Set<string>
}

// Source: .claude/worktrees/phase-4-socd/apps/api/src/routes/catalog.ts:161-170
const version = resolveVersion(store, request.params.catalogVersion); // resolved...
const capabilities = socdCapabilitiesFor(keyboardId);                 // ...but unused
```

### The exact D-03 write path, ready to extend

```typescript
// Source: .claude/worktrees/phase-4-socd/services/worker/src/queue-runner.ts:308-339
const completed = await queue.complete({
  buildId, workerId,
  artifact: { id: randomUUID(), storageKey: key, ... },
  outputFormat: result.artifact.extension,
  logReference,
  buildImageRef: result.imageRef,
  buildImageDigest: result.imageDigest,
  generatorVersion: result.generatorVersion,
  // ^ socdModuleVersion (or moduleVersions: Record<moduleId, version>) belongs here,
  //   threaded from result (run-build.ts) the same way generatorVersion already is.
});
```
`builds` table grant check (verified this session): `qwa_worker` has table-level
`GRANT SELECT, UPDATE ON builds` (`apps/api/migrations/003_worker_role.sql:40`, not
column-restricted), so a new `builds.socd_module_version` column needs **no grant
change** — only a new migration (`004_...sql`) and the write-path edit above. `[VERIFIED: apps/api/migrations/003_worker_role.sql:40]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ROADMAP's expectation: generator extends to `rules.mk`/`config.h`/`keymap.c` for SOCD | Generator emits JSON only; SOCD ships as a first-party community module | ADR 0005, accepted 2026-08-09 | Phase 3's "no generated C" property survives; do not plan generator work beyond keymap.json for SOCD |
| Blanket SOCD refusal in `validate.ts` | Prerequisite-driven `CAPABILITY_UNAVAILABLE`, gated on a verified-keyboard set | Already landed on the branch | Only needs the `catalogVersion` dimension added (D-02), not new refusal logic |

**Deprecated/outdated:** The original product brief's `socd_cleaner_process` reference
is confirmed **not present anywhere in the pinned tree** — treat any future SOCD-adjacent
research or generated code that assumes this function exists as wrong.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `MAX_ARTIFACT_BYTES` (8 MiB) is generous enough for `mode/m256wh`'s STM32F401 `.bin` output | Pitfall 5 | Low — STM32F401 has ≤512 KB flash; a compiled `.bin` should be well under 8 MiB, but this is inferred from chip specs, not measured from an actual compile yet |
| A2 | `expectedTargetName()`'s `keyboardId.replace('/','_') + '_' + keymapName` pattern matches QMK's actual output filename for STM32 targets, same as it does for AVR | Pitfall 5 | Medium — if QMK's STM32 build naming differs, the first `mode/m256wh` compile will surface `ARTIFACT_NOT_PRODUCED` rather than a SOCD-specific failure; distinguishing the two failure modes matters for triage |
| A3 | Adding a `builds.socd_module_version` column requires no `qwa_worker` grant change | Code Examples § D-03 | Low — table-level `GRANT UPDATE` was read directly from the migration file this session; risk only if a future migration narrows the grant to specific columns |

## Open Questions

1. **Does the module-hook API version registry entry (D-04) need a numeric comparison,
   or is presence-of-file sufficient?**
   - What we know: the pinned tree has hook definitions for `0.1.0` through `1.1.2`; the
     module asserts `ASSERT_COMMUNITY_MODULES_MIN_API_VERSION(1, 0, 0)` at compile time
     already (a QMK-level, not application-level, check).
   - What's unclear: whether the D-04 startup assertion should duplicate that same
     `1.0.0` floor (redundant with the compile-time assert, but catches it earlier and
     more cheaply than a full compile) or check something else the compile-time assert
     doesn't (e.g., that the hook the module actually *uses*, `process_record`, exists
     at the pinned revision's latest hook version — it does, verified).
   - Recommendation: make the startup check redundant-but-cheap insurance against a
     tree mismatch (same intent as the existing `qmk_userspace_supported` check), not a
     replacement for the compile-time assert.

2. **Which directional pair does the hardware run exercise — W/S+A/D, arrows, or both?**
   - What we know: `mode/m256wh`'s `LAYOUT_65_ansi_blocker` has both pairs present
     (position indices confirmed above); CONTEXT.md leaves this to Claude's discretion.
   - What's unclear: whether testing only one pair leaves the other pair's wiring
     unverified on this specific board (D-07 says hardware exists to "prove wiring,
     keycode registration, flash fit" — a pair not tested has none of those proven for
     it specifically, only for the shared resolution logic).
   - Recommendation: test both pairs if time permits (same board, same flash); if only
     one, record in `04-VERIFICATION.md` explicitly which pair was tested and that the
     other pair's *logic* (not wiring) is covered by `socd_resolve_test.c`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^2.1.8 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` (357 tests on the branch, no Docker required) |
| Full suite command | `pnpm test && pnpm socd:matrix catalogs/0.33.13-1` (needs Docker + pinned tree) |

`[VERIFIED: package.json scripts, README.md diff (worktree) — read this session]`

### Phase Requirement → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-socd-policy-choices cl.1 | Policy enum only for demonstrated modes | unit | `vitest run packages/domain/src/socd.test.ts` | ✅ (branch) |
| REQ-socd-policy-choices cl.2 | `CAPABILITY_UNAVAILABLE` for unverified keyboard | unit | `vitest run packages/domain/src/validate.test.ts` | ✅ (branch); needs new cases for `catalogVersion` dimension (D-02) |
| REQ-socd-policy-choices cl.3 | Minimal generated includes/flags via templates | unit + compile | `vitest run packages/qmk-generator/src/generate.test.ts` + `pnpm socd:matrix` | ✅ generator unit; compile matrix ✅ for `crkbd/rev1`, ❌ Wave 0 for `mode/m256wh` |
| REQ-socd-policy-choices cl.4 | One dispatcher, defined order | unit (host C) | `pnpm test` (compiles `socd_resolve_test.c`) | ✅ — QMK-level ordering verified against source, not just tested |
| REQ-socd-policy-choices cl.5 | Deterministic conflict policy, documented in UI | unit + manual UI review | `vitest run apps/web/src/lib/editor-state.test.ts` + manual `SocdPanel.tsx` copy review | ✅ unit; ❌ mod-tap copy gap (Pitfall 3) |
| REQ-socd-policy-choices cl.6 | Compile fixtures + simulation tests per policy | integration (real image) + unit | `pnpm socd:matrix catalogs/0.33.13-1` + `socd_resolve_test.c` (2,070 assertions) | ✅ for `crkbd/rev1`; ❌ Wave 0 for `mode/m256wh` |
| REQ-socd-policy-choices cl.7 | Unavailable, not guessed, if QMK changes | unit | `packages/domain/src/socd.test.ts` (empty-policy-list path) | ✅ |
| REQ-socd-policy-choices cl.8 | Compliance labelling, no compliance claim | manual UI review | N/A (copy review) | ✅ present in `SocdPanel.tsx` |
| REQ-curated-module-registry | Single typed registry entry, seven fields | unit | new test asserting `MODULE_REGISTRY['qmkweb/socd_cleaner']` has all seven fields | ❌ Wave 0 — registry doesn't exist as a unified structure yet (D-01) |
| REQ-mvp-definition-of-done (SOCD clause) | Full select→build→download flow with SOCD | e2e / manual | existing e2e suite + **hardware flash** (not automatable) | ✅ software path; ❌ hardware gate (criterion 4) is the phase's actual finish line |

### Sampling Rate
- **Per task commit:** `pnpm test` (no Docker; fast)
- **Per wave merge:** `pnpm test && pnpm socd:matrix catalogs/0.33.13-1` (Docker required)
- **Phase gate:** Full suite green **and** hardware run recorded in `04-VERIFICATION.md`
  before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `mode/m256wh` fixture entry in `services/worker/scripts/socd-compile-matrix.ts` —
      covers REQ-socd-policy-choices cl.3, cl.6; position data supplied above
- [ ] Unit test for `MODULE_REGISTRY` shape (seven fields present) — covers
      REQ-curated-module-registry
- [ ] Unit tests for `socdCapabilitiesFor(catalogVersion, keyboardId)`'s new dimension
      — covers REQ-socd-policy-choices cl.2, cl.7 with a QMK-pin-bump scenario
- [ ] `04-VERIFICATION.md` template/skeleton — covers D-08, the hardware-run evidence
      record
- [ ] Mod-tap sentence in `SocdPanel.tsx` copy — covers REQ-socd-policy-choices cl.5 /
      success criterion 1 fully (currently partial, see Pitfall 3)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | Unchanged from Phase 2 (anonymous signed-cookie sessions) |
| V3 Session Management | No | Unchanged |
| V4 Access Control | Partial | `SOCD_VERIFIED_KEYBOARDS`/registry gating is itself an access-control decision (which capability a keyboard is authorized to use), enforced server-side in `validate.ts`, never client-side |
| V5 Input Validation | Yes | Zod schemas (`socdConfigurationSchema`) already enforce distinct directional keys, enum-constrained `policyId`, and pair-matching against the module's static tables — do not hand-roll additional validation outside this schema |
| V6 Cryptography | Yes (supply-chain, not transport) | SHA-256 digest pinning (`SOCD_MODULE_DIGESTS`) on the module's static C source is the project's substitute for a package-manager integrity mechanism — never bypass `verifySocdModuleIntegrity()` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Unreviewed edit to first-party module C silently reaching a user's firmware | Tampering | SHA-256 digest check before every `materializeSocdModule()` call; regeneration is the deliberate `pnpm socd:manifest` act, never automatic |
| A keyboard/QMK-pin combination optimistically offered as SOCD-capable without a real compile | Spoofing (of a capability claim) | `SOCD_VERIFIED_KEYBOARDS` / registry gate, closed by construction — extend the `(catalogVersion, qmkCommit)` dimension (D-02) rather than loosening the check |
| A directional position simultaneously bound to a SOCD keycode and something else (e.g., mod-tap) reaching the firmware | Tampering (of user intent) | Already structurally prevented: `validate.ts` requires the base-layer binding to equal the exact expected SOCD token; document this to close the UI-copy gap (Pitfall 3), no new validation code needed |
| Module hook API mismatch between what the registry declares and what the pinned tree actually offers | Tampering / Repudiation (silent incompatibility) | New startup assertion (D-04) in the same `verify-env` mechanism ADR 0003 already uses |

## Sources

### Primary (HIGH confidence — read directly this session)
- `.cache/qmk/332fa30e173e5b0ecc0c70ff166974b6db86525e/` — the pinned QMK source tree
  itself (`quantum/quantum.c`, `quantum/keycodes.h`, `data/constants/module_hooks/`,
  `data/schemas/community_module.jsonschema`, `data/schemas/keymap.jsonschema`,
  `docs/ChangeLog/20250223.md`, `docs/features/community_modules.md`,
  `modules/qmk/*/qmk_module.json`) — checked out locally, verified at the exact pinned
  commit via `git rev-parse HEAD`.
- `catalogs/0.33.13-1/keyboards/0009.json` — the published catalog's `mode/m256wh` entry,
  parsed via `python3 json.load` this session.
- `.claude/worktrees/phase-4-socd/` — the existing Phase 4 implementation (branch
  `worktree-phase-4-socd` @ `683270f`): `docs/adr/0005-...md`,
  `packages/domain/src/socd.ts`, `packages/domain/src/validate.ts`,
  `packages/qmk-socd-module/src/index.ts`,
  `packages/qmk-socd-module/module/qmkweb/socd_cleaner/{socd_cleaner.c,socd_resolve.h,qmk_module.json}`,
  `services/worker/scripts/socd-compile-matrix.ts`,
  `apps/web/src/components/SocdPanel.tsx`, `apps/api/src/routes/catalog.ts`,
  `services/worker/src/queue-runner.ts`, `packages/qmk-sandbox/src/docker-sandbox.ts`,
  `README.md` diff.
- `apps/api/migrations/{002_builds.sql,003_worker_role.sql}` — current schema and
  worker-role grants.
- `infra/qmk/scripts/container-entrypoint.sh`, `infra/qmk/manifest.json`,
  `infra/qmk/manifest.ts`, `infra/qmk/scripts/fetch-qmk.ts` — build image and pinned-tree
  provisioning mechanism.
- `claude.md` — SPEC-tier product rules (§ SOCD Cleaner integration, § Curated module
  registry, rules 9–10).
- `.planning/phases/04-verified-socd-support/04-CONTEXT.md`,
  `.planning/REQUIREMENTS.md`, `.planning/STATE.md` — required upstream reading.

### Secondary (MEDIUM confidence)
- None — no web search was needed or performed; this phase's uncertainty is entirely
  resolvable by reading the pinned tree and the existing branch, both available locally.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new stack decisions; ADR 0001/0003/0004 unchanged
- Architecture: HIGH — every claimed QMK mechanism verified by reading the pinned tree
  directly this session, not from training memory
- Pitfalls: HIGH — all six pitfalls are backed by a direct file read/diff this session,
  not inference

**Research date:** 2026-09-02
**Valid until:** Until the QMK pin (`0.33.13`) changes or the branch is merged/altered —
this research is tied to a specific commit and a specific branch state, not a
time-based expiry. Re-verify the "byte-identical" merge claim (Pitfall 1) immediately
before merging if any further commits land on `main` in the interim.
