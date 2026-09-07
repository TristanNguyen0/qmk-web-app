/**
 * The assistant's output contract: what a language model is allowed to *propose*.
 *
 * The model never produces a configuration, a keycode token for generation, or any
 * text that reaches source. It produces a list of small, typed operations in this
 * vocabulary plus an explicit list of requests it could not honour. `resolve.ts`
 * turns the operations into a candidate configuration, and that candidate goes
 * through exactly the same `validateConfiguration` as a hand-edited one. A model
 * output is therefore untrusted input of the same standing as an imported JSON file.
 *
 * Two design rules:
 *  - References are *loose* where a model is good at it (a key by its legend, a layer
 *    by its name) and *strict* where it is not (nothing here is a QMK token that would
 *    be emitted verbatim). Every loose reference is resolved by code against the
 *    catalog and the current document, or reported as an issue.
 *  - Unsupported requests are a first-class output, not a chat aside. A request the
 *    product cannot express must land in `unsupported`, so the UI can show it and the
 *    product can see the demand (see docs/adr/0007).
 */
import { z } from 'zod';
import { LIMITS } from '@qmk-web-app/domain';

/** Short free text that reaches only the UI, never generation. */
const shortText = z.string().trim().min(1).max(200);

/**
 * A physical key. `position` is the layout index shown in the context as `[12:Del]`
 * and is always unambiguous; `key` is a legend/keycode looked up on the base layer and
 * the catalog, and may be ambiguous (two space bars), in which case the resolver asks
 * for a position rather than guessing.
 */
export const keyRefSchema = z.union([
  z.object({ position: z.number().int().min(0).max(LIMITS.maxPositionsPerLayout - 1) }).strict(),
  z.object({ key: shortText }).strict(),
]);
export type KeyRef = z.infer<typeof keyRefSchema>;

/** A layer by index or by (case-insensitive) name; `base` is layer 0. */
export const layerRefSchema = z.union([z.number().int().min(0).max(LIMITS.maxLayers - 1), shortText]);
export type LayerRef = z.infer<typeof layerRefSchema>;

/**
 * A keycode as the model names it: canonical (`KC_DELETE`), QMK alias (`KC_DEL`), the
 * editor's label (`Del`), or a common name (`delete`). Resolved to a supported
 * keycode or rejected; nothing outside the supported catalog can get through.
 */
export const keycodeRefSchema = shortText;

export const bindingSpecSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('keycode'), keycode: keycodeRefSchema }).strict(),
  z.object({ type: z.literal('transparent') }).strict(),
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('layer_momentary'), layer: layerRefSchema }).strict(),
  z.object({ type: z.literal('layer_toggle'), layer: layerRefSchema }).strict(),
  z.object({ type: z.literal('layer_tap'), layer: layerRefSchema, tap: keycodeRefSchema }).strict(),
  z.object({ type: z.literal('mod_tap'), hold: keycodeRefSchema, tap: keycodeRefSchema }).strict(),
  z.object({ type: z.literal('macro'), macro: shortText }).strict(),
]);
export type BindingSpec = z.infer<typeof bindingSpecSchema>;

export const macroStepSpecSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tap'), keycode: keycodeRefSchema }).strict(),
  z.object({ type: z.literal('down'), keycode: keycodeRefSchema }).strict(),
  z.object({ type: z.literal('up'), keycode: keycodeRefSchema }).strict(),
  z.object({ type: z.literal('delay'), ms: z.number().int().min(1).max(LIMITS.maxMacroStepDelayMs) }).strict(),
]);
export type MacroStepSpec = z.infer<typeof macroStepSpecSchema>;

export const operationSchema = z.discriminatedUnion('op', [
  /** Replace every layer with QMK's default keymap for this keyboard, as the catalog carries it. */
  z.object({ op: z.literal('apply_default_keymap') }).strict(),
  /**
   * Replace every layer with QMK's canonical keymap for one of the community layouts the
   * context lists for this keyboard (`60_hhkb`, `60_ansi_wkl`, `tkl_iso`, …).
   */
  z.object({ op: z.literal('apply_layout_preset'), preset: shortText }).strict(),

  z.object({ op: z.literal('set_key'), layer: layerRefSchema, key: keyRefSchema, binding: bindingSpecSchema }).strict(),
  z.object({ op: z.literal('clear_key'), layer: layerRefSchema, key: keyRefSchema }).strict(),

  /** New layer, appended. `fill` transparent (default) lets the layer below show through. */
  z
    .object({
      op: z.literal('add_layer'),
      name: z.string().trim().min(1).max(LIMITS.maxLayerNameLength),
      fill: z.enum(['transparent', 'empty']).default('transparent'),
    })
    .strict(),
  z.object({ op: z.literal('rename_layer'), layer: layerRefSchema, name: z.string().trim().min(1).max(LIMITS.maxLayerNameLength) }).strict(),
  z.object({ op: z.literal('remove_layer'), layer: layerRefSchema }).strict(),

  z
    .object({
      op: z.literal('add_macro'),
      name: z.string().trim().min(1).max(LIMITS.maxMacroNameLength),
      steps: z.array(macroStepSpecSchema).min(1).max(LIMITS.maxMacroSteps),
    })
    .strict(),
  z.object({ op: z.literal('remove_macro'), name: shortText }).strict(),

  /**
   * Enable SOCD on four base-layer keys. The keycodes are read from what those keys
   * are bound to on the base layer; the pair must be one the module implements.
   */
  z
    .object({
      op: z.literal('set_socd'),
      policy: shortText,
      up: keyRefSchema,
      down: keyRefSchema,
      left: keyRefSchema,
      right: keyRefSchema,
    })
    .strict(),
  z.object({ op: z.literal('disable_socd') }).strict(),

  z.object({ op: z.literal('rename_configuration'), name: z.string().trim().min(1).max(LIMITS.maxConfigurationNameLength) }).strict(),
]);
export type Operation = z.infer<typeof operationSchema>;

export const unsupportedRequestSchema = z
  .object({
    /** The user's ask, in their terms. */
    request: z.string().trim().min(1).max(300),
    /** Why the product cannot express it, in plain language. */
    reason: z.string().trim().min(1).max(500),
    /** What was done instead, if anything. */
    alternative: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type UnsupportedRequest = z.infer<typeof unsupportedRequestSchema>;

export const MAX_OPERATIONS = 400;

export const assistantProposalSchema = z
  .object({
    /** One or two sentences for the user describing the proposed change. */
    summary: z.string().trim().min(1).max(600),
    operations: z.array(operationSchema).max(MAX_OPERATIONS),
    unsupported: z.array(unsupportedRequestSchema).max(50).default([]),
  })
  .strict();
export type AssistantProposal = z.infer<typeof assistantProposalSchema>;

/**
 * Parses model output. Kept separate from `resolve` so a malformed proposal is
 * reported as such — a distinct failure from a well-formed proposal the product
 * cannot honour.
 */
export function parseProposal(input: unknown): { ok: true; proposal: AssistantProposal } | { ok: false; errors: string[] } {
  const result = assistantProposalSchema.safeParse(input);
  if (result.success) return { ok: true, proposal: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}
