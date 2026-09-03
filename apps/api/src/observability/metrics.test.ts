/**
 * The queue-depth gauge — criterion 2's first of four signals. Driven through a real
 * `MeterProvider` and `reader.collect()` rather than a mock, so the assertions cover
 * what actually reaches an exported data point, not just that a function was called.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  type MetricData,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { shutdownTelemetry, startTelemetry } from './otel.ts';
import {
  registerQueueDepthGauge,
  resetQueueDepthGaugeForTests,
  type QueueDepthSource,
} from './metrics.ts';

function findMetric(resourceMetrics: ResourceMetrics, name: string): MetricData | undefined {
  for (const scope of resourceMetrics.scopeMetrics) {
    const found = scope.metrics.find((metric) => metric.descriptor.name === name);
    if (found) return found;
  }
  return undefined;
}

function setupReader(): PeriodicExportingMetricReader {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
  startTelemetry({ metricReader: reader });
  return reader;
}

afterEach(async () => {
  resetQueueDepthGaugeForTests();
  await shutdownTelemetry();
});

describe('registerQueueDepthGauge', () => {
  it('observes 0 with no builds in the system — a present zero, not an absent series', async () => {
    const reader = setupReader();
    const source: QueueDepthSource = { countActiveGlobal: async () => 0 };
    registerQueueDepthGauge(source);

    const { resourceMetrics } = await reader.collect();
    const metric = findMetric(resourceMetrics, 'qwa.builds.queue_depth');
    expect(metric?.dataPoints).toHaveLength(1);
    expect(metric?.dataPoints[0]?.value).toBe(0);
  });

  it('observes N after N builds are active', async () => {
    const reader = setupReader();
    registerQueueDepthGauge({ countActiveGlobal: async () => 3 });

    const { resourceMetrics } = await reader.collect();
    const metric = findMetric(resourceMetrics, 'qwa.builds.queue_depth');
    expect(metric?.dataPoints[0]?.value).toBe(3);
  });

  it('is idempotent — a second registration does not add a second callback', async () => {
    const reader = setupReader();
    let calls = 0;
    const source: QueueDepthSource = {
      countActiveGlobal: async () => {
        calls += 1;
        return 1;
      },
    };
    registerQueueDepthGauge(source);
    registerQueueDepthGauge(source);

    await reader.collect();
    expect(calls).toBe(1);
  });

  it('turns a failing source into a warn log and a skipped observation, not a thrown error', async () => {
    const reader = setupReader();
    const events: Array<{ level: string; message: string }> = [];
    registerQueueDepthGauge(
      {
        countActiveGlobal: async () => {
          throw new Error('database unreachable');
        },
      },
      { log: (event) => events.push(event) },
    );

    const { resourceMetrics, errors } = await reader.collect();
    expect(errors).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]?.level).toBe('warn');
    const metric = findMetric(resourceMetrics, 'qwa.builds.queue_depth');
    expect(metric?.dataPoints ?? []).toHaveLength(0);
  });
});
