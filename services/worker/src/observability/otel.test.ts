/**
 * The metrics bootstrap: idempotent, inert with no collector configured, and never
 * lets an exporter failure escape as a thrown error. Mirrors
 * `apps/api/src/observability/otel.test.ts` — the module under test is the same shape,
 * differing only in `service.name`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { shutdownTelemetry, startTelemetry } from './otel.ts';

afterEach(async () => {
  await shutdownTelemetry();
});

describe('startTelemetry', () => {
  it('returns a disabled handle and constructs nothing with no exporter URL configured', () => {
    const handle = startTelemetry({ env: {} });
    expect(handle.enabled).toBe(false);
  });

  it('recording against a meter obtained while disabled is a no-op that never throws', () => {
    startTelemetry({ env: {} });
    const counter = metrics.getMeter('qwa-worker').createCounter('test.disabled.counter');
    expect(() => counter.add(1)).not.toThrow();
  });

  it('called twice returns the same handle and registers exactly one meter provider', () => {
    const setSpy = vi.spyOn(metrics, 'setGlobalMeterProvider');
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });

    const first = startTelemetry({ metricReader: reader });
    const second = startTelemetry({ metricReader: reader });

    expect(second).toBe(first);
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('routes a rejecting exporter to a warn log without throwing out of a recording call', async () => {
    const warnEvents: Array<{ level: string; message: string }> = [];
    const rejecting: PushMetricExporter = {
      export(_metrics, resultCallback) {
        resultCallback({ code: 1, error: new Error('collector unreachable') });
      },
      async forceFlush() {},
      async shutdown() {},
      selectAggregationTemporality: () => AggregationTemporality.CUMULATIVE,
    };
    const reader = new PeriodicExportingMetricReader({
      exporter: rejecting,
      exportIntervalMillis: 60_000,
    });

    startTelemetry({ metricReader: reader, log: (event) => warnEvents.push(event) });
    const counter = metrics.getMeter('qwa-worker').createCounter('test.rejecting.counter');

    expect(() => counter.add(1)).not.toThrow();
    await expect(reader.forceFlush()).resolves.toBeUndefined();
    expect(warnEvents.length).toBeGreaterThan(0);
    expect(warnEvents[0]?.level).toBe('warn');
  });

  it('shutdownTelemetry is safe to call when telemetry was never started', async () => {
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });

  it('shuts down cleanly and allows a fresh start afterward', async () => {
    const exporterA = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const readerA = new PeriodicExportingMetricReader({
      exporter: exporterA,
      exportIntervalMillis: 60_000,
    });
    startTelemetry({ metricReader: readerA });
    await shutdownTelemetry();

    const exporterB = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const readerB = new PeriodicExportingMetricReader({
      exporter: exporterB,
      exportIntervalMillis: 60_000,
    });
    const handle = startTelemetry({ metricReader: readerB });
    expect(handle.enabled).toBe(true);
  });
});
