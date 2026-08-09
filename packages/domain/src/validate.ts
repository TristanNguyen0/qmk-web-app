/**
 * Server-side validation of a configuration against the catalog it claims to target.
 *
 * The Zod schema proves a configuration is *structurally* legal. This module proves
 * it is legal *for a specific keyboard and layout* — the check claude.md § Configuration
 * model requires: "Validation must ensure all bound positionId values occur in the
 * selected layoutId; layer references exist; … and SOCD keys are distinct and present."
 *
 * This runs on every write and every build request, regardless of client validation
 * (claude.md § API/interface expectations).
 */
import { z } from 'zod';
import type { Catalog, SupportedCatalogKeyboard } from './catalog.ts';
import { configurationSchema, type Configuration } from './configuration.ts';
import { DomainError, ERROR_CODES, type FieldError } from './errors.ts';

export interface ValidationContext {
  catalog: Catalog;
}

function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/** Parses and structurally validates, raising CONFIG_INVALID with field-level detail. */
export function parseConfiguration(input: unknown): Configuration {
  const result = configurationSchema.safeParse(input);
  if (!result.success) {
    throw new DomainError(
      ERROR_CODES.CONFIG_INVALID,
      'configuration failed schema validation',
      toFieldErrors(result.error),
    );
  }
  return result.data;
}

function requireSupportedKeyboard(catalog: Catalog, keyboardId: string): SupportedCatalogKeyboard {
  const entry = catalog.keyboards.find((k) => k.keyboardId === keyboardId);
  if (!entry) {
    throw new DomainError(
      ERROR_CODES.CATALOG_KEYBOARD_UNAVAILABLE,
      'the selected keyboard is not in the active catalog',
    );
  }
  if (!entry.supported) {
    throw new DomainError(
      ERROR_CODES.CATALOG_KEYBOARD_UNAVAILABLE,
      'the selected keyboard is not supported by the active catalog',
    );
  }
  return entry;
}

/**
 * Full validation. Returns the catalog records the caller needs next, so a caller
 * cannot proceed without having gone through this function.
 */
export function validateConfiguration(
  input: unknown,
  context: ValidationContext,
): { configuration: Configuration; keyboard: SupportedCatalogKeyboard } {
  const configuration = parseConfiguration(input);
  const { catalog } = context;

  // A configuration built against a different catalog cannot be trusted: positions
  // and layouts may have shifted (claude.md § Source management: "Build configurations
  // against their catalog version, never 'latest'").
  if (configuration.catalogVersion !== catalog.catalogVersion) {
    throw new DomainError(
      ERROR_CODES.CONFIG_INVALID,
      'configuration targets a different catalog version than the one supplied',
      [{ path: 'catalogVersion', message: `expected ${catalog.catalogVersion}` }],
    );
  }
  if (configuration.qmkCommit !== catalog.qmkCommit) {
    throw new DomainError(
      ERROR_CODES.CONFIG_INVALID,
      'configuration targets a different QMK commit than the active catalog',
      [{ path: 'qmkCommit', message: `expected ${catalog.qmkCommit}` }],
    );
  }

  const keyboard = requireSupportedKeyboard(catalog, configuration.keyboardId);

  const layout = keyboard.layouts.find((l) => l.name === configuration.layoutId);
  if (!layout) {
    throw new DomainError(
      ERROR_CODES.CATALOG_LAYOUT_UNAVAILABLE,
      'the selected layout is not available for this keyboard',
      [{ path: 'layoutId', message: 'not a layout of the selected keyboard' }],
    );
  }

  const validPositions = new Set(layout.positions.map((p) => p.index));
  const fieldErrors: FieldError[] = [];

  configuration.layers.forEach((layer, li) => {
    for (const position of Object.keys(layer.bindings)) {
      const index = Number(position);
      if (!validPositions.has(index)) {
        fieldErrors.push({
          path: `layers.${li}.bindings.${position}`,
          message: `position ${index} does not exist in layout ${layout.name}`,
        });
      }
    }
  });

  if (configuration.socd) {
    // SOCD is schema-valid but not yet generatable; see claude.md rule 9 and the note
    // in configuration.ts. Reject enabling it rather than silently ignoring the flag.
    if (configuration.socd.enabled) {
      throw new DomainError(
        ERROR_CODES.CAPABILITY_UNAVAILABLE,
        'SOCD support is not yet verified for this QMK revision and cannot be enabled',
        [{ path: 'socd.enabled', message: 'unavailable in this catalog version' }],
      );
    }
    for (const [direction, position] of Object.entries(configuration.socd.directionalKeys)) {
      if (!validPositions.has(position)) {
        fieldErrors.push({
          path: `socd.directionalKeys.${direction}`,
          message: `position ${position} does not exist in layout ${layout.name}`,
        });
      }
    }
  }

  if (fieldErrors.length > 0) {
    throw new DomainError(
      ERROR_CODES.CONFIG_INVALID,
      'configuration references positions that do not exist in the selected layout',
      fieldErrors,
    );
  }

  return { configuration, keyboard };
}
