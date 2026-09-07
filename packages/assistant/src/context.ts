/**
 * The facts a model is given before it proposes anything.
 *
 * Everything here is read from the catalog and the current configuration — never
 * from the model's memory of what a keyboard "usually" looks like (claude.md rule 2).
 * The rendering uses the same legends `refs.ts` resolves, so a model that copies a
 * legend or position out of this text gets exactly the key it meant.
 */
import {
  LIMITS,
  SOCD_POLICIES,
  SUPPORTED_KEYCODES,
  communityKeymapFit,
  importDefaultKeymap,
  socdCapabilitiesFor,
  type Binding,
  type Catalog,
  type CatalogLayout,
  type Configuration,
  type SocdCapabilities,
  type SupportedCatalogKeyboard,
  type SupportedKeycode,
} from '@qmk-web-app/domain';
import { rowsOf } from './refs.ts';

export interface ContextKey {
  position: number;
  /** Row/column in the physical grid, 1-based, for prose hints. */
  row: number;
  column: number;
  /** QMK's label for the position, when it has one. */
  label: string | null;
}

export interface AssistantContext {
  catalogVersion: string;
  keyboard: { id: string; displayName: string; layout: string; positions: number };
  rows: ContextKey[][];
  configuration: {
    name: string;
    layers: { index: number; name: string; bound: number }[];
    macros: { name: string; steps: number }[];
    socd: Configuration['socd'];
  };
  /** Per layer, per position: the legend shown in the editor, or null when unassigned. */
  legends: (string | null)[][];
  defaultKeymap: { available: true; source: string; layers: number } | { available: false; reason: string };
  /** Community layouts this keyboard declares: applied exactly, through its own macro. */
  layoutPresets: string[];
  /**
   * Other standard arrangements that can be laid onto this layout by physical key
   * position, with the share of this layout's keys that get a key (rest stay blank).
   */
  fittedPresets: { name: string; fit: number }[];
  socd: SocdCapabilities;
  keycodes: readonly SupportedKeycode[];
  limits: typeof LIMITS;
}

/**
 * A fitted arrangement is offered when at least this share of the layout's keys get a
 * key from it. Below that it is a different board's keymap, not this board's.
 */
export const MIN_FITTED_PRESET_SHARE = 0.5;

export interface BuildContextOptions {
  configuration: Configuration;
  catalog: Catalog;
}

/** The legend a key shows in the editor; also the resolver's first-preference match. */
export function legendOf(binding: Binding | undefined, macros: Configuration['macros']): string | null {
  if (!binding) return null;
  switch (binding.kind) {
    case 'keycode':
      return binding.keycode;
    case 'transparent':
      return '▽';
    case 'no_op':
      return '✕';
    case 'layer_momentary':
      return `MO(${binding.layer})`;
    case 'layer_toggle':
      return `TG(${binding.layer})`;
    case 'layer_tap':
      return `LT(${binding.layer},${binding.tap})`;
    case 'mod_tap':
      return `${binding.hold}/${binding.tap}`;
    case 'macro':
      return `macro:${macros.find((m) => m.id === binding.macroId)?.name ?? '?'}`;
  }
}

function findLayout(keyboard: SupportedCatalogKeyboard, layoutId: string): CatalogLayout {
  const layout = keyboard.layouts.find((l) => l.name === layoutId);
  if (!layout) throw new Error(`layout ${layoutId} is not a layout of ${keyboard.keyboardId}`);
  return layout;
}

export function buildAssistantContext(options: BuildContextOptions): AssistantContext {
  const { configuration, catalog } = options;
  const entry = catalog.keyboards.find((k) => k.keyboardId === configuration.keyboardId);
  if (!entry?.supported) throw new Error(`keyboard ${configuration.keyboardId} is not a supported keyboard in the catalog`);
  const layout = findLayout(entry, configuration.layoutId);

  const rows = rowsOf(layout).map((row, r) =>
    row.map((p, c) => ({ position: p.index, row: r + 1, column: c + 1, label: p.label })),
  );

  const layers = [...configuration.layers].sort((a, b) => a.index - b.index);
  const legends = layers.map((layer) =>
    layout.positions.map((p) => legendOf(layer.bindings[String(p.index)], configuration.macros)),
  );

  const communityKeymaps = catalog.communityKeymaps ?? {};
  const exactPresets = (entry.communityLayouts ?? []).map((c) => c.name).filter((name) => name in communityKeymaps);
  const fittedPresets = Object.values(communityKeymaps)
    .filter((k) => !exactPresets.includes(k.name))
    .map((k) => ({ name: k.name, fit: communityKeymapFit(layout, k) }))
    .filter((f) => f.fit >= MIN_FITTED_PRESET_SHARE)
    .sort((a, b) => b.fit - a.fit || (a.name < b.name ? -1 : 1));

  const imported = importDefaultKeymap({
    keyboard: entry,
    layoutId: configuration.layoutId,
    keycodeAliases: catalog.keycodeAliases ?? {},
    newId: () => '00000000-0000-4000-8000-000000000000',
  });

  return {
    catalogVersion: catalog.catalogVersion,
    keyboard: { id: entry.keyboardId, displayName: entry.displayName, layout: layout.name, positions: layout.positions.length },
    rows,
    configuration: {
      name: configuration.name,
      layers: layers.map((l) => ({ index: l.index, name: l.name, bound: Object.keys(l.bindings).length })),
      macros: configuration.macros.map((m) => ({ name: m.name, steps: m.steps.length })),
      socd: configuration.socd,
    },
    legends,
    defaultKeymap: imported.available
      ? { available: true, source: imported.source, layers: imported.layers.length }
      : { available: false, reason: imported.reason },
    layoutPresets: exactPresets,
    fittedPresets,
    socd: socdCapabilitiesFor(catalog.catalogVersion, entry.keyboardId),
    keycodes: SUPPORTED_KEYCODES,
    limits: LIMITS,
  };
}

/**
 * Plain text for a system prompt. Compact by design: a TKL with four layers is a few
 * thousand tokens. Positions are written `[12:KC_DELETE]` so the model can quote the
 * number back in `{"position": 12}`.
 */
export function renderAssistantContext(ctx: AssistantContext): string {
  const out: string[] = [];
  out.push(`Keyboard: ${ctx.keyboard.displayName} (${ctx.keyboard.id}), layout ${ctx.keyboard.layout}, ${ctx.keyboard.positions} keys.`);
  out.push(`Catalog version: ${ctx.catalogVersion}.`);
  out.push(`Configuration "${ctx.configuration.name}": ${ctx.configuration.layers.length} layer(s), ${ctx.configuration.macros.length} macro(s).`);
  out.push('');

  out.push('Physical keys, by row. Each key is [position:current base-layer legend]; "·" means unassigned.');
  out.push('QMK labels for the position, where QMK provides one, follow after "=" and are only hints.');
  for (const row of ctx.rows) {
    out.push(
      row
        .map((k) => {
          const legend = ctx.legends[0]?.[k.position] ?? null;
          const label = k.label && k.label !== legend ? `=${k.label}` : '';
          return `[${k.position}:${legend ?? '·'}${label}]`;
        })
        .join(' '),
    );
  }
  out.push('');

  for (const layer of ctx.configuration.layers) {
    if (layer.index === 0) {
      out.push(`Layer 0 "${layer.name}" is shown above (${layer.bound} bound).`);
      continue;
    }
    out.push(`Layer ${layer.index} "${layer.name}" (${layer.bound} bound):`);
    for (const row of ctx.rows) {
      out.push(row.map((k) => `[${k.position}:${ctx.legends[layer.index]?.[k.position] ?? '·'}]`).join(' '));
    }
  }
  out.push('');

  if (ctx.configuration.macros.length > 0) {
    out.push('Macros: ' + ctx.configuration.macros.map((m) => `"${m.name}" (${m.steps} steps)`).join(', '));
  }

  out.push(
    ctx.defaultKeymap.available
      ? `QMK default keymap: available (${ctx.defaultKeymap.source}, ${ctx.defaultKeymap.layers} layers) via apply_default_keymap.`
      : `QMK default keymap: NOT available for this keyboard (${ctx.defaultKeymap.reason}); apply_default_keymap will fail.`,
  );

  const presetLegend =
    'Names: 60/65/75/tkl/fullsize = size; ansi/iso/jis = standard; hhkb = HHKB arrangement; wkl = winkeyless; tsangan = Tsangan bottom row; split_bs/rshift = split keys; ortho_RxC = grid; alice; ergodox; numpad.';
  if (ctx.layoutPresets.length > 0 || ctx.fittedPresets.length > 0) {
    out.push('Layout presets (QMK\'s canonical keymap for a standard arrangement, via apply_layout_preset):');
    if (ctx.layoutPresets.length > 0) out.push(`  exact fit for this keyboard: ${ctx.layoutPresets.join(', ')}`);
    if (ctx.fittedPresets.length > 0) {
      out.push(
        `  by physical key position (keys of this board with no twin in the arrangement stay blank; share of keys covered in brackets): ` +
          ctx.fittedPresets.map((f) => `${f.name} [${Math.round(f.fit * 100)}%]`).join(', '),
      );
    }
    out.push(`  ${presetLegend} Use a listed name exactly.`);
  } else {
    out.push('Layout presets: none fit this keyboard. Requests for a named standard layout (HHKB, WKL, ISO, …) are unsupported unless the user spells out each key.');
  }
  if (ctx.socd.available) {
    out.push(
      `SOCD: available on this keyboard. Policies: ${SOCD_POLICIES.map((p) => `${p.id} — ${p.description.replace(/\.$/, '')}`).join(' | ')}. ` +
        `Opposing pairs the module implements: vertical ${ctx.socd.verticalPairs.map((p) => p.join('/')).join(', ')}; horizontal ${ctx.socd.horizontalPairs.map((p) => p.join('/')).join(', ')}. ` +
        'SOCD needs all four directions, applies to the base layer only, and has no runtime on/off key.',
    );
  } else {
    out.push(`SOCD: NOT available on this keyboard (${ctx.socd.reason ?? 'not verified'}). Any SOCD request is unsupported.`);
  }
  out.push(
    ctx.configuration.socd?.enabled
      ? `SOCD currently: ${ctx.configuration.socd.policyId} on positions ${Object.entries(ctx.configuration.socd.directionalKeys).map(([d, p]) => `${d}=${p}`).join(', ')}.`
      : 'SOCD currently: off.',
  );
  out.push('');

  const groups = new Map<string, string[]>();
  for (const k of ctx.keycodes) {
    const list = groups.get(k.group) ?? [];
    list.push(k.label === k.name.replace(/^KC_/, '') ? k.name : `${k.name} (${k.label})`);
    groups.set(k.group, list);
  }
  out.push('Supported keycodes (nothing else can be bound):');
  for (const [group, names] of groups) out.push(`  ${group}: ${names.join(', ')}`);
  out.push('');
  out.push(
    `Limits: ${ctx.limits.maxLayers} layers, ${ctx.limits.maxMacros} macros, ${ctx.limits.maxMacroSteps} steps per macro, ` +
      `${ctx.limits.maxMacroStepDelayMs} ms per delay, ${ctx.limits.maxMacroTotalDelayMs} ms total delay per macro.`,
  );
  return out.join('\n');
}
