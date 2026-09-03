/**
 * Anonymous sessions.
 *
 * ADR-0001-auth: ownership-based authorization exists from day one, so this file pins
 * the properties that authorization depends on — a stable owner id, a cookie a client
 * cannot forge, and (from D-12/D-14, added in this phase) an issuance-issuance IP
 * limit that never touches a returning visitor and never blacks out the read-only
 * site.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { CatalogStore } from './catalog-store.ts';
import { InMemoryConfigurationRepository } from './configurations/memory-repository.ts';

const SECRET = 'test-secret-that-is-long-enough-to-pass-0123';

function newApp(options: { secureCookies?: boolean } = {}): FastifyInstance {
  return buildApp({
    store: new CatalogStore(),
    repository: new InMemoryConfigurationRepository(),
    sessionSecret: SECRET,
    secureCookies: options.secureCookies ?? false,
  });
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
