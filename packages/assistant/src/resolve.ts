/**
 * Applies a parsed proposal to a configuration, producing a *candidate* the user can
 * review, and never anything else.
 *
 * Operations run in order against a working copy, so `add_layer` followed by
 * `set_key` on that layer by name works. An operation that cannot be resolved is
 * recorded as an issue and skipped; the rest still apply, because a review UI (and a
 * retry prompt) is better served by "here is everything, and here is what failed"
 * than by an all-or-nothing error. The caller decides whether partial success is
 * acceptable — `ok` is true only when every operation applied *and* the candidate
 * passes the same `validateConfiguration` a hand edit must pass.
 *
 * The candidate is a whole document rather than a list of editor actions so the UI
 * can apply it as one undoable step ("apply assistant proposal").
 */
import {
  DomainError,
  LIMITS,
  SOCD_DIRECTIONAL_KEYCODES,
  SOCD_POLICIES,
  importCommunityKeymap,
  importDefaultKeymap,
  validateConfiguration,
  type Binding,
  type Catalog,
  type CatalogLayout,
  type Configuration,
  type FieldError,
  type Layer,
  type Macro,
  type MacroStep,
  type SupportedCatalogKeyboard,
} from '@qmk-web-app/domain';
import type { AssistantProposal, BindingSpec, KeyRef, LayerRef, Operation } from './proposal.ts';
import { describePosition, resolveKey, resolveKeycode, resolveLayer, type RefFailure } from './refs.ts';

export interface ResolutionIssue {
  /** Index into `proposal.operations`. */
  operation: number;
  op: Operation['op'];
  reason: string;
  candidates?: string[];
}

export interface ChangeSummary {
  description: string;
  layerIndex?: number;
  position?: number;
}

export interface ResolvedProposal {
  /** True only when every operation applied and the candidate validates. */
  ok: boolean;
  candidate: Configuration;
  changes: ChangeSummary[];
  issues: ResolutionIssue[];
  validation: { ok: true } | { ok: false; code: string; message: string; fieldErrors: readonly FieldError[] };
  /** Passed through from the proposal for the UI. */
  summary: string;
  unsupported: AssistantProposal['unsupported'];
}

export interface ResolveOptions {
  configuration: Configuration;
  /** Must contain the configuration's keyboard; the API's single-keyboard catalog is fine. */
  catalog: Catalog;
  proposal: AssistantProposal;
  /** Injected for deterministic tests. */
  newId?: () => string;
}

type Failure = string | Pick<RefFailure, 'reason' | 'candidates'>;

class OperationError extends Error {
  readonly candidates: string[] | undefined;
  constructor(failure: Failure) {
    super(typeof failure === 'string' ? failure : failure.reason);
    this.candidates = typeof failure === 'string' ? undefined : failure.candidates;
  }
}

function fail(failure: Failure): never {
  throw new OperationError(failure);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

interface Ctx {
  doc: Configuration;
  keyboard: SupportedCatalogKeyboard;
  layout: CatalogLayout;
  aliases: Readonly<Record<string, string>>;
  communityKeymaps: Catalog['communityKeymaps'];
  newId: () => string;
  changes: ChangeSummary[];
}

function layerAt(doc: Configuration, index: number): Layer {
  const layer = doc.layers.find((l) => l.index === index);
  if (!layer) fail(`layer ${index} does not exist`);
  return layer;
}

function baseLayer(doc: Configuration): Layer | undefined {
  return doc.layers.find((l) => l.index === 0);
}

function needLayer(ctx: Ctx, ref: LayerRef): number {
  const r = resolveLayer(ref, ctx.doc.layers);
  if (!r.ok) fail(r);
  return r.index;
}

function needKey(ctx: Ctx, ref: KeyRef): number {
  const r = resolveKey(ref, { layout: ctx.layout, baseLayer: baseLayer(ctx.doc), aliases: ctx.aliases });
  if (!r.ok) fail(r);
  return r.position;
}

function needKeycode(ctx: Ctx, ref: string, role: string): string {
  const name = resolveKeycode(ref, ctx.aliases);
  if (!name) {
    fail(
      `"${ref}" is not a keycode this product supports${role ? ` (as ${role})` : ''}. ` +
        'Supported keycodes are listed in the context; anything else must go in `unsupported`.',
    );
  }
  return name;
}

/** A plain key keycode: excludes the two placeholders, which have their own binding kinds. */
function needPlainKeycode(ctx: Ctx, ref: string, role: string): string {
  const name = needKeycode(ctx, ref, role);
  if (name === 'KC_TRANSPARENT') fail(`use {"type":"transparent"} rather than a keycode for ${role}`);
  if (name === 'KC_NO') fail(`use {"type":"none"} rather than a keycode for ${role}`);
  return name;
}

const MOD_TAP_HOLDS = new Set([
  'KC_LEFT_CTRL', 'KC_LEFT_SHIFT', 'KC_LEFT_ALT', 'KC_LEFT_GUI',
  'KC_RIGHT_CTRL', 'KC_RIGHT_SHIFT', 'KC_RIGHT_ALT', 'KC_RIGHT_GUI',
]);

function bindingFromSpec(ctx: Ctx, spec: BindingSpec): Binding {
  switch (spec.type) {
    case 'keycode': {
      const keycode = needKeycode(ctx, spec.keycode, 'the key');
      if (keycode === 'KC_TRANSPARENT') return { kind: 'transparent' };
      if (keycode === 'KC_NO') return { kind: 'no_op' };
      return { kind: 'keycode', keycode };
    }
    case 'transparent':
      return { kind: 'transparent' };
    case 'none':
      return { kind: 'no_op' };
    case 'layer_momentary':
      return { kind: 'layer_momentary', layer: needLayer(ctx, spec.layer) };
    case 'layer_toggle':
      return { kind: 'layer_toggle', layer: needLayer(ctx, spec.layer) };
    case 'layer_tap':
      return { kind: 'layer_tap', layer: needLayer(ctx, spec.layer), tap: needPlainKeycode(ctx, spec.tap, 'the tap key') };
    case 'mod_tap': {
      const hold = needKeycode(ctx, spec.hold, 'the held modifier');
      if (!MOD_TAP_HOLDS.has(hold)) {
        fail(`${hold} is not a modifier; a mod_tap hold must be one of ${[...MOD_TAP_HOLDS].join(', ')}`);
      }
      return { kind: 'mod_tap', hold, tap: needPlainKeycode(ctx, spec.tap, 'the tap key') };
    }
    case 'macro': {
      const wanted = spec.macro.trim().toLowerCase();
      const matches = ctx.doc.macros.filter((m) => m.name.trim().toLowerCase() === wanted);
      if (matches.length === 0) {
        fail({
          reason: `no macro is named "${spec.macro}"; add it first with add_macro`,
          candidates: ctx.doc.macros.map((m) => m.name),
        });
      }
      if (matches.length > 1) fail(`more than one macro is named "${spec.macro}"; rename one first`);
      return { kind: 'macro', macroId: matches[0]!.id };
    }
    default: {
      const never: never = spec;
      throw new Error(`unhandled binding spec: ${JSON.stringify(never)}`);
    }
  }
}

function describeBinding(binding: Binding, doc: Configuration): string {
  switch (binding.kind) {
    case 'keycode':
      return binding.keycode;
    case 'transparent':
      return 'transparent';
    case 'no_op':
      return 'no-op';
    case 'layer_momentary':
      return `MO(${binding.layer})`;
    case 'layer_toggle':
      return `TG(${binding.layer})`;
    case 'layer_tap':
      return `LT(${binding.layer}, ${binding.tap})`;
    case 'mod_tap':
      return `${binding.hold} when held, ${binding.tap} when tapped`;
    case 'macro':
      return `macro "${doc.macros.find((m) => m.id === binding.macroId)?.name ?? '?'}"`;
  }
}

function applyOperation(ctx: Ctx, operation: Operation): void {
  const { doc } = ctx;
  switch (operation.op) {
    case 'apply_default_keymap': {
      const imported = importDefaultKeymap({
        keyboard: ctx.keyboard,
        layoutId: doc.layoutId,
        keycodeAliases: ctx.aliases,
        newId: ctx.newId,
      });
      if (!imported.available) {
        fail(`this keyboard has no usable QMK default keymap in the catalog (${imported.reason}); build the layers explicitly instead`);
      }
      doc.layers = imported.layers;
      // The base layer just changed under any SOCD keys, so the previous SOCD
      // selection no longer describes what is on those keys. Drop it visibly rather
      // than let validation fail later on a stale reference.
      if (doc.socd) {
        doc.socd = null;
        ctx.changes.push({ description: 'SOCD disabled because the base layer was replaced; set it again if wanted' });
      }
      ctx.changes.push({
        description:
          `Replaced all layers with QMK's default keymap (${imported.source}): ${imported.layers.length} layer${imported.layers.length === 1 ? '' : 's'}` +
          (imported.unmapped.length > 0 ? `; ${imported.unmapped.length} key${imported.unmapped.length === 1 ? '' : 's'} QMK binds to unsupported features left unassigned` : ''),
      });
      return;
    }

    case 'apply_layout_preset': {
      const offered = ctx.keyboard.communityLayouts ?? [];
      const wanted = operation.preset.trim().toLowerCase().replace(/[\s-]+/g, '_');
      // Exact name first; then a unique name containing the request ("hhkb" → 60_hhkb).
      let matches = offered.filter((c) => c.name === wanted);
      if (matches.length === 0) matches = offered.filter((c) => c.name.includes(wanted));
      if (matches.length !== 1) {
        fail({
          reason:
            matches.length === 0
              ? `"${operation.preset}" is not a layout preset available for this keyboard`
              : `"${operation.preset}" matches more than one preset; name one exactly`,
          candidates: (matches.length === 0 ? offered : matches).map((c) => c.name),
        });
      }
      const name = matches[0]!.name;
      const imported = importCommunityKeymap({
        keyboard: ctx.keyboard,
        layoutId: doc.layoutId,
        name,
        communityKeymaps: ctx.communityKeymaps,
        keycodeAliases: ctx.aliases,
        newId: ctx.newId,
      });
      if (!imported.available) fail(`the ${name} preset cannot be applied: ${imported.reason}`);
      doc.layers = imported.layers;
      if (doc.socd) {
        doc.socd = null;
        ctx.changes.push({ description: 'SOCD disabled because the base layer was replaced; set it again if wanted' });
      }
      ctx.changes.push({
        description:
          `Replaced all layers with QMK's ${name} layout preset (${imported.source}): ${imported.layers.length} layer${imported.layers.length === 1 ? '' : 's'}` +
          (imported.unmapped.length > 0 ? `; ${imported.unmapped.length} key${imported.unmapped.length === 1 ? '' : 's'} it binds to unsupported features left unassigned` : '') +
          (imported.unmatchedPositions > 0 ? `; ${imported.unmatchedPositions} key${imported.unmatchedPositions === 1 ? '' : 's'} of this layout have no place in that preset and stay unassigned` : ''),
      });
      return;
    }

    case 'set_key': {
      const layerIndex = needLayer(ctx, operation.layer);
      const position = needKey(ctx, operation.key);
      const binding = bindingFromSpec(ctx, operation.binding);
      layerAt(doc, layerIndex).bindings[String(position)] = binding;
      ctx.changes.push({
        description: `Layer ${layerIndex}: ${describePosition(position, ctx.layout)} → ${describeBinding(binding, doc)}`,
        layerIndex,
        position,
      });
      return;
    }

    case 'clear_key': {
      const layerIndex = needLayer(ctx, operation.layer);
      const position = needKey(ctx, operation.key);
      const layer = layerAt(doc, layerIndex);
      if (!(String(position) in layer.bindings)) return; // already unassigned; nothing to report
      delete layer.bindings[String(position)];
      ctx.changes.push({
        description: `Layer ${layerIndex}: ${describePosition(position, ctx.layout)} left unassigned`,
        layerIndex,
        position,
      });
      return;
    }

    case 'add_layer': {
      if (doc.layers.length >= LIMITS.maxLayers) {
        fail(`the configuration already has the maximum of ${LIMITS.maxLayers} layers`);
      }
      const index = doc.layers.length;
      const bindings: Layer['bindings'] = {};
      if (operation.fill === 'transparent') {
        for (const p of ctx.layout.positions) bindings[String(p.index)] = { kind: 'transparent' };
      }
      doc.layers.push({ id: ctx.newId(), index, name: operation.name, bindings });
      ctx.changes.push({ description: `Added layer ${index} "${operation.name}" (${operation.fill})`, layerIndex: index });
      return;
    }

    case 'rename_layer': {
      const index = needLayer(ctx, operation.layer);
      const layer = layerAt(doc, index);
      if (layer.name === operation.name) return;
      ctx.changes.push({ description: `Renamed layer ${index} "${layer.name}" → "${operation.name}"`, layerIndex: index });
      layer.name = operation.name;
      return;
    }

    case 'remove_layer': {
      const index = needLayer(ctx, operation.layer);
      if (index === 0) fail('layer 0 is the base layer and cannot be removed');
      const removed = layerAt(doc, index);
      const remaining = doc.layers.filter((l) => l.index !== index).sort((a, b) => a.index - b.index);
      // Indices stay contiguous (the generator emits a positional array); references
      // to moved layers follow them, references to the removed layer are dropped.
      const remap = new Map<number, number>();
      remaining.forEach((layer, at) => {
        remap.set(layer.index, at);
        layer.index = at;
      });
      let dropped = 0;
      for (const layer of remaining) {
        for (const [key, binding] of Object.entries(layer.bindings)) {
          if (!('layer' in binding)) continue;
          const target = remap.get(binding.layer);
          if (target === undefined) {
            delete layer.bindings[key];
            dropped += 1;
          } else {
            layer.bindings[key] = { ...binding, layer: target };
          }
        }
      }
      doc.layers = remaining;
      ctx.changes.push({
        description: `Removed layer ${index} "${removed.name}"` + (dropped > 0 ? `; ${dropped} key${dropped === 1 ? '' : 's'} that switched to it left unassigned` : ''),
      });
      return;
    }

    case 'add_macro': {
      if (doc.macros.length >= LIMITS.maxMacros) fail(`the configuration already has the maximum of ${LIMITS.maxMacros} macros`);
      if (doc.macros.some((m) => m.name.trim().toLowerCase() === operation.name.trim().toLowerCase())) {
        fail(`a macro named "${operation.name}" already exists`);
      }
      const steps: MacroStep[] = operation.steps.map((step) => {
        switch (step.type) {
          case 'tap':
            return { kind: 'tap', keycode: needPlainKeycode(ctx, step.keycode, 'a macro step') };
          case 'down':
            return { kind: 'key_down', keycode: needPlainKeycode(ctx, step.keycode, 'a macro step') };
          case 'up':
            return { kind: 'key_up', keycode: needPlainKeycode(ctx, step.keycode, 'a macro step') };
          case 'delay':
            return { kind: 'delay', durationMs: step.ms };
        }
      });
      const macro: Macro = { id: ctx.newId(), name: operation.name, steps };
      doc.macros.push(macro);
      ctx.changes.push({ description: `Added macro "${operation.name}" (${steps.length} step${steps.length === 1 ? '' : 's'})` });
      return;
    }

    case 'remove_macro': {
      const wanted = operation.name.trim().toLowerCase();
      const at = doc.macros.findIndex((m) => m.name.trim().toLowerCase() === wanted);
      if (at === -1) fail({ reason: `no macro is named "${operation.name}"`, candidates: doc.macros.map((m) => m.name) });
      const [macro] = doc.macros.splice(at, 1);
      let cleared = 0;
      for (const layer of doc.layers) {
        for (const [key, binding] of Object.entries(layer.bindings)) {
          if (binding.kind === 'macro' && binding.macroId === macro!.id) {
            delete layer.bindings[key];
            cleared += 1;
          }
        }
      }
      ctx.changes.push({ description: `Removed macro "${macro!.name}"` + (cleared > 0 ? `; ${cleared} key${cleared === 1 ? '' : 's'} bound to it left unassigned` : '') });
      return;
    }

    case 'set_socd': {
      const policy = SOCD_POLICIES.find(
        (p) => p.id === operation.policy.trim().toLowerCase().replace(/[\s-]+/g, '_') || p.label.toLowerCase() === operation.policy.trim().toLowerCase(),
      );
      if (!policy) {
        fail({ reason: `"${operation.policy}" is not a SOCD policy`, candidates: SOCD_POLICIES.map((p) => `${p.id} (${p.label})`) });
      }
      const base = baseLayer(doc);
      const directions = ['up', 'down', 'left', 'right'] as const;
      const positions = {} as Record<(typeof directions)[number], number>;
      const keycodes = {} as Record<(typeof directions)[number], string>;
      for (const direction of directions) {
        const position = needKey(ctx, operation[direction]);
        const binding = base?.bindings[String(position)];
        const keycode = binding?.kind === 'keycode' ? binding.keycode : null;
        if (!keycode || !SOCD_DIRECTIONAL_KEYCODES.has(keycode)) {
          fail(
            `${describePosition(position, ctx.layout)} is bound to ${keycode ?? 'nothing usable'} on the base layer; ` +
              `SOCD ${direction} must be a key bound to one of ${[...SOCD_DIRECTIONAL_KEYCODES].join(', ')}`,
          );
        }
        positions[direction] = position;
        keycodes[direction] = keycode;
      }
      doc.socd = {
        enabled: true,
        policyId: policy.id,
        directionalKeys: positions,
        directionalKeycodes: keycodes,
      };
      ctx.changes.push({
        description: `SOCD enabled (${policy.label}) on ${directions.map((d) => `${d}=${keycodes[d]}`).join(', ')}`,
      });
      return;
    }

    case 'disable_socd': {
      if (!doc.socd) return;
      doc.socd = null;
      ctx.changes.push({ description: 'SOCD disabled' });
      return;
    }

    case 'rename_configuration': {
      if (doc.name === operation.name) return;
      ctx.changes.push({ description: `Renamed configuration "${doc.name}" → "${operation.name}"` });
      doc.name = operation.name;
      return;
    }

    default: {
      const never: never = operation;
      throw new Error(`unhandled operation: ${JSON.stringify(never)}`);
    }
  }
}

export function resolveProposal(options: ResolveOptions): ResolvedProposal {
  const { configuration, catalog, proposal } = options;
  const entry = catalog.keyboards.find((k) => k.keyboardId === configuration.keyboardId);
  if (!entry?.supported) {
    throw new DomainError('CATALOG_KEYBOARD_UNAVAILABLE', 'the configuration’s keyboard is not in the supplied catalog');
  }
  const layout = entry.layouts.find((l) => l.name === configuration.layoutId);
  if (!layout) {
    throw new DomainError('CATALOG_LAYOUT_UNAVAILABLE', 'the configuration’s layout is not a layout of its keyboard');
  }

  const ctx: Ctx = {
    doc: clone(configuration),
    keyboard: entry,
    layout,
    aliases: catalog.keycodeAliases ?? {},
    communityKeymaps: catalog.communityKeymaps ?? {},
    newId: options.newId ?? (() => globalThis.crypto.randomUUID()),
    changes: [],
  };

  const issues: ResolutionIssue[] = [];
  for (const [i, operation] of proposal.operations.entries()) {
    // Each operation applies atomically: work on a copy, commit only on success, so a
    // half-applied operation (e.g. set_socd with three of four keys resolved) never
    // leaks into the candidate.
    const before = clone(ctx.doc);
    const changesBefore = ctx.changes.length;
    try {
      applyOperation(ctx, operation);
    } catch (error) {
      if (!(error instanceof OperationError)) throw error;
      ctx.doc = before;
      ctx.changes.length = changesBefore;
      issues.push({
        operation: i,
        op: operation.op,
        reason: error.message,
        ...(error.candidates ? { candidates: error.candidates } : {}),
      });
    }
  }

  let validation: ResolvedProposal['validation'];
  try {
    validateConfiguration(ctx.doc, { catalog });
    validation = { ok: true };
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    validation = { ok: false, code: error.code, message: error.message, fieldErrors: error.fieldErrors };
  }

  return {
    ok: issues.length === 0 && validation.ok,
    candidate: ctx.doc,
    changes: ctx.changes,
    issues,
    validation,
    summary: proposal.summary,
    unsupported: proposal.unsupported,
  };
}
