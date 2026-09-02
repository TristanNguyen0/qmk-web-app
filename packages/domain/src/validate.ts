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
import { SOCD_HORIZONTAL_PAIRS, SOCD_VERTICAL_PAIRS, socdCapabilitiesFor } from './socd.ts';

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
    const socd = configuration.socd;

    for (const [direction, position] of Object.entries(socd.directionalKeys)) {
      if (!validPositions.has(position)) {
        fieldErrors.push({
          path: `socd.directionalKeys.${direction}`,
          message: `position ${position} does not exist in layout ${layout.name}`,
        });
      }
    }

    if (socd.enabled) {
      // Compile-verified (catalogVersion, keyboardId) combinations only (claude.md §
      // SOCD Cleaner requirement 2: "Expose SOCD only for keyboards/builds that meet
      // its verified prerequisites"; D-02: the registry gate is catalog-version aware,
      // so a QMK pin bump withdraws availability until the compile matrix re-runs
      // against the new catalog version). This reads through the same registry lookup
      // `socdCapabilitiesFor` uses — the server never derives its own, second answer to
      // "is this available" — and is a capability answer, not a validation failure, so
      // it is raised immediately rather than collected with the field errors.
      const capabilities = socdCapabilitiesFor(configuration.catalogVersion, configuration.keyboardId);
      if (!capabilities.available) {
        throw new DomainError(
          ERROR_CODES.CAPABILITY_UNAVAILABLE,
          capabilities.reason ??
            `SOCD has not been compile-verified for this keyboard on catalog version ${configuration.catalogVersion}`,
          [{ path: 'socd.enabled', message: 'unavailable for this keyboard' }],
        );
      }

      // The module resolves fixed opposing pairs, so a configuration pairing, say, W
      // against Right has no implementation and must be rejected rather than generated
      // into something that silently does nothing.
      const { up, down, left, right } = socd.directionalKeycodes;
      const verticalOk = SOCD_VERTICAL_PAIRS.some(([a, b]) => a === up && b === down);
      const horizontalOk = SOCD_HORIZONTAL_PAIRS.some(([a, b]) => a === left && b === right);
      if (!verticalOk) {
        fieldErrors.push({
          path: 'socd.directionalKeycodes',
          message: `${up} and ${down} are not an opposing vertical pair; expected one of ${SOCD_VERTICAL_PAIRS.map((p) => p.join('/')).join(', ')}`,
        });
      }
      if (!horizontalOk) {
        fieldErrors.push({
          path: 'socd.directionalKeycodes',
          message: `${left} and ${right} are not an opposing horizontal pair; expected one of ${SOCD_HORIZONTAL_PAIRS.map((p) => p.join('/')).join(', ')}`,
        });
      }

      // SOCD replaces the base-layer binding at each directional position, so the
      // editor must already show that keycode there. Requiring the configuration to
      // agree keeps the rendered keymap honest: what a user sees on the base layer is
      // what SOCD will resolve (claude.md § SOCD Cleaner requirement 5).
      const baseLayer = configuration.layers.find((l) => l.index === 0);
      for (const [direction, position] of Object.entries(socd.directionalKeys)) {
        const expected = socd.directionalKeycodes[direction as keyof typeof socd.directionalKeycodes];
        const binding = baseLayer?.bindings[String(position)];
        if (!binding || binding.kind !== 'keycode' || binding.keycode !== expected) {
          fieldErrors.push({
            path: `socd.directionalKeys.${direction}`,
            message: `position ${position} must be bound to ${expected} on the base layer for SOCD to apply to it`,
          });
        }
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
