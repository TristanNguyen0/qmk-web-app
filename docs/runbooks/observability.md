# Runbook: observability — what is exported, how to see it, and what it deliberately cannot show

`ADR-0001-observability` set a two-stage plan: structured JSON logs first, OpenTelemetry
(OTLP) exporters "before public access." This phase is that second stage. This runbook
answers the four questions criterion 2 of Phase 5 names — queue depth, build
throughput, failure classification, worker liveness — with the concrete query for
each, and records what the telemetry layer was deliberately built *not* to answer.

It is a runbook, not a reference for every instrument option; read
`apps/api/src/observability/metrics.ts` and
`services/worker/src/observability/metrics.ts` themselves for that.

## What is exported, and from where

Both processes bootstrap through a small, mirrored `otel.ts` module
(`apps/api/src/observability/otel.ts`, `services/worker/src/observability/otel.ts`) that
registers one `MeterProvider` per process against the global `@opentelemetry/api`
registry. Every exported signal carries a `service.name` resource attribute —
`qwa-api` for the API, `qwa-worker` for the worker — plus a random
`service.instance.id` per process. `service.name` is what keeps the two processes'
series distinct at the collector: group or filter by it and the API's and worker's
numbers never merge, even though several instrument names below are only ever recorded
from one of the two processes.

| Instrument | Type | Process | Attributes | Recorded from |
|---|---|---|---|---|
| `qwa.builds.queue_depth` | Observable gauge | `qwa-api` | none | `registerQueueDepthGauge()`'s callback, reading `BuildRepository.countActiveGlobal()` on every collection cycle |
| `qwa.builds.completed` | Counter | `qwa-worker` | `status` (`BuildStatus`) | `recordBuildCompleted()`, called once per terminal outcome in `QueueRunner#process` — on cancellation, on early failure, on post-compile failure, and on success |
| `qwa.builds.failed` | Counter | `qwa-worker` | `failure_code` (`BuildFailureCode`) | `recordBuildFailed()`, called alongside `recordBuildCompleted('failed')` at every failure exit point |
| `qwa.worker.heartbeat` | Counter | `qwa-worker` | `worker_id` | `recordWorkerHeartbeat()`, called at the top of every `QueueRunner#runOnce()` tick (claimed or idle) and at the top of every `maintain()` sweep |
| `qwa.builds.duration_ms` | Histogram | `qwa-worker` | `status` (`BuildStatus`) | `recordBuildDuration()`, called alongside `recordBuildCompleted()` on the post-compile success and failure paths, where a real compile duration exists |

`qwa.builds.duration_ms` is not one of criterion 2's four names, but the four are hard
to read without it — a throughput number with no duration cannot distinguish a healthy
queue from a stalled one. It rides the same bootstrap and the same allowlist as the
other four, so it costs nothing extra to keep.

Every attribute above is built through `telemetryAttributes()` — a closed allowlist,
not a redaction pass — and, on the worker side, additionally passed through
`redactAttributes()` before it reaches an instrument. See "What is deliberately not
exported" below for what that buys and what it costs.

## How to point it at a collector

Set `QWA_OTEL_EXPORTER_URL` to the OTLP/HTTP metrics endpoint of whichever collector the
deployment runs — the OpenTelemetry Collector, Grafana Alloy, or a vendor agent that
speaks OTLP. Both `apps/api/src/server.ts` and `services/worker/src/main.ts` read it at
startup, before anything that could record a metric.

**Leave it unset and telemetry is inert.** `startTelemetry()` returns a disabled handle,
constructs no exporter, no reader, and no provider, and every instrument obtained
afterward from `@opentelemetry/api`'s `metrics.getMeter(...)` is the library's own
no-op implementation — recording against it is a silent no-op, not an error. No
collector is required to run the app, `pnpm dev`, or the test suite. This is deliberate:
`ADR-0001-observability` treats the collector choice as a deployment concern, to avoid
choosing a vendor here. Nothing in this codebase assumes one is running.

Both processes flush their last export window on `SIGINT`/`SIGTERM`, alongside their
existing shutdown cleanup — a normal restart does not silently drop up to one
collection interval's worth of data points.

## The four questions and how to answer each

The queries below are PromQL, since every OTLP-compatible backend under consideration
speaks it or a close variant. Metric names use the underscore-and-suffix translation
most Prometheus-facing OTLP receivers apply to a dotted OTel instrument name (`.` →
`_`, and a `_total` suffix on counters) — the exact translated name is a property of
whichever collector and backend a deployment chooses, per `ADR-0001-observability`;
adjust the literal name to match yours if it differs.

**Queue depth.** Is the queue backing up?

```promql
qwa_builds_queue_depth
```

A gauge, so the raw value is already the answer — no `rate()` or `sum()` needed. Healthy
is comfortably below `BUILD_LIMITS.maxGlobalActiveBuilds` (`packages/domain/src/limits.ts`,
currently `8`). A value sitting at or repeatedly touching `8` means the global admission
cap is actively rejecting new build requests, not merely that the queue is busy —
`8` is the point past which `BuildRepository.create()` returns `{ outcome: 'rejected',
cap: 'global_active' }` rather than accepting the build.

**Build throughput.** How many builds are finishing, and in what final state?

```promql
sum(rate(qwa_builds_completed_total[5m])) by (status)
```

A per-status rate over a five-minute window. On a single-worker host (the current
target runtime — `PROJECT.md` § Target Runtime) throughput is bounded by one compile at
a time, so this number is primarily useful as a trend line and as the numerator half of
"how long is a build actually taking" — pair it with the duration histogram below rather
than reading it alone.

**Failure classification.** When builds fail, why?

```promql
sum(rate(qwa_builds_failed_total[5m])) by (failure_code)
```

`failure_code` is always a member of the closed `BuildFailureCode` enum
(`packages/domain/src/build.ts`) — `COMPILE_FAILED`, `TIMEOUT`, `RESOURCE_LIMIT`,
`GENERATION_FAILED`, `ARTIFACT_NOT_PRODUCED`, `ARTIFACT_REJECTED`, `SANDBOX_ERROR`, or
`CANCELLED` — so this query's result set is bounded and stable across deployments; a new
label value appearing here means a new failure code was added to the domain model, not
that a free-text error string leaked through. A sustained shift toward `SANDBOX_ERROR`
or `RESOURCE_LIMIT` is the earliest signal that the build image or the sandbox's
resource limits need attention before a user notices.

**Worker liveness.** Is the worker still doing anything?

```promql
rate(qwa_worker_heartbeat_total{worker_id="<id>"}[5m])
```

A counter rather than a gauge, deliberately: liveness is "is this still increasing", and
a rate over a counter survives a single missed export window in a way a last-value gauge
does not. **A flat line — the rate dropping to and staying at zero — means the worker
process has stopped ticking its loop and stopped running `maintain()`.** Since a tick
happens on every `runOnce()` call regardless of whether a build was claimed, a flat line
during normal operation is not "no builds queued" (queue depth answers that separately)
— it means the process itself is gone or wedged. Cross-check against the maintenance
interval (`MAINTENANCE_INTERVAL_MS`, 60 seconds, in `services/worker/src/main.ts`): a
gap longer than that with no heartbeat at all is unambiguous.

## What is deliberately not exported, and why

`telemetryAttributes()` (`apps/api/src/observability/attributes.ts`, mirrored in
`services/worker/src/observability/attributes.ts` since the worker has no dependency on
the API package) is a **closed allowlist**, not a redaction pass. It accepts exactly six
keys — `status`, `failureCode`, `cap`, `workerId`, `count`, `durationMs` — each with an
enumerated or numeric domain, and throws on anything else, naming the rejected key. An
allowlist is a stronger guarantee than a redaction pass: a regex table can miss a novel
secret shape, but a key that was never on the list is never exported at all — there is
nothing to redact because nothing textual beyond an enumerated value was ever admitted.

The following **must never** become a telemetry attribute, and the allowlist is the
mechanism that makes that true by construction rather than by convention:

- An owner or session id
- A configuration name
- A keymap binding
- A storage key
- A filesystem path
- Raw build-log text

If an operator asks "can I group failures by which user hit them" or "can I see the
configuration name in a failed build's attributes", the answer is no — not a missing
feature, a deliberate boundary. `claude.md` § Build isolation and security and
`ADR-0001-observability`'s redaction requirement are why: telemetry carries counts and
closed-enum classifications, never user content. The build id itself is not exported
either, for the same reason a storage key is not — an operator answering "why did build
`<id>` fail" reads that build's own stored, redacted log (via the API's authorized log
endpoint), not a telemetry attribute.

On the worker side, every attribute additionally passes through `redactAttributes()`
(`services/worker/src/redact.ts`) — the same path/secret substitution tables `redactLog`
applies to a stored build log — before reaching an instrument. In practice the allowlist
already admits no free text except `workerId` (an operational identity, not user
content), so this second layer rarely has anything to redact; it exists because
`ADR-0001-observability` states redaction rules apply to *every* sink added later, and a
belt-and-braces second layer is cheaper than re-deriving whether the allowlist alone is
airtight every time someone adds a key to it.

## What adding traces would take

`05-RESEARCH.md`'s Standard Stack section proposed six OpenTelemetry packages,
including `@opentelemetry/sdk-node` and `@opentelemetry/exporter-trace-otlp-proto`.
This phase installs four — `@opentelemetry/api`, `@opentelemetry/sdk-metrics`,
`@opentelemetry/exporter-metrics-otlp-proto`, and `@opentelemetry/resources` — and
deliberately does not install those two, because criterion 2 names four signals and
every one of them is a metric.

Adding traces later means installing `@opentelemetry/sdk-node` and
`@opentelemetry/exporter-trace-otlp-proto`, and accepting the constraint that comes with
`sdk-node`: the OpenTelemetry JS SDK's own documented requirement that "the SDK must be
initialized before any other module in your application is loaded." Honouring that in
this codebase's ES modules means a preload wrapper on both process entry points, because
`import` statements hoist above any `start()` call written inside the entry file itself
— a real operational change to `pnpm dev`, the worker's start command, and anyone
running either process by hand. The metrics-only bootstrap in this phase carries no such
constraint, which is exactly why it was accepted for now and traces were not.

The place to add it is the existing bootstrap module — `apps/api/src/observability/otel.ts`
and `services/worker/src/observability/otel.ts` — extended with a `NodeSDK` instance and
a trace exporter alongside the current `MeterProvider`, not a second, parallel bootstrap
path. Whoever picks this up next inherits a decision, not a blank page.

## Where the retention question is answered

"What did a retention sweep delete, and when" is answered from the structured
`retention` log event `QueueRunner.maintain()` already emits — this phase's exporter
makes the surrounding signals (worker liveness, build throughput) queryable, but the
retention record itself stays a structured log line, not a metric, for the reasons
recorded in `docs/runbooks/backup-restore.md` § "Answering 'what did retention delete,
and when?'" and § "Revisit trigger: when to add a `retention_events` table". Read that
runbook for the full procedure and its worked example.
