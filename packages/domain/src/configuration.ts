/**
 * The versioned typed configuration schema (claude.md § Configuration model).
 *
 * Rules encoded here:
 *  - Unknown fields are rejected (`.strict()`), never silently dropped.
 *  - Every binding parameter comes from an allowlist; there is no free-form string
 *    that reaches generated source.
 *  - Structural validation only. Cross-checks that need catalog data (do these
 *    positions exist in this layout?) live in `validateAgainstLayout`, because they
 *    cannot be expressed without the catalog record.
 */
import { z } from 'zod';
import { LIMITS } from './limits.ts';
import { MOD_TAP_MODIFIERS, SOCD_DIRECTIONAL_KEYCODES, SUPPORTED_KEYCODE_NAMES } from './keycodes.ts';

export const SCHEMA_VERSION = 1;

const supportedKeycode = z
  .string()
  .refine((v) => SUPPORTED_KEYCODE_NAMES.has(v), {
    message: 'keycode is not in the supported catalog for this product version',
  });

const modTapModifier = z
  .string()
  .refine((v) => MOD_TAP_MODIFIERS.has(v), { message: 'not a supported mod-tap modifier' });

const layerIndex = z.number().int().min(0).max(LIMITS.maxLayers - 1);

/**
 * A position id is the index of the key within the layout's `layout` array as
 * reported by QMK. It is validated against the real layout in `validateAgainstLayout`.
 */
export const positionIdSchema = z.number().int().min(0).max(LIMITS.maxPositionsPerLayout - 1);

export const macroIdSchema = z.string().uuid();

/** Binding is a discriminated union — claude.md § Configuration model. */
export const bindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('keycode'), keycode: supportedKeycode }).strict(),
  z.object({ kind: z.literal('transparent') }).strict(),
  z.object({ kind: z.literal('no_op') }).strict(),
  z.object({ kind: z.literal('layer_momentary'), layer: layerIndex }).strict(),
  z.object({ kind: z.literal('layer_toggle'), layer: layerIndex }).strict(),
  z.object({ kind: z.literal('layer_tap'), layer: layerIndex, tap: supportedKeycode }).strict(),
  z.object({ kind: z.literal('mod_tap'), hold: modTapModifier, tap: supportedKeycode }).strict(),
  z.object({ kind: z.literal('macro'), macroId: macroIdSchema }).strict(),
]);

export type Binding = z.infer<typeof bindingSchema>;

export const layerSchema = z
  .object({
    id: z.string().uuid(),
    index: layerIndex,
    name: z.string().min(1).max(LIMITS.maxLayerNameLength),
    /**
     * Sparse by design: an absent position is "unassigned" and stays visibly
     * unassigned (claude.md § Visual keymap editor: "Preserve unassigned and
     * unsupported positions visibly; never silently remap them").
     */
    bindings: z.record(z.string().regex(/^\d+$/), bindingSchema),
  })
  .strict();

export type Layer = z.infer<typeof layerSchema>;

export const macroStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tap'), keycode: supportedKeycode }).strict(),
  z.object({ kind: z.literal('key_down'), keycode: supportedKeycode }).strict(),
  z.object({ kind: z.literal('key_up'), keycode: supportedKeycode }).strict(),
  z
    .object({ kind: z.literal('delay'), durationMs: z.number().int().min(1).max(LIMITS.maxMacroStepDelayMs) })
    .strict(),
]);

export type MacroStep = z.infer<typeof macroStepSchema>;

export const macroSchema = z
  .object({
    id: macroIdSchema,
    name: z.string().min(1).max(LIMITS.maxMacroNameLength),
    steps: z.array(macroStepSchema).min(1).max(LIMITS.maxMacroSteps),
  })
  .strict()
  .superRefine((macro, ctx) => {
    const totalDelay = macro.steps.reduce(
      (sum, s) => sum + (s.kind === 'delay' ? s.durationMs : 0),
      0,
    );
    if (totalDelay > LIMITS.maxMacroTotalDelayMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['steps'],
        message: `total macro delay ${totalDelay}ms exceeds the ${LIMITS.maxMacroTotalDelayMs}ms limit`,
      });
    }
    // A key held down and never released leaves the keyboard in a stuck state.
    const held = new Set<string>();
    macro.steps.forEach((step, i) => {
      if (step.kind === 'key_down') held.add(step.keycode);
      if (step.kind === 'key_up') {
        if (!held.delete(step.keycode)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['steps', i],
            message: `key_up for ${step.keycode} has no matching key_down`,
          });
        }
      }
    });
    for (const stuck of held) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['steps'],
        message: `${stuck} is pressed but never released; the macro would leave it held`,
      });
    }
  });

export type Macro = z.infer<typeof macroSchema>;

const socdDirectionalKeycode = z
  .string()
  .refine((v) => SOCD_DIRECTIONAL_KEYCODES.has(v), { message: 'not a supported SOCD direction key' });

/**
 * SOCD is declared here but is NOT enabled for generation yet.
 *
 * claude.md rule 9 requires the SOCD implementation to be verified against the exact
 * APIs present in the pinned revision before exposure. Until that verification
 * happens (Phase 4), `packages/qmk-generator` rejects any configuration with
 * `socd.enabled === true`, and the capability is reported unavailable.
 */
export const socdConfigurationSchema = z
  .object({
    enabled: z.boolean(),
    policyId: z.enum(['neutral', 'last_input_priority']),
    directionalKeys: z
      .object({
        up: positionIdSchema,
        down: positionIdSchema,
        left: positionIdSchema,
        right: positionIdSchema,
      })
      .strict(),
    directionalKeycodes: z
      .object({
        up: socdDirectionalKeycode,
        down: socdDirectionalKeycode,
        left: socdDirectionalKeycode,
        right: socdDirectionalKeycode,
      })
      .strict(),
  })
  .strict()
  .superRefine((socd, ctx) => {
    const positions = Object.values(socd.directionalKeys);
    if (new Set(positions).size !== positions.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['directionalKeys'],
        message: 'the four SOCD directional keys must be four distinct positions',
      });
    }
  });

export type SocdConfiguration = z.infer<typeof socdConfigurationSchema>;

export const configurationSchema = z
  .object({
    id: z.string().uuid(),
    /** Null only in deliberate anonymous mode (claude.md § Configuration model). */
    ownerId: z.string().uuid().nullable(),
    schemaVersion: z.literal(SCHEMA_VERSION),

    catalogVersion: z.string().min(1).max(64),
    qmkCommit: z.string().regex(/^[0-9a-f]{40}$/),
    keyboardId: z.string().min(1),
    layoutId: z.string().min(1),

    name: z.string().min(1).max(LIMITS.maxConfigurationNameLength),
    /** Optimistic concurrency token (claude.md § API/interface expectations). */
    revision: z.number().int().min(0),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),

    layers: z.array(layerSchema).min(1).max(LIMITS.maxLayers),
    macros: z.array(macroSchema).max(LIMITS.maxMacros),
    socd: socdConfigurationSchema.nullable(),

    generatorVersion: z.string().min(1).max(64),
  })
  .strict()
  .superRefine((config, ctx) => {
    // Layer indices must be unique, contiguous, and start at 0: generation emits a
    // positional array, so a gap would silently shift every later layer.
    const indices = config.layers.map((l) => l.index).sort((a, b) => a - b);
    const expected = indices.map((_, i) => i);
    if (indices.join(',') !== expected.join(',')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['layers'],
        message: 'layer indices must be unique and contiguous starting at 0',
      });
    }

    const layerCount = config.layers.length;
    const macroIds = new Set(config.macros.map((m) => m.id));
    if (macroIds.size !== config.macros.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['macros'], message: 'macro ids must be unique' });
    }

    config.layers.forEach((layer, li) => {
      for (const [position, binding] of Object.entries(layer.bindings)) {
        const at = ['layers', li, 'bindings', position] as const;
        if ('layer' in binding && binding.layer >= layerCount) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...at],
            message: `references layer ${binding.layer}, but only ${layerCount} layers exist`,
          });
        }
        if (binding.kind === 'macro' && !macroIds.has(binding.macroId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...at],
            message: `references macro ${binding.macroId}, which is not defined`,
          });
        }
      }
    });
  });

export type Configuration = z.infer<typeof configurationSchema>;
