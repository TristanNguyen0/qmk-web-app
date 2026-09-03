/**
 * Start-up configuration parsing.
 *
 * These guards are what stand between an unconfigured deployment and D-04/D-14's
 * failure modes: a guessable session secret and a spoofable client IP. Both must fail
 * loudly, not silently default.
 */
import { describe, expect, it } from 'vitest';
import { parseTrustProxy, requireEnv } from './config.ts';

describe('requireEnv', () => {
  it('returns the value when present', () => {
    expect(requireEnv('QWA_SESSION_SECRET', { QWA_SESSION_SECRET: 'a-real-value' })).toBe(
      'a-real-value',
    );
  });

  it('throws naming the variable when absent', () => {
    expect(() => requireEnv('QWA_SESSION_SECRET', {})).toThrow(/QWA_SESSION_SECRET/);
  });

  it('treats an empty string as absent, not a value', () => {
    expect(() => requireEnv('QWA_SESSION_SECRET', { QWA_SESSION_SECRET: '' })).toThrow(
      /QWA_SESSION_SECRET/,
    );
  });

  it('states a concrete way to generate a value when a hint is supplied', () => {
    expect(() =>
      requireEnv(
        'QWA_SESSION_SECRET',
        {},
        { hint: 'Generate one with: openssl rand -hex 32' },
      ),
    ).toThrow(/openssl rand -hex 32/);
  });
});

describe('parseTrustProxy', () => {
  it('accepts a single IPv4 address', () => {
    expect(parseTrustProxy('10.0.0.1', { production: true })).toBe('10.0.0.1');
  });

  it('accepts an IPv4 CIDR', () => {
    expect(parseTrustProxy('10.0.0.0/8', { production: true })).toBe('10.0.0.0/8');
  });

  it('accepts a comma-separated list, preserving order', () => {
    expect(parseTrustProxy('10.0.0.1,10.0.0.2', { production: true })).toEqual([
      '10.0.0.1',
      '10.0.0.2',
    ]);
  });

  it.each(['true', '1', 'yes'])('rejects the boolean-ish spelling %s', (spelling) => {
    expect(() => parseTrustProxy(spelling, { production: true })).toThrow(
      /specific reverse-proxy hop/,
    );
  });

  it('rejects "true" with a message explaining why trusting every hop is unsafe', () => {
    expect(() => parseTrustProxy('true', { production: true })).toThrow(/claim any address/);
  });

  it('rejects a value that is not a valid address or CIDR', () => {
    expect(() => parseTrustProxy('not-an-address', { production: true })).toThrow();
  });

  it('returns false (trust nothing) when unset outside production', () => {
    expect(parseTrustProxy(undefined, { production: false })).toBe(false);
  });

  it('throws naming QWA_TRUST_PROXY when unset in production', () => {
    expect(() => parseTrustProxy(undefined, { production: true })).toThrow(/QWA_TRUST_PROXY/);
  });
});
