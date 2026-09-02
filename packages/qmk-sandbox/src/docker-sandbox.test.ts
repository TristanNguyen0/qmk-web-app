/**
 * Argument-builder behaviours for the module-hook API version assertion (D-04).
 *
 * No docker invocation here — these are the pure pieces: the flag/value the
 * verify-env argument vector receives, and the shape validation that keeps a
 * free-form value from ever reaching it (claude.md rule 4). The real three-point
 * boundary behaviour against the pinned tree is proven separately by
 * `pnpm env:verify` (services/worker/scripts/verify-env-check.ts), which needs a
 * Docker daemon and is deliberately not run here.
 */
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { assertValidModuleHookApiVersion, buildVerifyEnvArgs, DockerSandbox } from './docker-sandbox.ts';

describe('buildVerifyEnvArgs', () => {
  it('returns no extra arguments when no minimum is supplied', () => {
    expect(buildVerifyEnvArgs(undefined)).toEqual([]);
  });

  it('returns the flag and value when a minimum is supplied', () => {
    expect(buildVerifyEnvArgs('1.0.0')).toEqual(['--min-module-hook-api', '1.0.0']);
  });

  it('accepts a two-digit patch component', () => {
    expect(buildVerifyEnvArgs('1.1.12')).toEqual(['--min-module-hook-api', '1.1.12']);
  });

  it.each(['1.0', '1.0.0.0', 'v1.0.0', '1.0.a', '-1.0.0', '1.0.0 ', '', '1..0'])(
    'rejects a malformed version string before it reaches the argument vector: %s',
    (malformed) => {
      expect(() => buildVerifyEnvArgs(malformed)).toThrow();
    },
  );
});

describe('assertValidModuleHookApiVersion', () => {
  it('accepts three dot-separated non-negative integers', () => {
    expect(() => assertValidModuleHookApiVersion('0.0.0')).not.toThrow();
    expect(() => assertValidModuleHookApiVersion('12.34.56')).not.toThrow();
  });

  it('rejects anything else', () => {
    expect(() => assertValidModuleHookApiVersion('1.0')).toThrow();
    expect(() => assertValidModuleHookApiVersion('1.0.0-rc1')).toThrow();
  });
});

describe('DockerSandbox construction validates minModuleHookApiVersion', () => {
  it('accepts a well-formed version without throwing', () => {
    expect(
      () =>
        new DockerSandbox({
          imageRef: 'qmk-web-app/qmk-build:test',
          qmkSourcePath: tmpdir(),
          minModuleHookApiVersion: '1.0.0',
        }),
    ).not.toThrow();
  });

  it('throws at construction time on a malformed version, before any run', () => {
    expect(
      () =>
        new DockerSandbox({
          imageRef: 'qmk-web-app/qmk-build:test',
          qmkSourcePath: tmpdir(),
          minModuleHookApiVersion: '1.0',
        }),
    ).toThrow();
  });

  it('does not require a minimum at all', () => {
    expect(
      () =>
        new DockerSandbox({
          imageRef: 'qmk-web-app/qmk-build:test',
          qmkSourcePath: tmpdir(),
        }),
    ).not.toThrow();
  });
});
