/**
 * The telemetry attribute allowlist.
 *
 * `ADR-0001-observability`: "Log redaction rules apply to every sink added later." An
 * allowlist is a *stronger* guarantee than a redaction pass: a regex table can miss a
 * novel secret shape, but a key that is not on this list is never exported at all —
 * there is nothing to redact because nothing textual beyond an enumerated value is
 * ever admitted. Keep this list deliberately short. Adding a key here is a decision
 * someone makes on purpose, not an incidental side effect of a call site passing more
 * data than it needed to.
 *
 * MUST NEVER be admitted here, however tempting at a call site: an owner or session
 * id, a configuration name, a keymap binding, a storage key, a filesystem path, or raw
 * build-log text. None of those describe a build's outcome in closed, low-cardinality
 * terms; all of them are exactly the content `claude.md` § Build isolation and
 * `ADR-0001-observability` require redacted from every sink.
 */
import type { BuildAdmissionCap } from '@qmk-web-app/build-queue';
import { BUILD_STATUSES, type BuildFailureCode, type BuildStatus } from '@qmk-web-app/domain';

/**
 * Mirrors `BuildFailureCode` (`packages/domain/src/build.ts`). That type is a plain
 * union with no backing const array to import, so the closed set is restated here —
 * once, in the one file whose entire job is enumerating closed sets.
 */
const BUILD_FAILURE_CODES: readonly BuildFailureCode[] = [
  'COMPILE_FAILED',
  'TIMEOUT',
  'RESOURCE_LIMIT',
  'GENERATION_FAILED',
  'ARTIFACT_NOT_PRODUCED',
  'ARTIFACT_REJECTED',
  'SANDBOX_ERROR',
  'CANCELLED',
];

/** Mirrors `BuildAdmissionCap` (`packages/build-queue/src/types.ts`), same reason. */
const BUILD_ADMISSION_CAPS: readonly BuildAdmissionCap[] = [
  'global_active',
  'owner_active',
  'owner_hourly',
];

/** A worker id is an operational identity (hostname + random suffix, or an operator-set env var), never user content — but it is still bounded, so a malformed caller cannot smuggle an unbounded string through it. */
const MAX_WORKER_ID_LENGTH = 256;

/**
 * The only attribute keys `telemetryAttributes` will ever admit, and each one's
 * permitted value domain. Every entry's `exportKey` is the name that actually reaches
 * the collector — snake_case, matching the dotted/underscored instrument names this
 * phase exports (`qwa.builds.failed`'s attribute is `failure_code`, for example) — kept
 * distinct from the camelCase field name call sites use, which follows this codebase's
 * own TypeScript convention.
 */
interface AttributeSpec {
  exportKey: string;
  validate: (value: unknown) => value is string | number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isEnumMember<T extends string>(members: readonly T[]) {
  return (value: unknown): value is T =>
    typeof value === 'string' && (members as readonly string[]).includes(value);
}

const ALLOWLIST: Record<string, AttributeSpec> = {
  status: { exportKey: 'status', validate: isEnumMember<BuildStatus>(BUILD_STATUSES) },
  failureCode: {
    exportKey: 'failure_code',
    validate: isEnumMember<BuildFailureCode>(BUILD_FAILURE_CODES),
  },
  cap: { exportKey: 'cap', validate: isEnumMember<BuildAdmissionCap>(BUILD_ADMISSION_CAPS) },
  workerId: {
    exportKey: 'worker_id',
    validate: (value): value is string =>
      typeof value === 'string' && value.length > 0 && value.length <= MAX_WORKER_ID_LENGTH,
  },
  count: { exportKey: 'count', validate: isFiniteNumber },
  durationMs: { exportKey: 'duration_ms', validate: isFiniteNumber },
};

/**
 * The only shape `telemetryAttributes` accepts. Deliberately a loose `Record` rather
 * than a literal interface at the parameter position: the point of this function is a
 * *runtime* allowlist, and a strict object-literal parameter type would let TypeScript's
 * excess-property check silently reject an out-of-allowlist key at compile time — which
 * would hide the exact failure mode a future call site needs to hit at runtime, not just
 * in the editor.
 */
export type TelemetryAttributeInput = Record<string, unknown>;

function describe(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Builds a validated OpenTelemetry attribute record from the closed allowlist above.
 * Throws, naming the offending key, for any key outside the allowlist or any value
 * outside that key's declared domain — see the module header for why this is an
 * allowlist rather than a redaction pass.
 *
 * Returns the narrower `Record<string, string | number>` rather than the full OTel
 * `Attributes` type (which also allows booleans and arrays) — every value this
 * allowlist can ever produce is a string or a number, and the narrower return type is
 * what lets the worker pipe the result straight into `redactAttributes`, whose string
 * table has nothing to say about a boolean or an array.
 */
export function telemetryAttributes(input: TelemetryAttributeInput): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const spec = ALLOWLIST[key];
    if (!spec) {
      throw new Error(`telemetryAttributes: "${key}" is not an allowed telemetry attribute key`);
    }
    if (!spec.validate(value)) {
      throw new Error(
        `telemetryAttributes: "${key}" has a value outside its allowed domain: ${describe(value)}`,
      );
    }
    result[spec.exportKey] = value;
  }
  return result;
}
