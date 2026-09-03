/**
 * The telemetry attribute allowlist — worker copy. Mirrors
 * `apps/api/src/observability/attributes.test.ts`; see that module's header for why
 * this is a mirrored copy rather than a shared import.
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

  it('rejects a non-numeric value for a numeric key', () => {
    expect(() => telemetryAttributes({ count: 'five' })).toThrow(/count/);
  });

  it('rejects an empty worker id', () => {
    expect(() => telemetryAttributes({ workerId: '' })).toThrow(/workerId/);
  });
});
