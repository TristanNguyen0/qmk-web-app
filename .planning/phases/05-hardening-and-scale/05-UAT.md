---
status: partial
phase: 05-hardening-and-scale
source: [05-VERIFICATION.md]
started: 2026-09-04T00:20:00Z
updated: 2026-09-04T00:17:38Z
---

## Current Test

[testing paused — 2 items outstanding]

## Tests

### 1. OTLP metrics reach a live collector
expected: Set `QWA_OTEL_EXPORTER_URL` to a real OTLP/HTTP collector endpoint (OpenTelemetry Collector, Grafana Alloy, or a vendor agent), start the API and worker, and run a handful of builds through to terminal states (succeeded, failed, cancelled). Confirm the collector receives `qwa.builds.queue_depth`, `qwa.builds.completed`, `qwa.builds.failed`, and `qwa.worker.heartbeat`, with `service.name` distinguishing the API from the worker. Confirm redaction holds — no free-text, IP, or path content in any attribute.
why_human: No OTLP collector was available to the executor or the verifier. The SDK bootstrap, attribute allowlist, and worker-side redaction are unit-tested against an in-memory exporter, so the internal plumbing is proven — but no metric has ever left the codebase over the network. "Exported" is the one word in Success Criterion 2 never exercised.
result: blocked
blocked_by: server
reason: "blocked" — no OTLP/HTTP collector endpoint available to run the export against.

### 2. The CI merge gate actually blocks a real pull request
expected: Push the repository to origin, then open a real pull request editing a gated path (e.g. `services/worker/scripts/run-matrix.ts`) with a deliberately broken fixture. Confirm GitHub reports the PR as not mergeable while `matrix-result` is red. Separately confirm a docs-only PR is not blocked forever (`matrix-result` reports success with the not-applicable message), and that a fork PR fails the gate explicitly rather than being skipped.
why_human: `main` is 102 commits ahead of `origin/main` and `gh` is not installed on this host, so 05-06's Task 4 was never performed. The workflow YAML was independently re-read and confirmed well-built, and the matrix compiled for real in 05-02 — but "cannot merge" is a GitHub repository-setting behavior no codebase inspection can prove. Expect the Trivy `scan` gate to trip on the pinned image's fixable high-severity Go-toolchain CVE until that image is refreshed.
result: blocked
blocked_by: third-party
reason: "blocked" — repository not pushed to origin and no GitHub PR could be opened, so the merge gate could not be exercised.

## Summary

total: 2
passed: 0
issues: 0
pending: 0
skipped: 0
blocked: 2

## Gaps
