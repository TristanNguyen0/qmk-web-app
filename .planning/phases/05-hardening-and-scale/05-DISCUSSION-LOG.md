# Phase 5: Hardening and Scale - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-02
**Phase:** 05-hardening-and-scale
**Areas discussed:** Launch identity model, Smoke matrix + merge gate, Abuse controls
**Area offered but not selected:** Telemetry + operator surface

---

## Area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Launch identity model | Accounts vs anonymous-only; criterion 5, the biggest fork in the phase | ✓ |
| Smoke matrix + merge gate | Which boards, and what enforces "cannot merge" given no CI exists | ✓ |
| Abuse controls | What gets counted, on which axis, what a throttled caller sees | ✓ |
| Telemetry + operator surface | OTLP vs Prometheus; whether a dashboard ships | |

**Notes:** Backups/restore drills and dependency-scanning + licensing review were offered as
Claude's-discretion defaults in the preamble and not pulled in.

---

## Launch identity model

### Q1 — Accounts, or anonymous-only as a stated constraint?

| Option | Description | Selected |
|--------|-------------|----------|
| Anonymous-only, made honest | Anonymous stays the launch model; the phase stops it being a silent trap via an in-product statement plus an export/import path. No auth dependency, no UI contract, no login surface | ✓ |
| Real accounts | Second-device access. ADR-0001-auth makes the server change narrow, but adds a provider decision, an anonymous→account migration path, sign-in UI, and a UI contract | |
| Anonymous + recovery code | A one-time secret adopts an ownerId in another browser. Second-device story without a provider, but a leaked code is unrevokable takeover and it's a bespoke auth primitive | |

**User's choice:** Anonymous-only, made honest.

### Q2 — What form does "visible in-product" take?

| Option | Description | Selected |
|--------|-------------|----------|
| Persistent, non-dismissable line | Permanent line on the configurations list and editor chrome. A dismissed warning is indistinguishable from no warning by the time it matters | ✓ |
| First-visit notice, dismissable | Less noise, but the dismissal lives in the at-risk cookie, so the user most likely to be hurt never sees it again | |
| Dedicated data page, linked | Room to explain retention in one authoritative place, but a link is not a warning — an addition, not a substitute | |

**User's choice:** Persistent, non-dismissable line.

### Q3 — Does export/import ship here, or is that scope creep?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — export and import both | Turns anonymous-only from a limitation into a defensible choice. Import reuses validateConfiguration so untrusted JSON never bypasses the schema | ✓ |
| Export only | Smaller surface, no untrusted-JSON entry point. But a backup you cannot restore is a weak promise | |
| Neither — statement only | Strictly all criterion 5 asks for; keeps the phase to hardening. Leaves people no way to save their work | |

**User's choice:** Yes — export and import both.
**Notes:** Scope was checked explicitly rather than assumed; the user chose to widen it deliberately.

### Q4 — Session-cookie hardening in scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — secret, SameSite, and lifetime | Remove the hardcoded fallback, set SameSite explicitly, decide an explicit Max-Age | ✓ |
| Yes, but secret and SameSite only | Fix the two flagged defects, leave lifetime alone | |
| No — handle under the security review | Keeps the identity decision clean, risks two concrete defects dissolving into a vaguer task | |

**User's choice:** Yes — fix both, plus cookie lifetime.
**Notes:** Established afterwards that `Max-Age` is already a deliberate one year in
`apps/api/src/session.ts`, so the lifetime item became a review rather than a change.

### Q5 — Does the new frontend surface warrant a UI contract?

| Option | Description | Selected |
|--------|-------------|----------|
| No — it's small enough | A status line and a download/upload control; apps/web already has the patterns | ✓ |
| Yes — run /gsd-ui-phase 5 | Pins the notice wording, placement, and import error states. This is the one screen where wrong tone actively misleads someone about whether their work is safe | |

**User's choice:** No — noted as a UI surface in CONTEXT.md instead.

---

## Smoke matrix + merge gate

**Facts established before the questions:** the build image is 3.73 GB and QMK source is not baked
in (mounted read-only at `/qmk`); there is no `.github/` directory; two compile scripts already exist
with their own fixture tables.

### Q1 — Where does the gate run?

| Option | Description | Selected |
|--------|-------------|----------|
| Self-hosted runner on the build host | Docker, the image, and the pinned checkout are already there, so a run costs the compiles only. Branch protection makes "cannot merge" literal. Must never execute fork PRs | ✓ |
| Hosted runners + image in GHCR | Survives the machine being off, but adds registry auth, a publish step in the QMK refresh process, and a multi-GB pull plus QMK clone per run | |
| No CI — local script + documented rule | Zero infrastructure, but "cannot merge" becomes "remembered to run" and a hook is skippable | |

**User's choice:** Self-hosted runner on the build host.

### Q2 — Relationship to the two existing compile scripts?

| Option | Description | Selected |
|--------|-------------|----------|
| One matrix runner, several fixture sets | Extract the machinery both scripts duplicate; SOCD becomes one fixture set; adding a board becomes a table edit | ✓ |
| New script beside the existing two | Touches nothing existing — notable since socd:matrix backs MODULE_REGISTRY — at the cost of a third drifting copy | |
| Smoke matrix subsumes both | Cleanest end state, riskiest: socd:matrix carries a registry invariant that must survive the merge | |

**User's choice:** One matrix runner, several fixture sets.
**Notes:** The registry-fixture invariant was called out in both the rejected and selected options and
is carried into CONTEXT.md as a constraint on D-07.

### Q3 — Which keyboards earn a slot?

| Option | Description | Selected |
|--------|-------------|----------|
| Toolchain and bootloader diversity | Extend from crkbd/rev1 (AVR) and mode/m256wh (ARM/STM32) across MCU families, bootloaders, layout shapes. Criteria written down | ✓ |
| Grow only on evidence, start at two | Shortest runtime and every entry earned, but thin protection for 3,748 catalogued keyboards | |
| Most-used boards | Aligns with user impact, but no popularity signal exists in the pinned catalog — the list would be invented | |

**User's choice:** Toolchain and bootloader diversity.

### Q4 — What triggers the matrix?

| Option | Description | Selected |
|--------|-------------|----------|
| Path-filtered, plus a fast always-on check | Matrix on generator/pin/templates/image changes; typecheck+vitest always. Skip path must report explicitly or a required check blocks forever or passes vacuously | ✓ |
| Run on every PR | No filter to silently miss a file; costs a full run on a README typo, which is how gates get switched off | |
| Manual dispatch or a label | Full control, but enforcement lives in remembering — the state the phase is leaving | |

**User's choice:** Path-filtered, plus a fast always-on check.

### Q5 — What must a matrix entry prove?

| Option | Description | Selected |
|--------|-------------|----------|
| Compile once; reproducibility on one board | Every entry produces firmware; one designated entry builds twice for byte-identical output. Determinism belongs to the generator and image, not a keyboard | ✓ |
| Every entry builds twice | Strongest claim, would catch board-specific nondeterminism; doubles the gate's wall clock | |
| Compile success only | Fastest, but moves reproducibility outside the thing that blocks merges | |

**User's choice:** Compile once; reproducibility on one designated board.

---

## Abuse controls

**Facts established before the questions:** `BUILD_QUEUE_LIMITED` already maps to HTTP 429
(`apps/api/src/errors.ts:27`); no `trustProxy` and no use of `request.ip` anywhere in the API; the
per-owner quota at `apps/api/src/builds/service.ts:125` is a read-then-check.

### Q1 — What does the global limit limit, and where?

| Option | Description | Selected |
|--------|-------------|----------|
| Queue depth, enforced in SQL at insert | Depth is what protects the single host; SQL enforcement can't race and works with more than one API process | ✓ |
| Running-build concurrency only | Protects CPU/memory directly, but an unbounded queue turns a burst into a long tail — absorption in name only | |
| Both caps, separate numbers | Most precise, two constants to keep consistent and a needed story for which produced a rejection | |

**User's choice:** Queue depth, enforced in SQL at insert.

### Q2 — Which axis catches "many fresh sessions"?

| Option | Description | Selected |
|--------|-------------|----------|
| Rate-limit session issuance per IP | Attacks the vector at its source in the one place it happens; makes existing per-owner quotas meaningful again. Needs a generous limit for NAT | ✓ |
| Per-IP build quota as well | Most direct reading of criterion 1, but doubles quota bookkeeping and stores addresses on build rows | |
| No IP axis — global cap only | Simplest and stores nothing, but one abuser can consume the whole global budget | |

**User's choice:** Rate-limit session issuance per IP.

### Q3 — Fix the existing read-then-check race?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — make both quotas atomic | Same reasoning ADR-0004-idempotency applied when idempotency became a unique index | ✓ |
| Global cap only; leave per-owner as-is | Smaller change; leaves two enforcement styles in one function | |
| Fix it separately | Keeps the change set small; risks the race outliving the hardening phase | |

**User's choice:** Yes — make both quotas atomic.

### Q4 — How does the API get a trustworthy client IP?

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit trustProxy, required in production | Fails loud if unconfigured, mirroring the session-secret guard. Prevents the silent failure of one shared bucket or a spoofable header | ✓ |
| Use the socket address as-is | Correct for direct exposure, quietly wrong behind any proxy | |
| Make it configurable, default off | Flexible, but the default path is the one where the limit silently does nothing | |

**User's choice:** Explicit trustProxy, required in production.

---

## Claude's Discretion

Recorded as defaults with reasoning in CONTEXT.md; none is user-locked.

- **Telemetry** (`REQ-observability-telemetry`) — offered as a gray area, not selected. Default: OTel
  SDK + OTLP exporter, collector as a deployment concern, redaction on every sink, dashboard optional.
- **Backups and restore drills** (`REQ-backup-retention-controls`) — Postgres only, not artifacts;
  artifacts are ephemeral and deterministically reproducible. Retention needs a durable deletion
  record that `maintain()` does not currently produce.
- **Dependency/image scanning and the QMK licensing review** — CI job on the same runner; the
  licensing review as a recorded document.
- **Open numbers and mechanics** — the queue-depth cap, the session-issuance limit, matrix size cap,
  runner provisioning, whether the catalog build belongs in CI, whether a failing matrix entry can be
  quarantined.

## Deferred Ideas

No scope creep was raised — the discussion stayed inside the phase boundary. Four items surfaced
during codebase scouting (not raised by the user) are recorded in CONTEXT.md `<deferred>` so they are
not lost: unbounded session/configuration growth, the orphaned artifact reaper, the untested
`KeymapEditor`/`BuildPanel` components, and the missing `configuration_revisions` index.
