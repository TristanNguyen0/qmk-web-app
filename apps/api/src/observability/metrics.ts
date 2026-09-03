/**
 * The API's metric instruments — criterion 2's first of four signals: queue depth.
 *
 * Every meter/instrument lookup here happens lazily, inside a function body, never at
 * module load time. ES module `import` statements are hoisted and evaluated before any
 * statement in the importing file runs — the same constraint `apps/api/src/observability
 * /otel.ts`'s header explains is why `@opentelemetry/sdk-node` was not installed. If this
 * module captured `metrics.getMeter('qwa-api')` in a module-scope constant, that binding
 * would be made before `server.ts`'s `startTelemetry()` call ever runs (since the
 * `import` of this module is hoisted above it), permanently pinning every instrument
 * created from it to the no-op provider that was active at import time — even after
 * `startTelemetry()` later registers the real one. Calling `metrics.getMeter(...)`
 * inside each function avoids that trap: the OTel SDK's `MeterProvider.getMeter()` and
 * `Meter.createXxx()` are both keyed by name/descriptor and return the *same* underlying
 * storage on repeated calls (verified against the installed `@opentelemetry/sdk-metrics`
 * source), so repeated lookups are correct and cheap, not merely a workaround.
 */
import { metrics } from '@opentelemetry/api';

const METER_NAME = 'qwa-api';

/** The one method the queue-depth gauge needs — narrower than the full `BuildRepository`. */
export interface QueueDepthSource {
  countActiveGlobal(): Promise<number>;
}

export interface MetricsLogEvent {
  level: 'warn';
  message: string;
  error?: string;
}

let queueDepthRegistered = false;

/**
 * Wires `qwa.builds.queue_depth` to its data source:
 * `BuildRepository.countActiveGlobal()`, added in 05-01 for exactly this second
 * consumer (the first is the global admission cap). An observable gauge rather than an
 * up-down counter, because depth is state the database already owns; a counter kept in
 * the API process would drift the moment a worker or a second API process changed it.
 *
 * With no builds in the system the callback still observes 0 — a present zero, not an
 * absent series, per this plan's `must_haves`. A database error becomes a warn log and
 * a skipped observation for that collection cycle, never an unhandled rejection inside
 * the SDK's export path.
 *
 * Idempotent — a second call is a no-op. Registering the callback twice would double
 * the observed value, the same failure mode `startTelemetry()`'s module-level guard
 * exists to prevent, and for the same reason: a wrong number that looks plausible is
 * worse than a visible failure.
 */
export function registerQueueDepthGauge(
  source: QueueDepthSource,
  options: { log?: (event: MetricsLogEvent) => void } = {},
): void {
  if (queueDepthRegistered) return;
  queueDepthRegistered = true;

  const log = options.log ?? (() => {});
  const gauge = metrics.getMeter(METER_NAME).createObservableGauge('qwa.builds.queue_depth', {
    description: 'Builds queued or in flight across every owner, right now.',
  });

  gauge.addCallback(async (result) => {
    try {
      result.observe(await source.countActiveGlobal());
    } catch (error) {
      log({
        level: 'warn',
        message: 'queue depth observation failed',
        error: (error as Error).message,
      });
    }
  });
}

/** Test-only: undoes `registerQueueDepthGauge`'s idempotency guard between test cases. */
export function resetQueueDepthGaugeForTests(): void {
  queueDepthRegistered = false;
}
