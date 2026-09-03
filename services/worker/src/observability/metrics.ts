/**
 * The worker's metric instruments — criterion 2's remaining three of four signals
 * (build throughput, failure classification, worker liveness), plus the duration
 * histogram that makes them readable.
 *
 * Every meter/instrument lookup here happens lazily, inside a function body, never at
 * module load time — see `apps/api/src/observability/metrics.ts`'s header for why a
 * module-scope `metrics.getMeter(...)` binding would permanently pin every instrument
 * to whatever provider (almost always the no-op one) was active at import time.
 * `Meter.createCounter()`/`createHistogram()` return a *new* wrapper object on each
 * call but are keyed by instrument descriptor internally, so repeated lookups from the
 * same recording function correctly aggregate into one series rather than diverging.
 *
 * Every recording call is wrapped so a throwing instrument — or a `telemetryAttributes`
 * rejection, which is the one other way this code can throw — cannot change a build's
 * outcome. `queue-runner.ts`'s own module header already states that a build never ends
 * in a non-terminal state because of an exception; these functions are what keeps
 * telemetry from becoming the first exception that breaks that invariant.
 *
 * Attribute values pass through `redactAttributes` (`../redact.ts`) after
 * `telemetryAttributes` builds them, before reaching an instrument — belt-and-braces
 * alongside the allowlist itself, per `ADR-0001-observability`'s "redaction rules apply
 * to every sink" and Pitfall 5 in `05-RESEARCH.md`. In practice the allowlist admits no
 * free text except `workerId`, but the worker is the process that actually holds
 * build-log text and container paths, so this side applies both layers rather than
 * relying on the allowlist alone.
 */
import { metrics } from '@opentelemetry/api';
import type { BuildFailureCode, BuildStatus } from '@qmk-web-app/domain';
import { redactAttributes } from '../redact.ts';
import { telemetryAttributes } from './attributes.ts';

const METER_NAME = 'qwa-worker';

export interface MetricsLogEvent {
  level: 'warn';
  message: string;
  error?: string;
}

export interface RecordOptions {
  log?: (event: MetricsLogEvent) => void;
}

function safely(action: () => void, message: string, log: (event: MetricsLogEvent) => void): void {
  try {
    action();
  } catch (error) {
    log({ level: 'warn', message, error: (error as Error).message });
  }
}

/**
 * `qwa.builds.completed` — incremented once per terminal outcome in `runOnce`,
 * attributed by the build's final status. Call exactly once per build so the count
 * cannot double when a call path is refactored.
 */
export function recordBuildCompleted(status: BuildStatus, options: RecordOptions = {}): void {
  const log = options.log ?? (() => {});
  safely(
    () => {
      const counter = metrics.getMeter(METER_NAME).createCounter('qwa.builds.completed', {
        description: 'Builds that reached a terminal state, attributed by final status.',
      });
      counter.add(1, redactAttributes(telemetryAttributes({ status })));
    },
    'record build completed failed',
    log,
  );
}

/**
 * `qwa.builds.failed` — incremented once per failed build, attributed by
 * `failure_code`. The value is always a member of the closed `BuildFailureCode` enum;
 * the allowlist enforces that mechanically rather than by convention.
 */
export function recordBuildFailed(failureCode: BuildFailureCode, options: RecordOptions = {}): void {
  const log = options.log ?? (() => {});
  safely(
    () => {
      const counter = metrics.getMeter(METER_NAME).createCounter('qwa.builds.failed', {
        description: 'Builds that failed, attributed by failure_code.',
      });
      counter.add(1, redactAttributes(telemetryAttributes({ failureCode })));
    },
    'record build failed failed',
    log,
  );
}

/**
 * `qwa.worker.heartbeat` — incremented on each loop tick and each `maintain()`,
 * attributed by worker id. A counter rather than a gauge: liveness is answered by "is
 * this still increasing", which survives a missed export window in a way a last-value
 * gauge does not.
 */
export function recordWorkerHeartbeat(workerId: string, options: RecordOptions = {}): void {
  const log = options.log ?? (() => {});
  safely(
    () => {
      const counter = metrics.getMeter(METER_NAME).createCounter('qwa.worker.heartbeat', {
        description: 'Worker loop ticks and maintenance sweeps, attributed by worker_id.',
      });
      counter.add(1, redactAttributes(telemetryAttributes({ workerId })));
    },
    'record worker heartbeat failed',
    log,
  );
}

/**
 * `qwa.builds.duration_ms` — not one of criterion 2's four names, but the four are
 * unreadable without it: a throughput number with no duration cannot distinguish a
 * healthy queue from a stalled one. Attributed by final status, same as throughput.
 */
export function recordBuildDuration(
  durationMs: number,
  status: BuildStatus,
  options: RecordOptions = {},
): void {
  const log = options.log ?? (() => {});
  safely(
    () => {
      const histogram = metrics.getMeter(METER_NAME).createHistogram('qwa.builds.duration_ms', {
        description: 'Build duration in milliseconds, attributed by final status.',
        unit: 'ms',
      });
      histogram.record(durationMs, redactAttributes(telemetryAttributes({ status })));
    },
    'record build duration failed',
    log,
  );
}
