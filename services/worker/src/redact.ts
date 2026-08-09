/**
 * Log sanitisation before anything reaches a user.
 *
 * claude.md § Build isolation: "Redact credentials, signed URLs, environment
 * variables, and absolute infrastructure paths from user-visible logs. Cap logs."
 *
 * A compiler log is genuinely useful to the person who requested the build, so the
 * goal is to keep the diagnostics and drop the infrastructure.
 */

/** Container-internal paths are meaningless to users and reveal our layout. */
const PATH_REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
  [/\/workspace\/userspace\/keyboards\//g, ''],
  [/\/workspace\/qmkroot\//g, ''],
  [/\/workspace\/build\//g, ''],
  [/\/workspace\/tmp\//g, ''],
  [/\/workspace\/home\//g, ''],
  [/\/workspace\//g, ''],
  [/\/qmk\//g, ''],
];

const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  // Query strings on URLs are where signed-URL credentials live.
  [/(https?:\/\/[^\s?]+)\?[^\s]*/g, '$1?[redacted]'],
  // KEY=value / TOKEN=value / SECRET=value / PASSWORD=value in any casing.
  [/\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*)=\S+/gi, '$1=[redacted]'],
  // Bearer tokens.
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]'],
  // AWS-style access key ids.
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]'],
];

export interface RedactOptions {
  /** Bytes of log retained after redaction. */
  maxBytes?: number;
  /** Host paths to strip, e.g. the QMK checkout location. */
  extraPaths?: readonly string[];
}

export const DEFAULT_MAX_LOG_BYTES = 256 * 1024;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactLog(raw: string, options: RedactOptions = {}): string {
  let text = raw;

  for (const path of options.extraPaths ?? []) {
    if (path.length > 1) {
      text = text.replace(new RegExp(`${escapeRegExp(path)}/?`, 'g'), '');
    }
  }
  for (const [pattern, replacement] of PATH_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_LOG_BYTES;
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= maxBytes) return text;

  // Keep the tail: compiler errors appear at the end of the log.
  const kept = buffer.subarray(buffer.byteLength - maxBytes).toString('utf8');
  return `[log truncated to the last ${maxBytes} bytes]\n${kept}`;
}
