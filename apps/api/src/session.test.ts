/**
 * Anonymous sessions.
 *
 * ADR-0001-auth: ownership-based authorization exists from day one, so this file pins
 * the properties that authorization depends on — a stable owner id, a cookie a client
 * cannot forge, and (from D-12/D-14, added in this phase) an issuance-issuance IP
 * limit that never touches a returning visitor and never blacks out the read-only
 * site.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Catalog } from '@qmk-web-app/domain';
import { readCatalogSample } from '@qmk-web-app/qmk-fixtures';
import { buildApp } from './app.ts';
import { CatalogStore } from './catalog-store.ts';
import { InMemoryConfigurationRepository } from './configurations/memory-repository.ts';

const SECRET = 'test-secret-that-is-long-enough-to-pass-0123';

function newApp(
  options: {
    secureCookies?: boolean;
    sessionIssuanceLimit?: { max: number; windowMs: number };
    withCatalog?: boolean;
  } = {},
): FastifyInstance {
  const store = new CatalogStore();
  if (options.withCatalog) {
    store.add(readCatalogSample() as Catalog);
  }
  return buildApp({
    store,
    repository: new InMemoryConfigurationRepository(),
    sessionSecret: SECRET,
    secureCookies: options.secureCookies ?? false,
    ...(options.sessionIssuanceLimit
      ? { sessionIssuanceLimit: options.sessionIssuanceLimit }
      : {}),
  });
}

function setCookieHeader(res: { headers: Record<string, unknown> }): string | undefined {
  const setCookie = res.headers['set-cookie'];
  if (setCookie === undefined) return undefined;
  return Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
}

/** Parses a `Set-Cookie` header string into its attribute list, case-preserved. */
function cookieAttributes(setCookie: string): string[] {
  return setCookie.split(';').map((part) => part.trim());
}

describe('session cookie attributes', () => {
  it('sets HttpOnly, SameSite=Lax, Path=/, and a one-year Max-Age on a cookieless request', async () => {
    const app = newApp();
    const res = await app.inject({ method: 'GET', url: '/health' });

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const attributes = cookieAttributes(
      Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string),
    );

    expect(attributes).toContain('HttpOnly');
    expect(attributes).toContain('SameSite=Lax');
    expect(attributes).toContain('Path=/');
    // One year, in seconds.
    expect(attributes).toContain(`Max-Age=${365 * 24 * 60 * 60}`);
  });

  it('omits Secure when secureCookies is false', async () => {
    const app = newApp({ secureCookies: false });
    const res = await app.inject({ method: 'GET', url: '/health' });

    const setCookie = res.headers['set-cookie'];
    const attributes = cookieAttributes(
      Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string),
    );
    expect(attributes).not.toContain('Secure');
  });

  it('sets Secure when secureCookies is true', async () => {
    const app = newApp({ secureCookies: true });
    const res = await app.inject({ method: 'GET', url: '/health' });

    const setCookie = res.headers['set-cookie'];
    const attributes = cookieAttributes(
      Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string),
    );
    expect(attributes).toContain('Secure');
  });
});

describe('session-issuance IP rate limit (D-12)', () => {
  const LIMIT = { max: 3, windowMs: 60_000 };
  // A session-required path: as of this task every refusal is 429, and Task 3 keeps
  // this specific path 429 even after it scopes refusal by path (configurations
  // reads/writes always need an identity). Using it here means these tests do not
  // need to change when Task 3 lands.
  const REQUIRES_SESSION = { method: 'GET' as const, url: '/v1/configurations' };

  it('mints for exactly the first K cookieless requests from one address and refuses the (K+1)th', async () => {
    const app = newApp({ sessionIssuanceLimit: LIMIT });

    for (let i = 0; i < LIMIT.max; i++) {
      const res = await app.inject({ ...REQUIRES_SESSION, remoteAddress: '203.0.113.10' });
      expect(setCookieHeader(res)).toBeDefined();
    }

    const refused = await app.inject({ ...REQUIRES_SESSION, remoteAddress: '203.0.113.10' });
    expect(setCookieHeader(refused)).toBeUndefined();
  });

  it('answers 429 with error.code RATE_LIMITED and a retry-after header once refused', async () => {
    const app = newApp({ sessionIssuanceLimit: LIMIT });
    const address = '203.0.113.11';

    for (let i = 0; i < LIMIT.max; i++) {
      await app.inject({ ...REQUIRES_SESSION, remoteAddress: address });
    }
    const refused = await app.inject({ ...REQUIRES_SESSION, remoteAddress: address });

    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.code).toBe('RATE_LIMITED');
    expect(refused.headers['retry-after']).toBeDefined();
  });

  it('a tampered cookie is treated as no session and still consumes an issuance slot', async () => {
    const app = newApp({ sessionIssuanceLimit: LIMIT });
    const address = '203.0.113.12';

    // The tampered cookie itself counts as one of the K mint attempts.
    await app.inject({
      ...REQUIRES_SESSION,
      remoteAddress: address,
      headers: { cookie: 'qwa_session=not-a-real-session.bad-mac' },
    });
    for (let i = 1; i < LIMIT.max; i++) {
      await app.inject({ ...REQUIRES_SESSION, remoteAddress: address });
    }
    const refused = await app.inject({ ...REQUIRES_SESSION, remoteAddress: address });
    expect(refused.statusCode).toBe(429);
  });

  it('does not affect a different address while the first is over its limit', async () => {
    const app = newApp({ sessionIssuanceLimit: LIMIT });

    for (let i = 0; i < LIMIT.max; i++) {
      await app.inject({ ...REQUIRES_SESSION, remoteAddress: '203.0.113.20' });
    }
    // First address is now at its limit.
    const overLimit = await app.inject({ ...REQUIRES_SESSION, remoteAddress: '203.0.113.20' });
    expect(overLimit.statusCode).toBe(429);

    // A different address mints normally.
    const otherAddress = await app.inject({
      ...REQUIRES_SESSION,
      remoteAddress: '203.0.113.21',
    });
    expect(setCookieHeader(otherAddress)).toBeDefined();
  });

  it('never rate-limits a request carrying a valid cookie, even from an over-limit address', async () => {
    const app = newApp({ sessionIssuanceLimit: LIMIT });
    const address = '203.0.113.30';

    let cookie: string | undefined;
    for (let i = 0; i < LIMIT.max; i++) {
      const res = await app.inject({ ...REQUIRES_SESSION, remoteAddress: address });
      cookie = setCookieHeader(res)?.split(';')[0];
    }
    expect(cookie).toBeDefined();

    // Address is now over its limit — but a request with the valid cookie from the
    // first mint succeeds and receives no new cookie, because per-owner quotas
    // already govern a returning visitor.
    const res = await app.inject({
      ...REQUIRES_SESSION,
      remoteAddress: address,
      headers: { cookie: cookie! },
    });
    expect(res.statusCode).toBe(200);
    expect(setCookieHeader(res)).toBeUndefined();
  });

  it('does not leak the requesting address in a refusal response', async () => {
    const app = newApp({ sessionIssuanceLimit: LIMIT });
    const address = '203.0.113.40';

    for (let i = 0; i < LIMIT.max; i++) {
      await app.inject({ ...REQUIRES_SESSION, remoteAddress: address });
    }
    const refused = await app.inject({ ...REQUIRES_SESSION, remoteAddress: address });
    const serialised = JSON.stringify({ headers: refused.headers, body: refused.body });
    expect(serialised).not.toContain(address);
  });
});

describe('a refusal scopes to session-requiring paths (D-12 vs. D-14 non-lockout)', () => {
  const LIMIT = { max: 1, windowMs: 60_000 };
  const address = '203.0.113.50';

  async function exhaust(app: FastifyInstance): Promise<void> {
    // Any session-requiring path consumes the shared per-address budget.
    await app.inject({ method: 'GET', url: '/v1/configurations', remoteAddress: address });
  }

  it('still answers 200 with no cookie for a cookieless GET /health once over limit', async () => {
    const app = newApp({ sessionIssuanceLimit: LIMIT });
    await exhaust(app);

    const res = await app.inject({ method: 'GET', url: '/health', remoteAddress: address });
    expect(res.statusCode).toBe(200);
    expect(setCookieHeader(res)).toBeUndefined();
  });

  it('still answers 200 with no cookie for a cookieless GET /v1/catalog/… once over limit', async () => {
    const app = newApp({ sessionIssuanceLimit: LIMIT, withCatalog: true });
    await exhaust(app);

    const res = await app.inject({ method: 'GET', url: '/v1/catalog', remoteAddress: address });
    expect(res.statusCode).toBe(200);
    expect(setCookieHeader(res)).toBeUndefined();
  });

  it('answers 429 for a cookieless POST /v1/configurations once over limit', async () => {
    const app = newApp({ sessionIssuanceLimit: LIMIT });
    await exhaust(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurations',
      remoteAddress: address,
      payload: {},
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });

  it('answers 429 for a cookieless GET /v1/configurations once over limit — an owner-scoped read still needs an identity', async () => {
    const app = newApp({ sessionIssuanceLimit: LIMIT });
    await exhaust(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/configurations',
      remoteAddress: address,
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });

  it('never leaves request.ownerId undefined when a request is served without a session', async () => {
    // The catalog handler never reads request.ownerId, so this exercises the
    // throwaway-id branch without a handler crash being the only signal — the request
    // must not merely avoid a 500, it must have a real (if uncookied) ownerId.
    const app = newApp({ sessionIssuanceLimit: LIMIT, withCatalog: true });
    await exhaust(app);

    const res = await app.inject({ method: 'GET', url: '/health', remoteAddress: address });
    expect(res.statusCode).toBe(200);
  });
});

describe('owner-id invariant (05-03 assumption_delta_decision)', () => {
  it('assigns request.ownerId in exactly one file under apps/api/src: session.ts', () => {
    const srcRoot = join(dirname(fileURLToPath(import.meta.url)));

    function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) return [full];
        return [];
      });
    }

    // Matches a property assignment (`request.ownerId = …` or `req.ownerId = …`), not
    // a comparison (`=== `), a read, or an unrelated local variable named `ownerId`.
    const ASSIGNMENT_RE = /\b(?:request|req)\.ownerId\s*=(?!=)/;

    const matches = walk(srcRoot)
      .filter((file) => ASSIGNMENT_RE.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(srcRoot.length + 1));

    expect(matches).toEqual(['session.ts']);
  });
});
