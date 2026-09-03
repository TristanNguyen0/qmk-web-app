/**
 * The telemetry attribute allowlist — the mechanism that makes free-text telemetry
 * impossible by construction, not merely discouraged by convention.
 */
import { describe, expect, it } from 'vitest';
import { telemetryAttributes } from './attributes.ts';

describe('telemetryAttributes', () => {
  it('returns a validated record for an allowlisted key and value', () => {
    expect(telemetryAttributes({ status: 'succeeded' })).toEqual({ status: 'succeeded' });
  });

  it('maps camelCase input keys to their snake_case exported attribute name', () => {
    expect(telemetryAttributes({ failureCode: 'TIMEOUT' })).toEqual({ failure_code: 'TIMEOUT' });
    expect(telemetryAttributes({ workerId: 'worker-1' })).toEqual({ worker_id: 'worker-1' });
    expect(telemetryAttributes({ durationMs: 42 })).toEqual({ duration_ms: 42 });
  });

  it('omits keys whose value is undefined rather than exporting an undefined attribute', () => {
    expect(telemetryAttributes({ status: 'succeeded', failureCode: undefined })).toEqual({
      status: 'succeeded',
    });
  });

  it.each(['ownerId', 'configurationName', 'storageKey', 'path'])(
    'rejects "%s" by name — not on the allowlist',
    (key) => {
      expect(() => telemetryAttributes({ [key]: 'anything' })).toThrow(new RegExp(key));
    },
  );

  it('rejects a status that is not a member of BuildStatus', () => {
    expect(() => telemetryAttributes({ status: 'not-a-real-status' })).toThrow(/status/);
  });

  it('rejects a failure code that is not a member of BuildFailureCode', () => {
    expect(() => telemetryAttributes({ failureCode: 'NOT_A_REAL_CODE' })).toThrow(/failureCode/);
  });

  it('rejects an admission cap outside the closed BuildAdmissionCap union', () => {
    expect(() => telemetryAttributes({ cap: 'not_a_real_cap' })).toThrow(/cap/);
  });

  it('rejects a non-numeric value for a numeric key', () => {
    expect(() => telemetryAttributes({ count: 'five' })).toThrow(/count/);
    expect(() => telemetryAttributes({ durationMs: 'slow' })).toThrow(/durationMs/);
  });

  it('rejects a non-finite number for a numeric key', () => {
    expect(() => telemetryAttributes({ count: Number.NaN })).toThrow(/count/);
    expect(() => telemetryAttributes({ durationMs: Number.POSITIVE_INFINITY })).toThrow(
      /durationMs/,
    );
  });

  it('rejects an empty worker id', () => {
    expect(() => telemetryAttributes({ workerId: '' })).toThrow(/workerId/);
  });

  it('accepts every member of BuildStatus and BuildFailureCode', () => {
    for (const status of [
      'queued',
      'preparing',
      'building',
      'uploading',
      'succeeded',
      'failed',
      'cancelled',
      'expired',
    ]) {
      expect(() => telemetryAttributes({ status })).not.toThrow();
    }
    for (const failureCode of [
      'COMPILE_FAILED',
      'TIMEOUT',
      'RESOURCE_LIMIT',
      'GENERATION_FAILED',
      'ARTIFACT_NOT_PRODUCED',
      'ARTIFACT_REJECTED',
      'SANDBOX_ERROR',
      'CANCELLED',
    ]) {
      expect(() => telemetryAttributes({ failureCode })).not.toThrow();
    }
  });
});
