'use client';

/**
 * Binding picker for the selected position.
 *
 * claude.md § Visual keymap editor: "a searchable allowlisted keycode picker". The
 * keycode list arrives from the server (`/v1/catalog/…/keycodes`) — the client never
 * defines its own — and every other binding kind is chosen from a fixed set that
 * matches the domain's discriminated union exactly.
 */
import { useMemo, useState } from 'react';
import type { Binding, Macro } from '@qmk-web-app/domain';
import type { SupportedKeycode } from '../lib/client.ts';

export interface BindingPickerProps {
  keycodes: SupportedKeycode[];
  layerCount: number;
  macros: Macro[];
  current: Binding | undefined;
  onChange: (binding: Binding) => void;
  onClear: () => void;
}

type Tab = 'keycode' | 'layer' | 'modtap' | 'macro' | 'special';

const MOD_TAP_MODS = [
  'KC_LEFT_CTRL',
  'KC_LEFT_SHIFT',
  'KC_LEFT_ALT',
  'KC_LEFT_GUI',
  'KC_RIGHT_CTRL',
  'KC_RIGHT_SHIFT',
  'KC_RIGHT_ALT',
  'KC_RIGHT_GUI',
];

export function BindingPicker({
  keycodes,
  layerCount,
  macros,
  current,
  onChange,
  onClear,
}: BindingPickerProps) {
  const [tab, setTab] = useState<Tab>('keycode');
  const [search, setSearch] = useState('');
  const [layerTarget, setLayerTarget] = useState(1);
  const [tapKeycode, setTapKeycode] = useState('KC_SPACE');
  const [holdMod, setHoldMod] = useState('KC_LEFT_CTRL');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return keycodes;
    return keycodes.filter(
      (k) => k.name.toLowerCase().includes(q) || k.label.toLowerCase().includes(q),
    );
  }, [keycodes, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, SupportedKeycode[]>();
    for (const keycode of filtered) {
      const list = groups.get(keycode.group) ?? [];
      list.push(keycode);
      groups.set(keycode.group, list);
    }
    return [...groups.entries()];
  }, [filtered]);

  // Layer actions are meaningless with only one layer, so the tab explains itself
  // rather than offering a control that cannot produce a valid binding.
  const otherLayers = Array.from({ length: layerCount }, (_, i) => i).filter((i) => i !== 0);

  return (
    <div className="picker">
      <div className="picker__tabs" role="tablist" aria-label="Binding type">
        {(
          [
            ['keycode', 'Key'],
            ['layer', 'Layer'],
            ['modtap', 'Mod-tap'],
            ['macro', 'Macro'],
            ['special', 'Special'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`picker__tab${tab === id ? ' picker__tab--active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'keycode' ? (
        <div className="picker__body">
          <label className="visually-hidden" htmlFor="keycode-search">
            Search keycodes
          </label>
          <input
            id="keycode-search"
            type="search"
            placeholder="Search keys…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="picker__search"
          />
          {grouped.length === 0 ? (
            <p className="muted">
              No supported keycode matches “{search}”. Only keycodes verified against the pinned
              QMK revision are offered.
            </p>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group} className="picker__group">
                <h4>{group}</h4>
                <div className="picker__keys">
                  {items.map((keycode) => (
                    <button
                      key={keycode.name}
                      type="button"
                      title={keycode.name}
                      aria-pressed={
                        current?.kind === 'keycode' && current.keycode === keycode.name
                      }
                      className="picker__key"
                      onClick={() => onChange({ kind: 'keycode', keycode: keycode.name })}
                    >
                      {keycode.label}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === 'layer' ? (
        <div className="picker__body">
          {otherLayers.length === 0 ? (
            <p className="muted">Add a second layer before assigning layer actions.</p>
          ) : (
            <>
              <label htmlFor="layer-target">Target layer</label>
              <select
                id="layer-target"
                value={layerTarget}
                onChange={(e) => setLayerTarget(Number(e.target.value))}
              >
                {otherLayers.map((i) => (
                  <option key={i} value={i}>
                    Layer {i}
                  </option>
                ))}
              </select>

              <div className="picker__row">
                <button
                  type="button"
                  onClick={() => onChange({ kind: 'layer_momentary', layer: layerTarget })}
                >
                  Momentary (MO)
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ kind: 'layer_toggle', layer: layerTarget })}
                >
                  Toggle (TG)
                </button>
              </div>

              <label htmlFor="layer-tap-key">Layer-tap: hold for layer, tap for</label>
              <select
                id="layer-tap-key"
                value={tapKeycode}
                onChange={(e) => setTapKeycode(e.target.value)}
              >
                {keycodes.map((k) => (
                  <option key={k.name} value={k.name}>
                    {k.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  onChange({ kind: 'layer_tap', layer: layerTarget, tap: tapKeycode })
                }
              >
                Assign layer-tap
              </button>
            </>
          )}
        </div>
      ) : null}

      {tab === 'modtap' ? (
        <div className="picker__body">
          <label htmlFor="modtap-hold">Hold for</label>
          <select id="modtap-hold" value={holdMod} onChange={(e) => setHoldMod(e.target.value)}>
            {MOD_TAP_MODS.map((mod) => (
              <option key={mod} value={mod}>
                {mod.replace('KC_', '')}
              </option>
            ))}
          </select>

          <label htmlFor="modtap-tap">Tap for</label>
          <select id="modtap-tap" value={tapKeycode} onChange={(e) => setTapKeycode(e.target.value)}>
            {keycodes.map((k) => (
              <option key={k.name} value={k.name}>
                {k.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => onChange({ kind: 'mod_tap', hold: holdMod, tap: tapKeycode })}
          >
            Assign mod-tap
          </button>
        </div>
      ) : null}

      {tab === 'macro' ? (
        <div className="picker__body">
          {macros.length === 0 ? (
            <p className="muted">No macros defined yet. Add one in the Macros panel below.</p>
          ) : (
            <div className="picker__row">
              {macros.map((macro) => (
                <button
                  key={macro.id}
                  type="button"
                  aria-pressed={current?.kind === 'macro' && current.macroId === macro.id}
                  onClick={() => onChange({ kind: 'macro', macroId: macro.id })}
                >
                  {macro.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === 'special' ? (
        <div className="picker__body">
          <div className="picker__row">
            <button type="button" onClick={() => onChange({ kind: 'transparent' })}>
              Transparent (▽)
            </button>
            <button type="button" onClick={() => onChange({ kind: 'no_op' })}>
              No-op (✕)
            </button>
          </div>
          <p className="muted">
            <strong>Transparent</strong> falls through to the layer below.{' '}
            <strong>No-op</strong> does nothing at all. Both differ from leaving a key
            unassigned, which stays visibly blank.
          </p>
        </div>
      ) : null}

      <button type="button" className="picker__clear" onClick={onClear}>
        Clear this key
      </button>
    </div>
  );
}
