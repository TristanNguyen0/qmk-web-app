'use client';

/**
 * The SOCD configuration panel.
 *
 * claude.md rule 10: "Clearly label SOCD behavior, supported directional-key groups,
 * and game/tournament compliance as user responsibility; do not make compliance
 * claims." And § SOCD Cleaner requirement 5: the conflict policy must be documented in
 * the UI, not just implemented.
 *
 * Everything this panel offers comes from the server's capability response — the
 * policies, the pairs, and whether SOCD is available at all. The frontend carries no
 * opinion about which keyboards support it (claude.md § Recommended project
 * boundaries: the frontend must not "make QMK validity claims without server
 * validation").
 */
import { useId, useState } from 'react';
import type { SocdConfiguration } from '@qmk-web-app/domain';
import type { SocdCapabilitiesResponse } from '../lib/client.ts';

export interface SocdPanelProps {
  capabilities: SocdCapabilitiesResponse | null;
  socd: SocdConfiguration | null;
  /** Positions that exist in the selected layout, for the position pickers. */
  positions: readonly number[];
  onChange: (socd: SocdConfiguration | null) => void;
}

type Direction = 'up' | 'down' | 'left' | 'right';

const DIRECTION_LABELS: Record<Direction, string> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
};

export function SocdPanel({ capabilities, socd, positions, onChange }: SocdPanelProps) {
  const headingId = useId();

  if (!capabilities) {
    return (
      <section aria-labelledby={headingId} className="socd">
        <h2 id={headingId}>SOCD</h2>
        <p className="muted">Could not load SOCD capabilities for this keyboard.</p>
      </section>
    );
  }

  if (!capabilities.available) {
    // Unsupported state is explained, never hidden (claude.md § Phase 1: "unsupported-
    // state UX").
    return (
      <section aria-labelledby={headingId} className="socd">
        <h2 id={headingId}>SOCD</h2>
        <p className="notice">
          <strong>SOCD is not available for this keyboard.</strong>{' '}
          {capabilities.reason ?? 'No reason was given.'}
        </p>
      </section>
    );
  }

  return (
    <SocdEditor
      headingId={headingId}
      capabilities={capabilities}
      socd={socd}
      positions={positions}
      onChange={onChange}
    />
  );
}

function SocdEditor({
  headingId,
  capabilities,
  socd,
  positions,
  onChange,
}: SocdPanelProps & { headingId: string; capabilities: SocdCapabilitiesResponse }) {
  const [verticalPair, setVerticalPair] = useState(0);
  const [horizontalPair, setHorizontalPair] = useState(0);

  const enabled = socd?.enabled ?? false;
  const vertical = capabilities.verticalPairs[verticalPair] ?? capabilities.verticalPairs[0]!;
  const horizontal =
    capabilities.horizontalPairs[horizontalPair] ?? capabilities.horizontalPairs[0]!;

  function emit(next: Partial<SocdConfiguration>) {
    const base: SocdConfiguration =
      socd ??
      ({
        enabled: false,
        policyId: capabilities.policies[0]!.id,
        directionalKeys: {
          up: positions[0] ?? 0,
          down: positions[1] ?? 0,
          left: positions[2] ?? 0,
          right: positions[3] ?? 0,
        },
        directionalKeycodes: {
          up: vertical[0],
          down: vertical[1],
          left: horizontal[0],
          right: horizontal[1],
        },
      } as SocdConfiguration);
    onChange({ ...base, ...next } as SocdConfiguration);
  }

  function setPair(axis: 'vertical' | 'horizontal', index: number) {
    if (axis === 'vertical') {
      setVerticalPair(index);
      const pair = capabilities.verticalPairs[index]!;
      emit({
        directionalKeycodes: {
          ...(socd?.directionalKeycodes ?? {
            up: vertical[0],
            down: vertical[1],
            left: horizontal[0],
            right: horizontal[1],
          }),
          up: pair[0],
          down: pair[1],
        },
      } as Partial<SocdConfiguration>);
    } else {
      setHorizontalPair(index);
      const pair = capabilities.horizontalPairs[index]!;
      emit({
        directionalKeycodes: {
          ...(socd?.directionalKeycodes ?? {
            up: vertical[0],
            down: vertical[1],
            left: horizontal[0],
            right: horizontal[1],
          }),
          left: pair[0],
          right: pair[1],
        },
      } as Partial<SocdConfiguration>);
    }
  }

  function setPosition(direction: Direction, position: number) {
    emit({
      directionalKeys: {
        ...(socd?.directionalKeys ?? { up: 0, down: 0, left: 0, right: 0 }),
        [direction]: position,
      },
    } as Partial<SocdConfiguration>);
  }

  const activePolicy = capabilities.policies.find((p) => p.id === socd?.policyId);

  return (
    <section aria-labelledby={headingId} className="socd">
      <h2 id={headingId}>SOCD</h2>
      <p className="muted">
        SOCD (simultaneous opposing cardinal directions) decides what your keyboard sends when you
        hold two opposite directions at once.
      </p>

      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => (e.target.checked ? emit({ enabled: true }) : onChange(null))}
        />{' '}
        Enable SOCD resolution
      </label>

      {enabled ? (
        <>
          <fieldset>
            <legend>Resolution policy</legend>
            {capabilities.policies.map((policy) => (
              <label key={policy.id} className="socd__policy">
                <input
                  type="radio"
                  name="socd-policy"
                  value={policy.id}
                  checked={socd?.policyId === policy.id}
                  onChange={() => emit({ policyId: policy.id } as Partial<SocdConfiguration>)}
                />{' '}
                <strong>{policy.label}</strong>
                <span className="muted"> — {policy.description}</span>
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Which keys oppose each other</legend>
            <label>
              Vertical{' '}
              <select
                value={verticalPair}
                onChange={(e) => setPair('vertical', Number(e.target.value))}
              >
                {capabilities.verticalPairs.map((pair, i) => (
                  <option key={pair.join()} value={i}>
                    {pair[0]} / {pair[1]}
                  </option>
                ))}
              </select>
            </label>{' '}
            <label>
              Horizontal{' '}
              <select
                value={horizontalPair}
                onChange={(e) => setPair('horizontal', Number(e.target.value))}
              >
                {capabilities.horizontalPairs.map((pair, i) => (
                  <option key={pair.join()} value={i}>
                    {pair[0]} / {pair[1]}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <fieldset>
            <legend>Which physical keys</legend>
            <p className="muted">
              Choosing a position binds it to that keycode on the base layer, because that is the
              key SOCD resolves.
            </p>
            {(Object.keys(DIRECTION_LABELS) as Direction[]).map((direction) => (
              <label key={direction} className="socd__position">
                {DIRECTION_LABELS[direction]}{' '}
                <span className="muted">
                  ({socd?.directionalKeycodes[direction] ?? '—'})
                </span>{' '}
                <select
                  value={socd?.directionalKeys[direction] ?? ''}
                  onChange={(e) => setPosition(direction, Number(e.target.value))}
                >
                  {positions.map((position) => (
                    <option key={position} value={position}>
                      Position {position}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>

          <div className="notice">
            <strong>What this does</strong>
            <p>
              {activePolicy
                ? activePolicy.description
                : 'Choose a policy to see how conflicts resolve.'}{' '}
              Resolution applies to these four keys on the <strong>base layer only</strong>; on
              other layers those positions behave normally. SOCD runs before macros, so a macro’s
              own keypresses are never altered.
            </p>
            {/* claude.md rule 10 — stated plainly, and not as fine print. */}
            <p>
              <strong>Your responsibility:</strong> {capabilities.compliance}
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}
