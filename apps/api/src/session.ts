/**
 * Anonymous sessions.
 *
 * ADR 0001: "Anonymous signed-cookie sessions … Critically, ownership-based
 * authorization exists from day one; only the *identity source* changes when accounts
 * arrive." So this module produces a stable owner id and nothing else — every route
 * authorizes against that id exactly as it would against a real account.
 *
 * The cookie is a UUID plus an HMAC over it. The HMAC prevents a client from simply
 * editing the cookie to claim another session's id, which would otherwise hand them
 * that session's configurations.
 *
 * D-12/D-14: minting a fresh session is the cheap step that defeats every per-owner
 * build quota, so the mint branch below — and only the mint branch — is IP-rate-
 * limited via `@fastify/rate-limit`'s manual-check seam (`app.createRateLimit`,
 * verified against the installed 11.2.0 API; see 05-RESEARCH.md Assumption A3). A
 * valid-cookie request never reaches the check at all, so a returning visitor is
 * never rate-limited by IP — per-owner quotas already govern them.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { SESSION_LIMITS } from '@qmk-web-app/domain';
import { sendRateLimited } from './errors.ts';

export const SESSION_COOKIE = 'qwa_session';

/** One year. Anonymous users lose everything if the cookie is lost — see README. */
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

declare module 'fastify' {
  interface FastifyRequest {
    /** Stable owner id for this session. Always present after the session hook. */
    ownerId: string;
  }
}

function sign(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('base64url');
}

function verify(cookieValue: string, secret: string): string | null {
  const separator = cookieValue.lastIndexOf('.');
  if (separator <= 0) return null;

  const sessionId = cookieValue.slice(0, separator);
  const providedMac = cookieValue.slice(separator + 1);
  if (!UUID_RE.test(sessionId)) return null;

  const expectedMac = sign(sessionId, secret);
  const provided = Buffer.from(providedMac);
  const expected = Buffer.from(expectedMac);
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  return sessionId;
}

/** Minimal cookie-header parser; we need exactly one cookie and no dependency. */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export interface SessionIssuanceLimit {
  /** Cookieless mints allowed from one address within `windowMs`. */
  max: number;
  windowMs: number;
}

export interface SessionOptions {
  secret: string;
  /** Set Secure on the cookie. Must be true in production. */
  secure: boolean;
  /**
   * Overrides `SESSION_LIMITS` for tests: a test that mints 121 sessions to observe
   * the real boundary is a slow test that will be deleted. Defaults to
   * `SESSION_LIMITS.issuancePerIpPerHour`/`issuanceWindowMs`.
   */
  issuanceLimit?: SessionIssuanceLimit;
}

export function registerSessions(app: FastifyInstance, options: SessionOptions): void {
  if (options.secret.length < 32) {
    throw new Error('session secret must be at least 32 characters');
  }

  const issuanceLimit: SessionIssuanceLimit = options.issuanceLimit ?? {
    max: SESSION_LIMITS.issuancePerIpPerHour,
    windowMs: SESSION_LIMITS.issuanceWindowMs,
  };

  // `global: false`: an ordinary request never consumes a slot merely by being
  // routed. The manual check below is invoked only inside the mint branch.
  void app.register(rateLimit, { global: false });

  // `app.createRateLimit(options)` must be called exactly once: fastify-rate-limit's
  // manual-check seam spawns a fresh, empty child counter store on every call (see
  // `LocalStore.prototype.child` in the installed package) — calling it per-request
  // would silently reset the count on every request. `app.after()` runs once the
  // `rateLimit` registration above has finished, without making this function itself
  // async (which would force every caller of `registerSessions`/`buildApp` to await).
  let checkIssuance: ReturnType<FastifyInstance['createRateLimit']> | undefined;
  app.after(() => {
    checkIssuance = app.createRateLimit({
      max: issuanceLimit.max,
      timeWindow: issuanceLimit.windowMs,
      // Default keyGenerator already keys on request.ip; explicit here so the
      // dependency on Task 1's trustProxy wiring (app.ts) is visible at the call site.
      keyGenerator: (req) => req.ip,
    });
  });

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const existing = verify(readCookie(request.headers.cookie, SESSION_COOKIE) ?? '', options.secret);
    if (existing) {
      request.ownerId = existing;
      return;
    }

    // No valid cookie: about to mint. A tampered or expired cookie reaches this
    // branch exactly like no cookie at all — minting is what actually happens here,
    // so it is what the limit counts, regardless of why the previous cookie failed.
    if (!checkIssuance) {
      throw new Error(
        'registerSessions: the rate-limit checker was not initialized before the ' +
          'onRequest hook ran — app.after() ordering was violated',
      );
    }
    const limitResult = await checkIssuance(request);
    if (!limitResult.isAllowed && limitResult.isExceeded) {
      sendRateLimited(reply, limitResult.ttlInSeconds);
      return;
    }

    const sessionId = randomUUID();
    request.ownerId = sessionId;

    const value = `${sessionId}.${sign(sessionId, options.secret)}`;
    const attributes = [
      `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
      'Path=/',
      `Max-Age=${MAX_AGE_SECONDS}`,
      // HttpOnly: the session id is not needed by client JavaScript, and keeping it
      // out of the DOM removes it as an XSS target.
      'HttpOnly',
      // Lax rather than Strict: the app uses top-level navigation between pages.
      'SameSite=Lax',
    ];
    if (options.secure) attributes.push('Secure');

    reply.header('set-cookie', attributes.join('; '));
  });
}
