'use client';

/**
 * Visual keyboard renderer.
 *
 * claude.md § Visual keymap editor:
 *  - "Render a keyboard only from the selected layout's validated position metadata."
 *  - "Clearly distinguish physical positions from legends/keycodes."
 *  - "Preserve unassigned and unsupported positions visibly; never silently remap."
 * claude.md § End-to-end tests: "accessibility tests for keyboard navigation and
 * non-color-only key state indicators."
 *
 * This is a read-only renderer for Phase 1. It draws physical positions and their
 * matrix coordinates — deliberately NOT keycodes, because nothing is bound yet and
 * showing invented legends would be exactly the fabrication rule 2 forbids.
 */
import { useMemo, useRef, useState } from 'react';
import type { CatalogKeyPosition } from '@qmk-web-app/domain';
import { fitToWidth, type RenderedKey } from '../lib/layout-geometry.ts';

export interface KeyboardLayoutProps {
  positions: CatalogKeyPosition[];
  layoutName: string;
  /** Container width in pixels used for scaling. */
  width?: number;
}

export function KeyboardLayout({ positions, layoutName, width = 1100 }: KeyboardLayoutProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const keyRefs = useRef(new Map<number, SVGGElement>());

  const layout = useMemo(() => fitToWidth(positions, width, { gapPx: 3 }), [positions, width]);

  /**
   * Arrow-key navigation moves to the nearest key in that direction geometrically,
   * which is what a keyboard diagram makes a user expect — tab order alone would
   * follow array order, which on split boards jumps across the gap unpredictably.
   */
  function moveSelection(from: RenderedKey, dx: number, dy: number): void {
    const candidates = layout.keys.filter((k) => {
      if (k.index === from.index) return false;
      const deltaX = k.x - from.x;
      const deltaY = k.y - from.y;
      if (dx !== 0) return Math.sign(deltaX) === dx && Math.abs(deltaY) < layout.keyUnitPx;
      return Math.sign(deltaY) === dy && Math.abs(deltaX) < layout.keyUnitPx;
    });
    if (candidates.length === 0) return;

    const nearest = candidates.reduce((best, k) => {
      const d = Math.hypot(k.x - from.x, k.y - from.y);
      const bestD = Math.hypot(best.x - from.x, best.y - from.y);
      return d < bestD ? k : best;
    });
    setSelected(nearest.index);
    keyRefs.current.get(nearest.index)?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<SVGGElement>, key: RenderedKey): void {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      moveSelection(key, move[0], move[1]);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelected(key.index);
    }
  }

  const selectedKey = layout.keys.find((k) => k.index === selected) ?? null;

  return (
    <div className="layout-wrapper">
      <svg
        className="keyboard"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        role="group"
        aria-label={`${layoutName} — ${positions.length} key positions`}
      >
        {layout.keys.map((key) => {
          const isSelected = key.index === selected;
          return (
            <g
              key={key.index}
              ref={(node) => {
                if (node) keyRefs.current.set(key.index, node);
                else keyRefs.current.delete(key.index);
              }}
              tabIndex={0}
              role="button"
              aria-pressed={isSelected}
              aria-label={`Position ${key.index}, matrix row ${key.matrix[0]} column ${key.matrix[1]}`}
              className={`key${isSelected ? ' key--selected' : ''}`}
              transform={
                key.rotation === 0
                  ? undefined
                  : `rotate(${key.rotation} ${key.rotationOriginX} ${key.rotationOriginY})`
              }
              onClick={() => setSelected(key.index)}
              onKeyDown={(event) => onKeyDown(event, key)}
            >
              <rect x={key.x} y={key.y} width={key.width} height={key.height} rx={4} />
              {/*
                Selection is marked with a thick inset outline as well as a colour
                change, so the state is not communicated by colour alone.
              */}
              {isSelected ? (
                <rect
                  className="key__selection-ring"
                  x={key.x + 3}
                  y={key.y + 3}
                  width={Math.max(key.width - 6, 0)}
                  height={Math.max(key.height - 6, 0)}
                  rx={2}
                  fill="none"
                />
              ) : null}
              <text
                x={key.x + key.width / 2}
                y={key.y + key.height / 2}
                textAnchor="middle"
                dominantBaseline="central"
                className="key__label"
              >
                {/*
                  The physical position index, not a keycode. Nothing is bound yet,
                  and inventing a legend would misrepresent the keyboard.
                */}
                {key.index}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="inspector" aria-live="polite">
        {selectedKey ? (
          <dl>
            <div>
              <dt>Position</dt>
              <dd>{selectedKey.index}</dd>
            </div>
            <div>
              <dt>Matrix</dt>
              <dd>
                row {selectedKey.matrix[0]}, col {selectedKey.matrix[1]}
              </dd>
            </div>
            <div>
              <dt>QMK label</dt>
              {/* Absent is shown as absent, never filled in. */}
              <dd>{selectedKey.label ?? <span className="muted">none reported</span>}</dd>
            </div>
            <div>
              <dt>Binding</dt>
              <dd className="muted">unassigned — the editor arrives in Phase 2</dd>
            </div>
          </dl>
        ) : (
          <p className="muted">
            Select a key to inspect it. Click, or focus a key and use the arrow keys.
          </p>
        )}
      </div>
    </div>
  );
}
