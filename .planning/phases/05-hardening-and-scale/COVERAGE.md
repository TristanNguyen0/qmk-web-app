# Phase 05 — API Coverage Declaration

**Decided:** 2026-09-02 by `/gsd-plan-phase 05`
**Verdict:** No external API integration.

No external API integration: this phase adds in-process abuse controls (SQL admission
control, a Fastify rate-limit hook), a local compile-matrix runner over the already-pinned
build image, declarative GitHub Actions workflow files, `pg_dump`/`pg_restore` against the
project's own Postgres, and an OpenTelemetry SDK that *emits* to an operator-chosen OTLP
collector — it integrates no third-party service whose capability surface a matrix would
enumerate.

## Why the detector fired, and why it is a false positive

The `api-coverage` detector returned `detected: true` on two signals, both internal:

| Signal | Why it is not an external API integration |
|--------|-------------------------------------------|
| "OpenTelemetry SDK" | OTel is a **library**, not a service. `@opentelemetry/sdk-node` + the OTLP exporters are linked into `apps/api` and `services/worker` as dependencies. The receiving collector is explicitly a deployment concern (`ADR-0001-observability`: "avoid premature vendor lock-in"), is not chosen by this phase, and has no capability surface this repository consumes. Nothing in the codebase calls a vendor endpoint or reads a vendor response. |
| A reference to this project's own HTTP API | `/v1/configurations`, `/v1/builds` etc. are **first-party**. This phase modifies them; it does not integrate against them as a third party. |

## What the phase touches instead of an external API

- **Postgres** (`postgres:16-alpine`, already pinned in `infra/deploy/docker-compose.yml`) — via
  `pg`, already a dependency since Phase 2. Admission-control SQL, backups via the database's
  own `pg_dump`/`pg_restore`.
- **Docker** on the build host — via the existing `@qmk-web-app/qmk-sandbox` `DockerSandbox`,
  unchanged by this phase.
- **GitHub Actions** — declarative YAML consumed *by* GitHub. This repository calls no GitHub
  API. Branch protection and self-hosted-runner registration are repository settings a human
  applies through the GitHub UI (`05-06-PLAN.md`, `checkpoint:human-action`); the `gh` CLI is
  not installed on this host and no plan depends on it.
- **Trivy / `pnpm audit`** — CLI scanners invoked in CI. Their vulnerability databases are
  fetched by the tools themselves; no application code calls them.

## Re-open trigger

If a later phase adds a hosted collector SDK with vendor-specific configuration (Honeycomb,
Datadog, Grafana Cloud), an S3-compatible artifact store (`ADR-0004-artifact-store`'s deferred
branch), or an authentication provider (deferred by `D-01`), that phase must produce a real
capability matrix rather than reusing this declaration.
