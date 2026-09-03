/**
 * Idempotent OpenTelemetry metrics bootstrap for the worker process.
 *
 * `ADR-0001-observability`: "structured JSON logs now, OpenTelemetry-compatible
 * exporters before public access." This installs metrics only — no
 * `@opentelemetry/sdk-node` and no trace exporter. `05-07-PLAN.md`'s `<planner_notes>`
 * records why: criterion 2 names four signals and every one of them is a metric, and
 * `sdk-node` exists to wire tracing/auto-instrumentation neither of them needs. It also
 * carries a real operational cost this plan does not want to pay for zero gain: the
 * OpenTelemetry JS SDK's documented requirement that "the SDK must be initialized
 * before any other module in your application is loaded" would mean a preload wrapper
 * on both process entry points, because ES module `import` statements hoist above any
 * `start()` call written inside the entry file. Manual metric instruments carry no such
 * constraint — this module can be `import`ed and started in any order relative to the
 * rest of the process, as long as `startTelemetry()` runs before anything tries to
 * *record* a metric (see `services/worker/src/observability/metrics.ts`'s header for
 * how the metrics module itself avoids binding to a stale provider). Traces stay an
 * additive next step behind this same module — see `docs/runbooks/observability.md`.
 *
 * Kept as a small file mirrored in `apps/api/src/observability/otel.ts` rather than
 * shared from one package, so neither process gains a dependency on the other's
 * package for a dozen lines of bootstrap; the only difference between the two is
 * `service.name`. Both headers say so, so the duplication reads as deliberate rather
 * than a copy someone forgot to reconcile.
 *
 * Registers against the *global* `@opentelemetry/api` meter registry
 * (`metrics.setGlobalMeterProvider`) rather than threading a `MeterProvider` through
 * every call site. `metrics.getMeter(name)` already returns a fully-functional no-op
 * meter when nothing is registered — exactly the "disabled" behaviour this module needs
 * with no collector configured, and it means `metrics.ts`'s recording functions need no
 * special-casing for the disabled path at all: recording against a no-op instrument is
 * simply a no-op.
 */
import { randomUUID } from 'node:crypto';
import { DiagLogLevel, diag, metrics, type DiagLogger } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type IMetricReader,
} from '@opentelemetry/sdk-metrics';

export interface TelemetryWarnEvent {
  level: 'warn';
  message: string;
  detail?: string;
}

export interface TelemetryHandle {
  readonly enabled: boolean;
  /** Flushes the last export window and releases the provider. Idempotent. */
  shutdown(): Promise<void>;
}

export interface StartTelemetryOptions {
  /** Defaults to `process.env`. Injectable so a test never depends on the real one. */
  env?: Record<string, string | undefined>;
  /** Exporter errors and SDK diagnostics are routed here at warn level. Defaults to a no-op. */
  log?: (event: TelemetryWarnEvent) => void;
  /**
   * Test seam: supplies a metric reader directly instead of building the real OTLP one
   * from `QWA_OTEL_EXPORTER_URL`. Never exercised in production — there, the env var
   * alone decides whether telemetry is enabled.
   */
  metricReader?: IMetricReader;
}

let current: TelemetryHandle | null = null;
let currentProvider: MeterProvider | null = null;

function formatDiagArgs(args: unknown[]): string | undefined {
  if (args.length === 0) return undefined;
  return args.map((value) => (value instanceof Error ? value.message : String(value))).join(' ');
}

/**
 * Routes the OTel SDK's own internal diagnostics (including every exporter failure —
 * `PeriodicExportingMetricReader` never throws or rejects on an export error; it always
 * reports through `diag.error`/`diag.warn` instead) to `log` at warn level, so an
 * unreachable collector is visible without ever becoming a thrown error on a build's
 * critical path.
 */
function installDiagLogger(log: (event: TelemetryWarnEvent) => void): void {
  const emit = (message: string, args: unknown[]): void => {
    const detail = formatDiagArgs(args);
    log(detail === undefined ? { level: 'warn', message } : { level: 'warn', message, detail });
  };
  const logger: DiagLogger = {
    error: (message, ...args) => emit(message, args),
    warn: (message, ...args) => emit(message, args),
    info: () => {},
    debug: () => {},
    verbose: () => {},
  };
  diag.setLogger(logger, { logLevel: DiagLogLevel.WARN, suppressOverrideMessage: true });
}

/**
 * Starts the metrics bootstrap, or returns the handle from an earlier call unchanged.
 * Guarded on a module-level handle: a second call registering a second `MeterProvider`
 * would silently double-count every metric — a wrong number that looks plausible, not a
 * visible failure, which is worse.
 *
 * With `QWA_OTEL_EXPORTER_URL` unset (and no test-only `metricReader` supplied), returns
 * a disabled handle and constructs nothing: no collector is required to run the worker
 * or the test suite.
 */
export function startTelemetry(options: StartTelemetryOptions = {}): TelemetryHandle {
  if (current) return current;

  const env = options.env ?? process.env;
  const url = env['QWA_OTEL_EXPORTER_URL'];

  // Written as if/else-if rather than `options.metricReader ?? new ...({ url })` so
  // TypeScript narrows `url` to `string` in the branch that actually reads it —
  // `exactOptionalPropertyTypes` correctly refuses to let a possibly-`undefined` `url`
  // reach a required `string` constructor option.
  let reader: IMetricReader;
  if (options.metricReader) {
    reader = options.metricReader;
  } else if (url) {
    reader = new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ url }) });
  } else {
    current = { enabled: false, shutdown: async () => {} };
    return current;
  }

  installDiagLogger(options.log ?? (() => {}));

  const resource = resourceFromAttributes({
    'service.name': 'qwa-worker',
    'service.instance.id': randomUUID(),
  });

  const provider = new MeterProvider({ resource, readers: [reader] });
  currentProvider = provider;
  metrics.setGlobalMeterProvider(provider);

  current = {
    enabled: true,
    shutdown: async () => {
      await provider.shutdown();
    },
  };
  return current;
}

/**
 * Flushes the last export window and releases the meter provider. Safe to call when
 * telemetry was never started — a shutdown path must never need to know whether
 * `startTelemetry()` ever ran.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!current) return;
  await current.shutdown();
  // Unregister so a later startTelemetry() in the same process (chiefly test suites,
  // which start and stop telemetry once per test) can register a fresh provider rather
  // than being silently refused by the API's own duplicate-registration guard.
  if (currentProvider) metrics.disable();
  current = null;
  currentProvider = null;
}
