/**
 * `buildApp()` itself, as distinct from `session.ts`'s cookie/rate-limit behavior
 * (covered in `session.test.ts`).
 *
 * CR-01 (05-REVIEW.md): `buildApp()` defaults `logger` to `false`, so no test in this
 * suite exercised the logger configuration `server.ts` actually ships with — which is
 * exactly how a client-IP-in-logs leak went undetected. This file constructs the app
 * the same way `server.ts` does (production logger enabled) and asserts on the
 * captured log output, not just the response.
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp, PRODUCTION_LOGGER_OPTIONS } from './app.ts';
import { CatalogStore } from './catalog-store.ts';
import { InMemoryConfigurationRepository } from './configurations/memory-repository.ts';

const SECRET = 'test-secret-that-is-long-enough-to-pass-0123';

describe('production request logging (CR-01 regression)', () => {
  it('never writes the client IP to a log line under the exact logger config server.ts ships', async () => {
    // Capture what Fastify/pino would otherwise write to stdout, without touching the
    // production configuration itself — only the destination is swapped.
    const chunks: Buffer[] = [];
    const captured = new PassThrough();
    captured.on('data', (chunk: Buffer) => chunks.push(chunk));

    const app = buildApp({
      store: new CatalogStore(),
      repository: new InMemoryConfigurationRepository(),
      sessionSecret: SECRET,
      logger: { ...PRODUCTION_LOGGER_OPTIONS, stream: captured },
    });

    const probeIp = '203.0.113.99';
    const res = await app.inject({ method: 'GET', url: '/health', remoteAddress: probeIp });
    await app.close();

    expect(res.statusCode).toBe(200);

    const logOutput = Buffer.concat(chunks).toString('utf8');
    // The logger really did run (otherwise this test would pass vacuously).
    expect(logOutput.length).toBeGreaterThan(0);
    expect(logOutput).toContain('"method":"GET"');

    expect(logOutput).not.toContain(probeIp);
    expect(logOutput).not.toContain('remoteAddress');
    expect(logOutput).not.toContain('remotePort');
  });
});
