# Deployment requirements

This is the answer to "what does this need from me before I point strangers at it." Until this
document existed, that answer was spread across four runbooks
(`docs/runbooks/backup-restore.md`, `docs/runbooks/observability.md`,
`docs/runbooks/ci-runner.md`), two ADRs (`docs/adr/0004-the-builds-table-is-the-queue.md`,
`docs/adr/0006-anonymous-only-launch-identity.md`), and a source-file header
(`apps/api/src/server.ts`). It collects them into one place.

`infra/deploy/docker-compose.yml` says outright in its own header that it is a development file
and nothing in it is suitable for deployment — trivial credentials, everything bound to
loopback. This document is what sits in front of that gap.

Each requirement below states three things: what must be provided, what fails without it, and
how loudly — because this phase deliberately made some failures loud (a process that refuses to
start) and left others silent (a request that is served, quietly wrong), and the difference is
the useful information a deployer needs.

## `QWA_SESSION_SECRET`

**Required in every environment. There is no fallback anywhere in the tree.** It signs the
session cookie that carries `ownerId` — the value every configuration, build, log, and artifact
read and write is authorized against.

Generate one with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

At least 32 bytes of real randomness, as the command above produces. A weak or shared secret
lets anyone forge a valid session cookie for any owner id and read or overwrite another
session's configurations — the entire authorization model in `ADR-0001-auth` rests on this value
being unguessable and private to this deployment.

**Failure mode: loud.** `apps/api/src/server.ts` calls `requireEnv('QWA_SESSION_SECRET', ...)`
before it does anything else; if the variable is absent or empty, the process prints the
variable's name and the generation command above, then exits with status 1. It never starts with
a fallback secret, in development or otherwise.

## The trusted reverse-proxy hop — `QWA_TRUST_PROXY`

**A reverse proxy that sits in front of the API and sets `X-Forwarded-For`, and
`QWA_TRUST_PROXY` naming exactly that hop.** `request.ip` — the value the session-issuance rate
limit (`SESSION_LIMITS.issuancePerIpPerHour`) and, transitively, the abuse controls this phase
built are keyed on — is only as trustworthy as this value is correctly configured.

Accepted forms, parsed by `apps/api/src/config.ts`'s `parseTrustProxy`: a single IPv4/IPv6
address, a CIDR (`10.0.0.0/8`), or a comma-separated list of either. **Every boolean-ish spelling
— `true`, `false`, `1`, `0`, `yes`, `no` — is rejected on purpose,** with a message explaining
why: `trustProxy: true` means "trust every hop," which lets a client set `X-Forwarded-For` itself
and claim any address it likes, defeating every IP-scoped control this phase added.

**Failure mode in production: loud.** Unset in production, the process prints an explanation and
exits with status 1 before it starts. A boolean-ish value at any time is rejected the same way,
production or not.

**Failure mode if the proxy does not do its part: silent, and silent in two opposite
directions** — this is the pair of facts worth remembering, because they cancel out any
intuition that "it's probably fine either way":

- If the named proxy does not actually set `X-Forwarded-For` on requests it forwards, every
  request arrives at the API looking like it came from the proxy's own socket address.
  `request.ip` collapses to one value for every real visitor, so the per-IP session-issuance
  limit is now a *site-wide* limit — a busy but entirely legitimate day can lock out every new
  visitor at once, and nothing in the logs says why beyond a rising count of `RATE_LIMITED`
  responses.
- If the named proxy sets the header but does not strip an inbound one a client sent itself,
  a client can set its own `X-Forwarded-For` and have it honored as `request.ip`. Every IP-scoped
  control this phase built — the session-issuance limiter specifically — is defeated at that
  point, silently: nothing fails, nothing logs an error, the limiter simply keys on whatever
  address the client claims.

Neither failure produces an error, a non-2xx response, or a log line naming the cause. The only
way to know the reverse proxy is configured correctly is to test it directly against the deployed
proxy, not to trust that `QWA_TRUST_PROXY` being set at all is sufficient.

## `QWA_OTEL_EXPORTER_URL` and a collector — optional

An OpenTelemetry Collector, Grafana Alloy, or any OTLP/HTTP-speaking vendor agent. The exact
choice is deliberately not made by this codebase (`ADR-0001-observability` treats it as a
deployment concern, to avoid a premature vendor lock-in).

Set `QWA_OTEL_EXPORTER_URL` to that collector's OTLP/HTTP metrics endpoint — a URL shaped like
`http://<collector-host>:4318/v1/metrics`. Both `apps/api/src/server.ts` and
`services/worker/src/main.ts` read it at startup, before anything that could record a metric.

**Failure mode: none — this variable is optional, and unset is a fully supported state.** Leave
it unset and telemetry is inert: no exporter, no reader, no provider is constructed, and every
instrument call becomes the OpenTelemetry library's own no-op. Nothing about running the API, the
worker, `pnpm dev`, or the test suite requires a collector. If a collector is configured and later
becomes unreachable, exporter failures are caught internally and routed to the process's own
structured warn-level log — they never crash the process or interrupt a build.

The full query set this exports — queue depth, build throughput, failure classification, worker
liveness, and build duration — is documented in `docs/runbooks/observability.md`; that document
is the reference for what to query once a collector is in place, not this one.

## A log sink, and its retention window

Both processes write structured JSON log lines to stdout — one line per event, including a
`retention` event whenever a sweep in `QueueRunner.maintain()` deletes an expired build's
artifact or log. A deployment must attach some sink to that stdout stream: `journald`, a
log-shipping agent, a cloud logging service, or equivalent.

**The sink's own retention window is the deployment decision that matters here, and it must
outlast the horizon of the question an operator will actually ask.** `QueueRunner.maintain()`'s
retention event is how an operator answers "what did retention delete, and when" — but only for
as long as the log line survives in whatever sink holds it. See `docs/runbooks/backup-restore.md`
§ "Answering 'what did retention delete, and when?'" for the event's exact shape and how to read
it.

**Revisit trigger:** the moment an operator cannot answer "what did retention delete last month"
from the log sink — which is exactly the moment the sink's retention window falls short of that
question's horizon — is the trigger to add a durable `retention_events` table instead of relying
on the log sink alone. This is a deployment fact (how long the chosen sink keeps lines), not a
code fact, which is why the trigger lives here and not in the source.

**Failure mode: silent.** No code fails if the log sink's retention is too short — the "what did
retention delete" question simply becomes unanswerable once the relevant lines have rolled off.

## A Postgres backup schedule and a restore-drill cadence

`infra/deploy/backup.sh` backs up the application database (`configurations`,
`configuration_revisions`, `builds`, `artifacts`, and everything else in it) plus the cluster's
roles and grants, via `pg_dump -Fc` and `pg_dumpall --globals-only`. `infra/deploy/restore-drill.sh`
restores that backup into a scratch database and proves row-count parity before dropping the
scratch database again. Neither script schedules itself — a deployment must run `backup.sh` on
its own cadence and run `restore-drill.sh` immediately after every backup, per
`docs/runbooks/backup-restore.md`, which also documents the manual rebuild-from-restore checklist
a script cannot automate.

**Firmware artifacts and build logs are deliberately not backed up, and that is a sound decision,
not an omission.** They are seven-day-retention by product policy
(`BUILD_LIMITS.artifactRetentionMs`/`logRetentionMs`, `packages/domain/src/limits.ts`) and
deterministically reproducible: every build row carries the catalog version, QMK commit,
generator version, and build image digest needed to reproduce the same firmware from its
configuration revision. Backing up the blob would duplicate what a rebuild already provides
without buying additional durability.

**Failure mode: silent, until the day a restore is actually needed.** Nothing in the application
enforces that a backup schedule or restore drill exists — a deployment that skips this has a
working database right up until it does not, at which point the absence of a tested backup is
discovered under the worst possible conditions. `docs/runbooks/backup-restore.md`'s own framing:
"a backup that has never been restored is a hope, not a guarantee."

## A CI runner and branch protection

D-06 puts CI (`.github/workflows/ci-fast.yml`, `.github/workflows/ci-matrix.yml`) on a
self-hosted runner, because the runner needs the pinned Docker build image and the pinned QMK
checkout the matrix job compiles against. `docs/runbooks/ci-runner.md` covers registration,
labels, the image-refresh process, the runner-offline procedure, and the exact branch-protection
configuration (`fast` and `matrix-result` as required checks — never `matrix` itself, which is
path-conditional and sometimes legitimately skips).

**Restated in this document's own terms, because it becomes a hard deployment constraint the day
this stops being a solo repository: the self-hosted runner must never execute a fork pull
request.** Being a member of the runner host's `docker` group is host-root-equivalent — any
process that can reach the Docker socket can mount the whole host and read or write anything on
it. `docs/runbooks/ci-runner.md` documents two independent controls that enforce this (a
repository setting requiring approval for outside collaborators, and an in-workflow guard that
fails explicitly rather than skipping), and states plainly that the repository-setting control
alone is a human control that can be socially engineered — both must hold.

**Failure mode if the runner is offline: loud, in the sense that nothing merges** — GitHub leaves
the required checks queued rather than failing them, so branch protection simply waits forever.
Nothing merges until the runner is back, or until someone deliberately and visibly lifts the
branch-protection requirement and records that decision (never done silently).

**A known, currently-open finding, not a defect in the workflow:** the pinned
`qmk-web-app/qmk-build:0.33.13-1` image carries a real, fixable high-severity Go-toolchain
vulnerability as of this writing. The `scan` job in `ci-matrix.yml` gates on fixable high/critical
findings and will trip on the next pull request that touches a gated path, until the image is
refreshed via `docs/runbooks/ci-runner.md`'s controlled refresh process. This is the gate working
as designed.

**A separate, open fact about this gate: it has been authored and reasoned about, but it has not
yet been observed blocking a real pull request.** `local main` had not, as of this phase's close,
been pushed to `origin`, and the specific case of a broken fixture producing a genuinely
unmergeable pull request (the proof the gate blocks, not merely that it is configured to) is
still outstanding — see `docs/runbooks/ci-runner.md` and the phase's own validation record for
the exact cases still to run.

## The identity constraint

Sessions are anonymous signed cookies only — no accounts, no authentication provider, at launch
([ADR 0006](adr/0006-anonymous-only-launch-identity.md)). A deployment inherits this as a
user-facing property, not an implementation detail to paper over: a user who clears cookies, or
switches browsers or devices, loses any work they have not exported, and there is no way to reach
a configuration from a second device. The application ships an in-product notice stating this and
an export/import path as the way out; a deployment must not represent the product as having
accounts, session recovery, or cross-device access, because it does not.

## Tunable limits

These are the numeric decisions this phase made, each a **starting value with a reason**, not a
settled fact — presented here with the trigger that means it is time to revisit it, matching
`packages/domain/src/limits.ts` and `docs/matrix-selection.md` exactly.

| Limit | Value | Trigger to revisit |
| --- | --- | --- |
| `BUILD_LIMITS.maxGlobalActiveBuilds` (global build queue-depth cap) | `8` | Raise it in proportion to worker count when more than one worker runs — not in response to a single busy hour. Queue depth is directly a wait time (depth × mean compile time ÷ worker count); with one worker compiling one build at a time, `8` is a worst case of roughly 8–16 minutes for the last person in line. |
| `SESSION_LIMITS.issuancePerIpPerHour` (session-issuance rate limit) | `120` per rolling hour | This counter is in-process — with more than one API process, the effective limit multiplies by the process count. Revisit if the deployment runs more than one API process and the multiplied effective limit no longer matches the intent, or if a genuine high-traffic single address (a large office or campus NAT) needs headroom above `120`/hour. The global build cap, enforced in Postgres, is the control that holds regardless. |
| Curated smoke-matrix size cap (`docs/matrix-selection.md`, criterion 6) | `8` distinct keyboards | A ninth member requires either removing one or deliberately raising the cap in `docs/matrix-selection.md`, reviewed against all six selection criteria — never a silent addition. |

None of these three numbers is a finding about what is safe; each is a deliberate, documented
starting point for a single-host, single-worker deployment, with the fact that would justify
changing it named next to the number.
