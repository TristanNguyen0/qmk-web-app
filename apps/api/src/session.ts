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
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

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

export interface SessionOptions {
  secret: string;
  /** Set Secure on the cookie. Must be true in production. */
  secure: boolean;
}

export function registerSessions(app: FastifyInstance, options: SessionOptions): void {
  if (options.secret.length < 32) {
    throw new Error('session secret must be at least 32 characters');
  }

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const existing = verify(readCookie(request.headers.cookie, SESSION_COOKIE) ?? '', options.secret);
    if (existing) {
      request.ownerId = existing;
      return;
    }

    // No valid cookie: mint a new session. A tampered or expired cookie is treated
    // as "no session" rather than an error, so a user is never locked out — they
    // simply start fresh and cannot see the previous session's data.
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
