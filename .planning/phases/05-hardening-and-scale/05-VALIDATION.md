---
phase: 05
slug: hardening-and-scale
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-02
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by `/gsd-plan-phase` from `05-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^2.1.8 |
| **Config file** | `vitest.config.ts` (repo root) — `include: ['packages/**/*.test.ts', 'services/**/*.test.ts', 'apps/**/*.test.ts']`, `testTimeout: 30_000` |
| **Quick run command** | `pnpm test` (runs `vitest run`) |
| **Full suite command** | `pnpm test` (single suite; integration tests self-gate on `QWA_INTEGRATION` / Postgres reachability) |
| **Estimated runtime** | ~60 seconds (unit path; integration tests self-skip without Postgres/Docker) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test`, plus (once it exists) the new CI matrix workflow via a draft-PR dry run
- **Before `/gsd-verify-work`:** Full suite green AND the new CI required check green on at least one real PR
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

> Task IDs are assigned by the planner. Rows below are seeded from research and are
> re-anchored to concrete task IDs by `/gsd-validate-phase`.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | REQ-hardening-abuse-controls | TBD | N simultaneous build-creation calls against a global cap of K produce exactly K accepted builds; the rest return `BUILD_QUEUE_LIMITED` | integration (real Postgres) | `pnpm test -- store-contract` | ❌ W0 (file exists, assertion does not) | ⬜ pending |
| TBD | TBD | TBD | REQ-hardening-abuse-controls | TBD | Session-issuance IP limit rejects a burst from one IP but not a returning cookie-holder | integration (Fastify inject) | `pnpm test -- session` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REQ-hardening-abuse-controls | TBD | Production start-up fails loudly when `trustProxy` is unconfigured | unit | `pnpm test -- server` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REQ-smoke-matrix | — | `run-matrix.ts` fails if a `MODULE_REGISTRY.verifiedFor` entry has no fixture | unit | `pnpm test` | ❌ W0 (guard exists in-script, not unit-testable) | ⬜ pending |
| TBD | TBD | TBD | REQ-smoke-matrix | — | Two builds of the designated reproducibility fixture are byte-identical | integration (Docker + QMK image) | matrix runner entry point | ✅ (exists in `smoke-build.ts`) | ⬜ pending |
| TBD | TBD | TBD | REQ-observability-telemetry | — | Redaction applies to every telemetry sink as it applies to stored logs | unit | `pnpm test -- redact` | ❌ W0 (new-sink case) | ⬜ pending |
| TBD | TBD | TBD | REQ-backup-retention-controls | — | A retention sweep records what it deleted, queryable after the fact | unit | `pnpm test -- queue-runner` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REQ-launch-identity-model | — | Data-loss notice renders persistently and non-dismissably on the configurations list and editor chrome | unit (component) | `pnpm test` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REQ-launch-identity-model | — | Import routes through `validateConfiguration`; client-supplied `id` / `ownerId` / `revision` / `schemaVersion` are rejected | unit | `pnpm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/api/src/builds/store-contract.test.ts` — extend with concurrency assertions for the atomic admission-control insert (global cap + both per-owner caps)
- [ ] `apps/api/src/session.test.ts` (new) — session-issuance IP rate-limit behavior
- [ ] A fast, Docker-free unit test for the "every `verifiedFor` record needs a fixture" guard, separate from the slow real-compile matrix run
- [ ] `services/worker/src/queue-runner.test.ts` — assert `maintain()` produces a durable retention record (verify at plan time whether this file already exists)
- [ ] Export/import round-trip and rejection tests for `REQ-launch-identity-model` (D-03)
- Framework install: **none** — Vitest is already the project's framework

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Restore drill: restore Postgres to a scratch database and re-run a build | REQ-backup-retention-controls | Requires a real backup artifact and a scratch database; destructive setup unsuitable for CI | Take a backup, restore into a scratch DB, re-run a build from a restored configuration revision, assert firmware is produced |
| The merge gate is literally blocking | REQ-smoke-matrix | Branch protection is a GitHub repository setting, not observable from the codebase | Open a PR touching the generator with a deliberately broken fixture; confirm merge is blocked by the required check |
| Operator can see queue depth, throughput, failure classification, worker liveness | REQ-observability-telemetry | Requires a running OTLP collector | Point the exporter at a collector, run builds, confirm all four signals arrive and are redacted |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
