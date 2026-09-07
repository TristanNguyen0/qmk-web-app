/**
 * UUIDs for ids the browser mints (layers, macros, build idempotency keys).
 *
 * `crypto.randomUUID` exists only in a secure context. Served from a plain-HTTP
 * origin — `http://<lan-ip>:3000` during development, or behind a proxy that
 * terminates TLS elsewhere — it is `undefined`, and calling it throws a TypeError
 * before any request is made. `crypto.getRandomValues` carries no such restriction,
 * so the fallback keeps the same randomness source and only lays the bytes out as an
 * RFC 4122 version 4 UUID by hand. The server validates these with `z.string().uuid()`,
 * so the version and variant bits are not cosmetic.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
