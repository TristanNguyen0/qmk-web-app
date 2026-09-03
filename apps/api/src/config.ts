/**
 * Start-up configuration parsing.
 *
 * `requireEnv` and `parseTrustProxy` are pure functions over an injected environment
 * object rather than readers of `process.env` themselves — that is what makes the
 * start-up guards this file backs testable at all. Before this module existed, the
 * equivalent checks were top-level statements in `server.ts` that only a spawned
 * process could exercise (see `server.ts`'s own acceptance criteria for that
 * spawned-process assertion).
 */
import { isIP } from 'node:net';

export interface RequireEnvOptions {
  /** Extra guidance appended to the thrown message, e.g. a command that produces a valid value. */
  hint?: string;
}

/**
 * Reads `name` from `env`, treating an empty string the same as "absent" — a blank
 * environment variable is not a value, it is a misconfiguration wearing a costume.
 * Throws with a message naming the variable and, when supplied, `options.hint`.
 */
export function requireEnv(
  name: string,
  env: Record<string, string | undefined>,
  options: RequireEnvOptions = {},
): string {
  const value = env[name];
  if (value === undefined || value === '') {
    const hint = options.hint ? `\n\n${options.hint}` : '';
    throw new Error(`${name} is required but not set.${hint}`);
  }
  return value;
}

export interface ParseTrustProxyOptions {
  /** Production makes an unset value fatal; development treats it as "trust nothing." */
  production: boolean;
}

const BOOLEAN_ISH = new Set(['true', 'false', '1', '0', 'yes', 'no']);

/** True if `candidate` is a bare IPv4/IPv6 address or a CIDR of one. */
function isValidHostOrCidr(candidate: string): boolean {
  const slash = candidate.indexOf('/');
  const address = slash === -1 ? candidate : candidate.slice(0, slash);
  const family = isIP(address);
  if (family === 0) return false;
  if (slash === -1) return true;

  const prefix = candidate.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const prefixNum = Number(prefix);
  const maxPrefix = family === 4 ? 32 : 128;
  return prefixNum >= 0 && prefixNum <= maxPrefix;
}

/**
 * Parses `QWA_TRUST_PROXY` into the value Fastify's `trustProxy` option takes: a
 * specific address, CIDR, or comma-separated list of either — never a boolean.
 *
 * D-14's whole point is that `trustProxy: true` (trust every hop) lets a client set
 * `X-Forwarded-For` itself and claim any address, so every boolean-ish spelling is
 * rejected with a message explaining why, not silently coerced. An unset value trusts
 * nothing in development (the correct default for a host with no reverse proxy in
 * front of it) and is fatal in production (see Pitfall 3 in 05-RESEARCH.md: with no
 * trusted hop configured, `request.ip` is the reverse proxy's own address for every
 * request, silently collapsing every visitor into one rate-limit bucket).
 */
export function parseTrustProxy(
  value: string | undefined,
  options: ParseTrustProxyOptions,
): string | string[] | false {
  if (value === undefined || value === '') {
    if (options.production) {
      throw new Error(
        'QWA_TRUST_PROXY is required in production.\n\n' +
          'Name the exact reverse-proxy hop (an IP address or CIDR) allowed to set ' +
          'X-Forwarded-For — for example the load balancer or ingress in front of this ' +
          'process. The API must sit behind a reverse proxy that sets that header for ' +
          'this to be meaningful.',
      );
    }
    // No reverse proxy in development: trust nothing, so request.ip is the socket
    // address rather than a client-supplied header.
    return false;
  }

  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 1 && BOOLEAN_ISH.has(parts[0]!.toLowerCase())) {
    throw new Error(
      `QWA_TRUST_PROXY must name a specific reverse-proxy hop (an IP address or CIDR), ` +
        `not "${value}". Trusting every hop lets any client set X-Forwarded-For itself ` +
        'and claim any address, defeating IP-scoped controls entirely.',
    );
  }

  for (const part of parts) {
    if (!isValidHostOrCidr(part)) {
      throw new Error(
        `QWA_TRUST_PROXY contains an invalid address or CIDR: "${part}". ` +
          'Expected an IPv4/IPv6 address, a CIDR (e.g. "10.0.0.0/8"), or a comma-separated ' +
          'list of either.',
      );
    }
  }

  return parts.length === 1 ? parts[0]! : parts;
}
