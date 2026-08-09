/**
 * Identifier and path validation.
 *
 * claude.md rule 5: "Do not use a user-controlled keyboard identifier as a filesystem
 * path until it has been matched to a discovered, validated keyboard record."
 * claude.md § Build isolation: "Validate identifiers with an allowlist and resolve
 * paths against a fixed workspace root; reject traversal, separators, NULs, and
 * unexpected Unicode normalization issues."
 *
 * Everything here is allowlist-based. Nothing sanitises by stripping characters —
 * a value either matches the allowed shape or it is rejected, because silently
 * rewriting an identifier is how a path escape becomes a valid-looking path.
 */

/**
 * QMK keyboard ids are slash-separated path segments, e.g. `planck/rev6`.
 * Segments are lowercase alphanumerics plus `_` and `-`.
 */
const KEYBOARD_ID_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/;
const MAX_KEYBOARD_ID_LENGTH = 128;
const MAX_SEGMENTS = 8;

/** QMK layout macro names, e.g. `LAYOUT_ortho_4x12`. */
const LAYOUT_NAME_RE = /^LAYOUT[A-Za-z0-9_]*$/;
const MAX_LAYOUT_NAME_LENGTH = 96;

/** Generated keymap directory names are ours, never the user's. */
const GENERATED_KEYMAP_RE = /^qwa_[0-9a-f]{8,32}$/;

export class IdentifierError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'IdentifierError';
    this.field = field;
  }
}

function assertNoUnicodeSurprises(value: string, field: string): void {
  if (value.normalize('NFC') !== value) {
    throw new IdentifierError(field, 'must be Unicode NFC-normalised');
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new IdentifierError(field, `contains a control character at offset ${i}`);
    }
  }
}

/**
 * Validates the *shape* of a keyboard id. This is necessary but NOT sufficient to
 * use as a path: the id must additionally be matched against a discovered catalog
 * record (rule 5). Use `resolveKeyboardPathSegments` for that step.
 */
export function assertValidKeyboardIdShape(value: unknown): asserts value is string {
  const field = 'keyboardId';
  if (typeof value !== 'string') throw new IdentifierError(field, 'must be a string');
  if (value.length === 0) throw new IdentifierError(field, 'must not be empty');
  if (value.length > MAX_KEYBOARD_ID_LENGTH) {
    throw new IdentifierError(field, `must be at most ${MAX_KEYBOARD_ID_LENGTH} characters`);
  }
  assertNoUnicodeSurprises(value, field);
  if (!KEYBOARD_ID_RE.test(value)) {
    throw new IdentifierError(field, 'must be lowercase slash-separated [a-z0-9_-] segments');
  }
  const segments = value.split('/');
  if (segments.length > MAX_SEGMENTS) {
    throw new IdentifierError(field, `must have at most ${MAX_SEGMENTS} path segments`);
  }
  // The regex already excludes these, but assert explicitly: this is the check that
  // matters most, and it should be obvious to a reviewer that it exists.
  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      throw new IdentifierError(field, 'must not contain relative path segments');
    }
  }
}

export function isValidKeyboardIdShape(value: unknown): value is string {
  try {
    assertValidKeyboardIdShape(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts a keyboard id into path segments, but only after the caller has proven the
 * id exists in the validated catalog. `knownKeyboardIds` must come from a published
 * catalog, never from the request.
 */
export function resolveKeyboardPathSegments(
  keyboardId: unknown,
  knownKeyboardIds: ReadonlySet<string>,
): string[] {
  assertValidKeyboardIdShape(keyboardId);
  if (!knownKeyboardIds.has(keyboardId)) {
    throw new IdentifierError(
      'keyboardId',
      'is not a keyboard in the active catalog; refusing to use it as a path',
    );
  }
  return keyboardId.split('/');
}

export function assertValidLayoutName(value: unknown): asserts value is string {
  const field = 'layoutId';
  if (typeof value !== 'string') throw new IdentifierError(field, 'must be a string');
  if (value.length > MAX_LAYOUT_NAME_LENGTH) {
    throw new IdentifierError(field, `must be at most ${MAX_LAYOUT_NAME_LENGTH} characters`);
  }
  assertNoUnicodeSurprises(value, field);
  if (!LAYOUT_NAME_RE.test(value)) {
    throw new IdentifierError(field, 'must be a QMK LAYOUT macro name');
  }
}

/**
 * The on-disk keymap name for a build.
 *
 * claude.md § Deterministic generation, step 5: "Use a fixed safe keymap name derived
 * from the build id; never use a raw user name."
 */
export function generatedKeymapName(buildId: string): string {
  const hex = buildId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{8,32}$/.test(hex)) {
    throw new IdentifierError('buildId', 'must be a hex/UUID identifier');
  }
  const name = `qwa_${hex.slice(0, 32)}`;
  // Belt and braces: the value we just built must satisfy the consumer's allowlist.
  if (!GENERATED_KEYMAP_RE.test(name)) {
    throw new IdentifierError('buildId', 'produced an invalid generated keymap name');
  }
  return name;
}

export function isGeneratedKeymapName(value: string): boolean {
  return GENERATED_KEYMAP_RE.test(value);
}
