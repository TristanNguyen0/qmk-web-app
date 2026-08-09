'use client';

/**
 * Structured macro editor.
 *
 * claude.md § Visual keymap editor: "Model macros as structured steps, not
 * user-entered C. Enforce product limits such as maximum macros, steps, delay."
 *
 * Every step is a typed choice from a fixed set. There is no free-text field that
 * reaches generated output — the name is the only free text, and it is used for
 * display only, never emitted into source.
 */
import { useState } from 'react';
import { LIMITS, type Macro, type MacroStep } from '@qmk-web-app/domain';
import type { SupportedKeycode } from '../lib/client.ts';

export interface MacroEditorProps {
  macros: Macro[];
  keycodes: SupportedKeycode[];
  onAdd: (macro: Macro) => void;
  onUpdate: (macro: Macro) => void;
  onRemove: (macroId: string) => void;
}

export function MacroEditor({ macros, keycodes, onAdd, onUpdate, onRemove }: MacroEditorProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  function addMacro() {
    onAdd({
      id: crypto.randomUUID(),
      name: `Macro ${macros.length + 1}`,
      // A macro must have at least one step to be valid, so start with a real one.
      steps: [{ kind: 'tap', keycode: 'KC_A' }],
    });
  }

  function addStep(macro: Macro, step: MacroStep) {
    if (macro.steps.length >= LIMITS.maxMacroSteps) return;
    onUpdate({ ...macro, steps: [...macro.steps, step] });
  }

  function removeStep(macro: Macro, index: number) {
    // The schema requires at least one step; removing the last would be invalid.
    if (macro.steps.length <= 1) return;
    onUpdate({ ...macro, steps: macro.steps.filter((_, i) => i !== index) });
  }

  return (
    <section className="macros">
      <h2>Macros</h2>
      <p className="muted">
        {macros.length} of {LIMITS.maxMacros} used. Each macro allows up to{' '}
        {LIMITS.maxMacroSteps} steps and {LIMITS.maxMacroTotalDelayMs}ms of total delay.
      </p>

      {macros.length === 0 ? (
        <p className="muted">No macros yet.</p>
      ) : (
        <ul className="macro-list">
          {macros.map((macro) => {
            const totalDelay = macro.steps.reduce(
              (sum, s) => sum + (s.kind === 'delay' ? s.durationMs : 0),
              0,
            );
            const held = heldKeys(macro.steps);
            const isOpen = expanded === macro.id;

            return (
              <li key={macro.id} className="macro">
                <div className="macro__header">
                  <input
                    aria-label={`Macro name for ${macro.name}`}
                    value={macro.name}
                    onChange={(e) => onUpdate({ ...macro, name: e.target.value })}
                  />
                  <span className="muted">
                    {macro.steps.length} step{macro.steps.length === 1 ? '' : 's'}
                  </span>
                  <button type="button" onClick={() => setExpanded(isOpen ? null : macro.id)}>
                    {isOpen ? 'Collapse' : 'Edit steps'}
                  </button>
                  <button type="button" onClick={() => onRemove(macro.id)}>
                    Delete
                  </button>
                </div>

                {/*
                  Warn before the server rejects it. A key pressed and never released
                  leaves the keyboard stuck, which is a nasty thing to discover on
                  hardware.
                */}
                {held.length > 0 ? (
                  <p className="notice">
                    {held.join(', ')} {held.length === 1 ? 'is' : 'are'} pressed but never
                    released. This macro will be rejected on save.
                  </p>
                ) : null}
                {totalDelay > LIMITS.maxMacroTotalDelayMs ? (
                  <p className="notice">
                    Total delay {totalDelay}ms exceeds the {LIMITS.maxMacroTotalDelayMs}ms limit.
                  </p>
                ) : null}

                {isOpen ? (
                  <div className="macro__steps">
                    <ol>
                      {macro.steps.map((step, index) => (
                        <li key={`${macro.id}-${index}`}>
                          <code>{describeStep(step)}</code>
                          <button
                            type="button"
                            disabled={macro.steps.length <= 1}
                            onClick={() => removeStep(macro, index)}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ol>
                    <StepAdder
                      keycodes={keycodes}
                      disabled={macro.steps.length >= LIMITS.maxMacroSteps}
                      onAdd={(step) => addStep(macro, step)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" onClick={addMacro} disabled={macros.length >= LIMITS.maxMacros}>
        Add macro
      </button>
    </section>
  );
}

/** Keys pressed with `key_down` and never released. Mirrors the server-side check. */
function heldKeys(steps: readonly MacroStep[]): string[] {
  const held = new Set<string>();
  for (const step of steps) {
    if (step.kind === 'key_down') held.add(step.keycode);
    if (step.kind === 'key_up') held.delete(step.keycode);
  }
  return [...held].map((k) => k.replace('KC_', ''));
}

function describeStep(step: MacroStep): string {
  switch (step.kind) {
    case 'tap':
      return `tap ${step.keycode.replace('KC_', '')}`;
    case 'key_down':
      return `hold ${step.keycode.replace('KC_', '')}`;
    case 'key_up':
      return `release ${step.keycode.replace('KC_', '')}`;
    case 'delay':
      return `wait ${step.durationMs}ms`;
    default: {
      const never: never = step;
      throw new Error(`unhandled step ${JSON.stringify(never)}`);
    }
  }
}

function StepAdder({
  keycodes,
  disabled,
  onAdd,
}: {
  keycodes: SupportedKeycode[];
  disabled: boolean;
  onAdd: (step: MacroStep) => void;
}) {
  const [kind, setKind] = useState<MacroStep['kind']>('tap');
  const [keycode, setKeycode] = useState('KC_A');
  const [durationMs, setDurationMs] = useState(50);

  return (
    <div className="macro__adder">
      <label className="visually-hidden" htmlFor="step-kind">
        Step type
      </label>
      <select
        id="step-kind"
        value={kind}
        onChange={(e) => setKind(e.target.value as MacroStep['kind'])}
      >
        <option value="tap">Tap</option>
        <option value="key_down">Hold</option>
        <option value="key_up">Release</option>
        <option value="delay">Delay</option>
      </select>

      {kind === 'delay' ? (
        <>
          <label className="visually-hidden" htmlFor="step-delay">
            Delay in milliseconds
          </label>
          <input
            id="step-delay"
            type="number"
            min={1}
            max={LIMITS.maxMacroStepDelayMs}
            value={durationMs}
            onChange={(e) => setDurationMs(Number(e.target.value))}
          />
        </>
      ) : (
        <>
          <label className="visually-hidden" htmlFor="step-keycode">
            Keycode
          </label>
          <select id="step-keycode" value={keycode} onChange={(e) => setKeycode(e.target.value)}>
            {keycodes.map((k) => (
              <option key={k.name} value={k.name}>
                {k.label}
              </option>
            ))}
          </select>
        </>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onAdd(
            kind === 'delay'
              ? { kind: 'delay', durationMs: Math.min(Math.max(durationMs, 1), LIMITS.maxMacroStepDelayMs) }
              : ({ kind, keycode } as MacroStep),
          )
        }
      >
        Add step
      </button>
    </div>
  );
}
