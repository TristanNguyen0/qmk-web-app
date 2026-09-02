# Phase 4: Verified SOCD Support - Pattern Map

**Mapped:** 2026-09-02
**Files analyzed:** 12 (branch-merge landing + gap-closure files)
**Analogs found:** 12 / 12

**Framing note:** This phase is reconciliation-plus-gap-closure, not greenfield (per
CONTEXT.md/RESEARCH.md). Most "new" files are files the branch `worktree-phase-4-socd`
already implements at `.claude/worktrees/phase-4-socd/...`; those files are themselves
each other's best "analog" — the planner's job is a small, targeted diff against them, not
a from-scratch build. Where a file is genuinely net-new work beyond the branch (D-01
registry consolidation, D-02/D-03/D-04 gap closures, the `mode/m256wh` fixture,
`04-VERIFICATION.md`), the analog is the closest *existing main-tree pattern* for that
role, plus the branch file as the nearest prior art.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/domain/src/socd.ts` (extend `socdCapabilitiesFor`) | service/domain-logic | request-response (pure function) | `.claude/worktrees/phase-4-socd/packages/domain/src/socd.ts` (prior art) + `packages/domain/src/validate.ts` (main, for catalog-scoped lookups) | exact (branch) |
| `packages/domain/src/module-registry.ts` (new, D-01) | model/config | CRUD (static registry read) | `.claude/worktrees/phase-4-socd/packages/domain/src/socd.ts` (fields to consolidate) | role-match (new structure, familiar fields) |
| `packages/domain/src/validate.ts` (extend prerequisite check) | service/domain-logic | request-response | `.claude/worktrees/phase-4-socd/packages/domain/src/validate.ts` (prior art, exact) | exact (branch) |
| `apps/api/src/routes/catalog.ts` (thread `catalogVersion` into `socdCapabilitiesFor`) | route/controller | request-response | `.claude/worktrees/phase-4-socd/apps/api/src/routes/catalog.ts` (prior art, exact) | exact (branch) |
| `apps/api/migrations/004_socd_module_version.sql` (new, D-03) | migration | CRUD (schema change) | `apps/api/migrations/002_builds.sql`, `apps/api/migrations/003_worker_role.sql` (main) | exact |
| `services/worker/src/queue-runner.ts` (extend `complete()` call + `CompleteBuildArgs`) | service | event-driven (queue completion) | `services/worker/src/queue-runner.ts` (main, self — extend existing `complete()` call) + `packages/build-queue/src/types.ts` (`CompleteBuildArgs`) | exact |
| `packages/build-queue/src/types.ts` (add `socdModuleVersion` to `CompleteBuildArgs`) | model/type | CRUD | `packages/build-queue/src/types.ts` (main, self — mirror `generatorVersion` field) | exact |
| `packages/qmk-sandbox/src/docker-sandbox.ts` (no app-code change; consumes new `checks` key) | service | request-response (spawn+parse) | `.claude/worktrees/phase-4-socd/packages/qmk-sandbox/src/docker-sandbox.ts` `verify()` (prior art, exact) | exact (branch) |
| `infra/qmk/scripts/container-entrypoint.sh` (`verify-env` verb: add `module_hook_api_version_ok` check, D-04) | config/script | request-response (subprocess) | `infra/qmk/scripts/container-entrypoint.sh` (main, self — extend `checks` dict) | exact |
| `services/worker/scripts/socd-compile-matrix.ts` (add `mode/m256wh` fixture) | script/test-fixture | batch (compile matrix) | `.claude/worktrees/phase-4-socd/services/worker/scripts/socd-compile-matrix.ts` (prior art, exact — `FIXTURES['crkbd/rev1']` is the template) | exact (branch) |
| `apps/web/src/components/SocdPanel.tsx` (add mod-tap sentence, Pitfall 3) | component | request-response (render) | `.claude/worktrees/phase-4-socd/apps/web/src/components/SocdPanel.tsx` (prior art, exact) | exact (branch) |
| `.planning/phases/04-verified-socd-support/04-VERIFICATION.md` (new, D-08) | doc/evidence record | file-I/O (static record) | No existing analog in repo — new evidence-record shape; use CONTEXT.md D-08 field list directly | no analog |
| `packages/qmk-socd-module/src/index.ts`, `module/qmkweb/socd_cleaner/*` (land as-is from branch) | utility/model | file-I/O | `.claude/worktrees/phase-4-socd/packages/qmk-socd-module/src/index.ts` (prior art, exact — land verbatim) | exact (branch) |

## Pattern Assignments

### `packages/domain/src/socd.ts` — extend `socdCapabilitiesFor` for `catalogVersion` (D-02)

**Analog:** `.claude/worktrees/phase-4-socd/packages/domain/src/socd.ts:126-160` (current shape,
to be extended, not replaced)

**Current signature and gap** (lines 126-160, quoted in full above during mapping):
```typescript
export const SOCD_VERIFIED_KEYBOARDS: ReadonlySet<string> = Object.freeze(
  new Set(['crkbd/rev1']),
);

export function socdCapabilitiesFor(keyboardId: string): SocdCapabilities {
  if (!SOCD_VERIFIED_KEYBOARDS.has(keyboardId)) {
    return {
      available: false,
      reason: 'SOCD has not been compile-verified for this keyboard yet. ...',
      policies: [], verticalPairs: [], horizontalPairs: [],
    };
  }
  return { available: true, policies: SOCD_POLICIES, verticalPairs: SOCD_VERTICAL_PAIRS, horizontalPairs: SOCD_HORIZONTAL_PAIRS };
}
```

**Target shape (D-02, D-10):** `SOCD_VERIFIED_KEYBOARDS` becomes a structure keyed by
`(catalogVersion, qmkCommit, keyboardId)` with a `hardwareVerified: boolean` flag (D-10 —
two strengths of claim), and `socdCapabilitiesFor(catalogVersion, keyboardId)` takes the
extra parameter. Preserve the exact "empty policies + specific reason" honesty shape —
this is D-10's non-negotiable property (see Anti-Patterns in RESEARCH.md).

**Error-handling / honesty pattern to preserve exactly:** never return `available: true`
optimistically; always name a `reason` string when `available: false`.

---

### `packages/domain/src/module-registry.ts` (new, D-01)

**Analog:** the fields already scattered across `.claude/worktrees/phase-4-socd/`:
- `packages/qmk-socd-module/src/index.ts:22,28` — `SOCD_MODULE_ID = 'qmkweb/socd_cleaner'`, `SOCD_MODULE_VERSION = '1.0.0'`
- `packages/domain/src/socd.ts:126-128` — verified-keyboard set (becomes the registry's compile/hardware-verified list, D-10)
- `qmk_module.json` (license field — read via `packages/qmk-socd-module/module/qmkweb/socd_cleaner/qmk_module.json`)
- ADR 0005 (rationale, minimum hook API version — D-04)

**Core pattern — frozen literal object, matching the file's existing style:**
```typescript
// Modeled on SOCD_POLICIES's Object.freeze(...) pattern, packages/domain/src/socd.ts:22-33
export const MODULE_REGISTRY = Object.freeze({
  'qmkweb/socd_cleaner': Object.freeze({
    moduleId: 'qmkweb/socd_cleaner',
    version: SOCD_MODULE_VERSION, // from packages/qmk-socd-module
    license: '...',               // from qmk_module.json
    minimumHookApiVersion: '1.0.0', // D-04 — mirrors ASSERT_COMMUNITY_MODULES_MIN_API_VERSION(1,0,0) in socd_cleaner.c
    prerequisites: { /* ... */ },
    verifiedFor: [ /* { catalogVersion, qmkCommit, keyboardId, hardwareVerified } */ ],
  }),
});
```
Keep this **read by** the capability function (`socdCapabilitiesFor`) and the validator
(`validate.ts`), per D-01 — do not duplicate the verified-keyboard list in two places.

---

### `packages/domain/src/validate.ts` — extend `SOCD_VERIFIED_KEYBOARDS` check (D-02)

**Analog:** `.claude/worktrees/phase-4-socd/packages/domain/src/validate.ts:130-141`

**Current prerequisite-gate pattern (exact, to extend not replace):**
```typescript
if (socd.enabled) {
  if (!SOCD_VERIFIED_KEYBOARDS.has(configuration.keyboardId)) {
    throw new DomainError(
      ERROR_CODES.CAPABILITY_UNAVAILABLE,
      'SOCD has not been compile-verified for this keyboard',
      [{ path: 'socd.enabled', message: 'unavailable for this keyboard' }],
    );
  }
  // ...pair-matching, base-layer-binding checks follow, unchanged
}
```
**Extension:** the `.has(configuration.keyboardId)` check gains the `(catalogVersion,
qmkCommit)` dimension — same `DomainError(ERROR_CODES.CAPABILITY_UNAVAILABLE, ...)` shape,
just checked against the registry entry instead of a flat `Set`. Do not change the
`DomainError` error code or the "raised immediately, not collected with fieldErrors" control
flow — that distinction (capability answer vs. validation failure) is deliberate, per the
comment on line 131-134.

---

### `apps/api/src/routes/catalog.ts` — thread `catalogVersion` through (D-02)

**Analog:** `.claude/worktrees/phase-4-socd/apps/api/src/routes/catalog.ts:160-188` (exact,
land verbatim then extend one line)

**Current gap (the fix target):**
```typescript
app.get<{ Params: WildcardParams }>(
  '/v1/catalog/:catalogVersion/socd-capabilities/*',
  async (request, reply) => {
    const version = resolveVersion(store, request.params.catalogVersion);
    const keyboardId = request.params['*'];
    if (!isValidKeyboardIdShape(keyboardId)) return sendBadRequest(reply, '...');
    if (!store.getSupportedKeyboard(version, keyboardId)) return sendNotFound(reply, '...');

    const capabilities = socdCapabilitiesFor(keyboardId); // <-- version computed but unused
    return reply.send({
      apiVersion: API_VERSION, catalogVersion: version, keyboardId, ...capabilities,
      compliance: '...',
    });
  },
);
```
**Fix:** `socdCapabilitiesFor(version, keyboardId)` — one-argument change, same response
shape. Do not touch the 404/400 branches or the compliance-string pattern (rule 10, D-08).

---

### `apps/api/migrations/004_socd_module_version.sql` (new, D-03)

**Analog:** `apps/api/migrations/002_builds.sql:15-30` (column style) and
`apps/api/migrations/003_worker_role.sql` (guarded, idempotent style)

**Core pattern — additive column on `builds`, mirroring `generator_version`:**
```sql
-- builds table already has: catalog_version, qmk_commit, generator_version,
-- build_image_ref, build_image_digest (apps/api/migrations/002_builds.sql:24-29).
-- socd_module_version follows the same "reproducibility triple" precedent —
-- it traces a firmware image to the exact SOCD implementation that produced it (D-03).
ALTER TABLE builds ADD COLUMN IF NOT EXISTS socd_module_version TEXT;
```
**Grant note (verified, no grant change needed):** `qwa_worker` already has table-level
`GRANT SELECT, UPDATE ON builds` (`apps/api/migrations/003_worker_role.sql:40`), not
column-restricted — a new nullable column needs no companion grant migration.

---

### `services/worker/src/queue-runner.ts` + `packages/build-queue/src/types.ts` — provenance write path (D-03)

**Analog:** `services/worker/src/queue-runner.ts` (main, current file — self; already
structurally identical to the branch per RESEARCH.md Pitfall 1)

**Current `complete()` call (lines ~326-339 in current file), the write point to extend:**
```typescript
const completed = await queue.complete({
  buildId, workerId,
  artifact: { id: randomUUID(), storageKey: key, originalFilename: result.artifact.filename,
    byteSize: result.artifact.byteSize, sha256: result.artifact.sha256,
    contentType: result.artifact.contentType, expiresAt: /* ... */ },
  outputFormat: result.artifact.extension,
  logReference,
  buildImageRef: result.imageRef,
  buildImageDigest: result.imageDigest,
  generatorVersion: result.generatorVersion,
  // NEW: socdModuleVersion: result.socdModuleVersion ?? null,
});
```
**Type extension** — `packages/build-queue/src/types.ts:125-142` `CompleteBuildArgs`:
```typescript
export interface CompleteBuildArgs {
  // ...existing fields...
  generatorVersion: string;
  // NEW, mirrors generatorVersion exactly:
  socdModuleVersion: string | null;
}
```
`result.socdModuleVersion` itself is threaded from `run-build.ts` (where
`materializeSocdModule`/`SOCD_MODULE_VERSION` is invoked), the same way
`result.generatorVersion` already is — no new plumbing pattern needed, follow the existing
`generatorVersion` thread end to end.

---

### `packages/qmk-sandbox/src/docker-sandbox.ts` + `infra/qmk/scripts/container-entrypoint.sh` — module-hook API assertion (D-04)

**Analog:** `infra/qmk/scripts/container-entrypoint.sh` `verify-env` verb (main, current
file, lines ~52-74) — add one key to the existing `checks` dict, do not build a parallel
mechanism (Pitfall 6).

**Current pattern (exact, to extend by one key):**
```python
checks = {
    'qmk_lib_python': os.path.isdir(os.path.join(root, 'lib', 'python', 'qmk')),
    'makefile': os.path.isfile(os.path.join(root, 'Makefile')),
    'paths_mk': os.path.isfile(os.path.join(root, 'paths.mk')),
    'schemas': os.path.isdir(os.path.join(root, 'data', 'schemas')),
}
# ...qmk_userspace_supported, qmk_tree_read_only checks follow the same try/except-to-bool style...
print(json.dumps({'checks': checks, 'ok': all(checks.values())}, sort_keys=True))
sys.exit(0 if all(checks.values()) else 1)
```
**Extension:** add `checks['module_hook_api_version_ok'] = <compare highest
data/constants/module_hooks/*.hjson version against registry's minimumHookApiVersion>` —
same dict-key, same `os.path`-based checking style, same `all(checks.values())` aggregate.
**Consumer side (no change needed):** `DockerSandbox.verify()` (`packages/qmk-sandbox/src/docker-sandbox.ts`,
lines ~114-124) already `JSON.parse`s the last stdout line and requires `ok === true` — the
new check flows through automatically once added to the `checks` dict.

---

### `services/worker/scripts/socd-compile-matrix.ts` — add `mode/m256wh` fixture (D-06)

**Analog:** `.claude/worktrees/phase-4-socd/services/worker/scripts/socd-compile-matrix.ts:59-71`
(the `FIXTURES['crkbd/rev1']` entry — exact template to copy and adapt)

**Core pattern — one new `FIXTURES` entry, same shape:**
```typescript
const FIXTURES: Record<string, {
  layoutId: string;
  baseKeys: readonly string[];
  directionalKeys: { up: number; down: number; left: number; right: number };
  directionalKeycodes: { up: string; down: string; left: string; right: string };
}> = {
  'crkbd/rev1': { /* existing, unchanged */ },
  'mode/m256wh': {
    layoutId: 'LAYOUT_65_ansi_blocker',
    baseKeys: [ /* full 67-position QWERTY base array, W/A/S/D + arrows in place */ ],
    // Verified position indices, RESEARCH.md Code Examples section:
    directionalKeys: { up: 17 /* W */, down: 32 /* S */, left: 31 /* A */, right: 33 /* D */ },
    directionalKeycodes: { up: 'KC_W', down: 'KC_S', left: 'KC_A', right: 'KC_D' },
  },
};
```
**Note:** the script already fails loudly (`missingFixtures` check, lines 74-80) if
`SOCD_VERIFIED_KEYBOARDS` names a keyboard with no fixture — so `mode/m256wh` must be added
to both the registry/verified-set *and* `FIXTURES` together, never one without the other.
Everything downstream (build loop, `runBuild`, failure reporting) is keyboard-agnostic and
needs no changes.

---

### `apps/web/src/components/SocdPanel.tsx` — mod-tap sentence (Pitfall 3, closes REQ-socd-policy-choices cl.5)

**Analog:** `.claude/worktrees/phase-4-socd/apps/web/src/components/SocdPanel.tsx:248-262`
(exact — the "What this does" notice block, land verbatim then add one sentence)

**Current copy (land as-is, then extend):**
```tsx
<div className="notice">
  <strong>What this does</strong>
  <p>
    {activePolicy ? activePolicy.description : 'Choose a policy to see how conflicts resolve.'}{' '}
    Resolution applies to these four keys on the <strong>base layer only</strong>; on
    other layers those positions behave normally. SOCD runs before macros, so a macro's
    own keypresses are never altered.
    {/* ADD: one sentence — SOCD keys and mod-taps are mutually exclusive by construction
        on the same position (validate.ts:170 requires the exact SOCD token on the base
        layer, so a directional position bound for SOCD cannot simultaneously be a mod-tap). */}
  </p>
  <p><strong>Your responsibility:</strong> {capabilities.compliance}</p>
</div>
```
No validation-logic change required — this is documentation-only (Pitfall 3).

---

### `.planning/phases/04-verified-socd-support/04-VERIFICATION.md` (new, D-08)

**No codebase analog** — this is a new evidence-record document type. Use CONTEXT.md's D-08
field list directly as the section headings: board, firmware SHA-256, module version,
catalog version, per-check result (matching D-07's four hardware checks: simultaneous
opposite press; both release orderings; base-layer-only rule on a raised layer; one macro
typing a direction key), date. If the hardware run cannot happen this cycle, state that
plainly per D-09 (do not write "Done").

---

### `packages/qmk-socd-module/` (land as-is from branch)

**Analog:** `.claude/worktrees/phase-4-socd/packages/qmk-socd-module/src/index.ts` (exact —
`SOCD_MODULE_ID`, `SOCD_MODULE_VERSION`, `SOCD_MODULE_FILES`, `SOCD_MODULE_DIGESTS`,
`verifySocdModuleIntegrity`, `materializeSocdModule`). This package is complete on the
branch and needs no gap-closure work of its own beyond being merged; `SOCD_MODULE_VERSION`
is the exact value D-03 threads into the build/artifact record.

**Integrity pattern to preserve exactly (SHA-256 digest pinning, `wx` write flag):**
```typescript
export function verifySocdModuleIntegrity(): void {
  for (const file of readSocdModuleFiles()) {
    const pinned = SOCD_MODULE_DIGESTS[file.name];
    if (pinned !== file.sha256) {
      throw new SocdModuleError(`SOCD module file ${file.name} does not match its reviewed digest ...`);
    }
  }
}
export function materializeSocdModule(userspaceDir: string): string[] {
  verifySocdModuleIntegrity();
  // ...
  writeFileSync(target, file.contents, { mode: 0o640, flag: 'wx' }); // never silently overwrite
}
```

## Shared Patterns

### Honest unavailability (capability gating)
**Source:** `packages/domain/src/socd.ts:143-160` (`socdCapabilitiesFor`), extended by
`packages/domain/src/validate.ts:130-141`
**Apply to:** `module-registry.ts`, the extended `socdCapabilitiesFor`, and any future
curated-module capability function. Always return `available: false` with a specific
`reason` string — never omit the reason, never guess availability optimistically.

### Provenance-with-build (reproducibility triple)
**Source:** `apps/api/migrations/002_builds.sql:24-29` (`catalog_version`, `qmk_commit`,
`generator_version`, `build_image_ref`, `build_image_digest`) + write path in
`services/worker/src/queue-runner.ts`'s `queue.complete({...})` call.
**Apply to:** `socd_module_version` column (D-03) — same additive-column,
same-write-point pattern; do not invent a separate provenance table.

### Startup assertion against the pinned tree
**Source:** `infra/qmk/scripts/container-entrypoint.sh` `verify-env` verb's `checks` dict +
`packages/qmk-sandbox/src/docker-sandbox.ts` `verify()` (`ok === true` gate).
**Apply to:** D-04's module-hook API version check — one new dict key, no new mechanism.

### Cross-checked tables (no drift between representations)
**Source:** `packages/domain/src/socd.ts` `MODULE_KEYCODES` vs.
`module/qmkweb/socd_cleaner/qmk_module.json` vs. the C dispatch table, asserted equal by
existing tests (per RESEARCH.md "Established Patterns").
**Apply to:** `module-registry.ts` (D-01) must not introduce a fourth, independently
maintained copy of any of these tables — it should be *read by* the capability function,
not a duplicate source of the same facts.

### Migration style (guarded, additive, idempotent)
**Source:** `apps/api/migrations/002_builds.sql`, `003_worker_role.sql`
**Apply to:** `004_socd_module_version.sql` — `ADD COLUMN IF NOT EXISTS`, comment
explaining the "why" with a claude.md citation, no destructive changes.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `.planning/phases/04-verified-socd-support/04-VERIFICATION.md` | doc/evidence record | file-I/O | New evidence-record document type; no prior phase produced hardware-verification evidence. Use CONTEXT.md D-08's field list as the template instead of a codebase analog. |

## Metadata

**Analog search scope:** `.claude/worktrees/phase-4-socd/` (the existing Phase 4
implementation branch — primary source of prior art), `packages/domain/`,
`apps/api/src/routes/`, `apps/api/migrations/`, `services/worker/src/`,
`services/worker/scripts/`, `packages/build-queue/src/types.ts`,
`packages/qmk-sandbox/src/docker-sandbox.ts`, `infra/qmk/scripts/container-entrypoint.sh`,
`apps/web/src/components/`.
**Files scanned:** 12 target files + 6 supporting reads (main-tree migrations, build-queue
types, entrypoint script).
**Pattern extraction date:** 2026-09-02
