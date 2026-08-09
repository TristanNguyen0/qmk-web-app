/**
 * Stable, user-safe error codes (claude.md § Error handling and user experience).
 *
 * These are part of the API contract: the code is stable and safe to show, while the
 * diagnostic detail stays server-side. No code here may embed a storage key, absolute
 * path, or internal identifier.
 */
export const ERROR_CODES = {
  CATALOG_KEYBOARD_UNAVAILABLE: 'CATALOG_KEYBOARD_UNAVAILABLE',
  CATALOG_LAYOUT_UNAVAILABLE: 'CATALOG_LAYOUT_UNAVAILABLE',
  CONFIG_INVALID: 'CONFIG_INVALID',
  CONFIG_CONFLICT: 'CONFIG_CONFLICT',
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  BUILD_QUEUE_LIMITED: 'BUILD_QUEUE_LIMITED',
  BUILD_TIMEOUT: 'BUILD_TIMEOUT',
  BUILD_RESOURCE_LIMIT: 'BUILD_RESOURCE_LIMIT',
  BUILD_COMPILE_FAILED: 'BUILD_COMPILE_FAILED',
  BUILD_INTERNAL_ERROR: 'BUILD_INTERNAL_ERROR',
  ARTIFACT_MISSING: 'ARTIFACT_MISSING',
  ARTIFACT_EXPIRED: 'ARTIFACT_EXPIRED',
  ARTIFACT_UNAUTHORIZED: 'ARTIFACT_UNAUTHORIZED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface FieldError {
  /** JSON path within the submitted configuration, e.g. `layers.0.bindings.12`. */
  path: string;
  message: string;
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors: readonly FieldError[];

  constructor(code: ErrorCode, message: string, fieldErrors: readonly FieldError[] = []) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}
