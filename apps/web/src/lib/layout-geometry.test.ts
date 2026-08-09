import { describe, expect, it } from 'vitest';
import type { CatalogKeyPosition } from '@qmk-web-app/domain';
import { DEFAULT_KEY_UNIT_PX, fitToWidth, renderLayout } from './layout-geometry.ts';

function key(overrides: Partial<CatalogKeyPosition> & { index: number }): CatalogKeyPosition {
  return {
    matrix: [0, 0],
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    r: 0,
    rx: 0,
    ry: 0,
    label: null,
    ...overrides,
  };
}

describe('renderLayout', () => {
  it('places a simple row left to right with no gaps between cells', () => {
    const layout = renderLayout(
      [key({ index: 0, x: 0 }), key({ index: 1, x: 1 }), key({ index: 2, x: 2 })],
      { keyUnitPx: 100, gapPx: 0 },
    );
    expect(layout.keys.map((k) => k.x)).toEqual([0, 100, 200]);
    expect(layout.keys.every((k) => k.y === 0)).toBe(true);
    expect(layout.width).toBe(300);
    expect(layout.height).toBe(100);
  });

  it('grows y downward, matching QMK', () => {
    const layout = renderLayout([key({ index: 0, y: 0 }), key({ index: 1, y: 2 })], {
      keyUnitPx: 100,
      gapPx: 0,
    });
    expect(layout.keys[0]?.y).toBe(0);
    expect(layout.keys[1]?.y).toBe(200);
  });

  it('honours wide and tall keys', () => {
    const layout = renderLayout(
      [key({ index: 0, w: 2.25 }), key({ index: 1, x: 2.25, h: 2 })],
      { keyUnitPx: 100, gapPx: 0 },
    );
    expect(layout.keys[0]?.width).toBe(225);
    expect(layout.keys[1]?.height).toBe(200);
  });

  it('applies the gap inside each cell without moving the grid', () => {
    const layout = renderLayout([key({ index: 0 }), key({ index: 1, x: 1 })], {
      keyUnitPx: 100,
      gapPx: 10,
    });
    expect(layout.keys[0]).toMatchObject({ x: 5, y: 5, width: 90, height: 90 });
    expect(layout.keys[1]?.x).toBe(105);
  });

  it('normalises a layout whose origin is not zero', () => {
    // Split keyboards routinely start at a non-zero y.
    const layout = renderLayout([key({ index: 0, x: 3, y: 2 }), key({ index: 1, x: 4, y: 2 })], {
      keyUnitPx: 100,
      gapPx: 0,
    });
    expect(layout.keys[0]).toMatchObject({ x: 0, y: 0 });
    expect(layout.keys[1]?.x).toBe(100);
    expect(layout.width).toBe(200);
  });

  it('preserves the catalog position index so bindings map correctly', () => {
    const layout = renderLayout([key({ index: 7 }), key({ index: 3, x: 1 })]);
    expect(layout.keys.map((k) => k.index)).toEqual([7, 3]);
  });

  it('carries matrix and label through untouched', () => {
    const layout = renderLayout([key({ index: 0, matrix: [2, 5], label: 'Esc' })]);
    expect(layout.keys[0]?.matrix).toEqual([2, 5]);
    expect(layout.keys[0]?.label).toBe('Esc');
  });

  it('handles an empty layout without producing NaN', () => {
    const layout = renderLayout([]);
    expect(layout.keys).toEqual([]);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });
});

describe('rotation', () => {
  it('leaves unrotated keys exactly where they were', () => {
    const layout = renderLayout([key({ index: 0, x: 1, y: 1 })], { keyUnitPx: 100, gapPx: 0 });
    expect(layout.keys[0]).toMatchObject({ x: 0, y: 0, rotation: 0 });
  });

  it('expands the bounding box so a rotated key is not clipped', () => {
    // A 1u key at the origin rotated 45° about its top-left corner sweeps below and
    // to the right of its unrotated box.
    const rotated = renderLayout([key({ index: 0, r: 45 })], { keyUnitPx: 100, gapPx: 0 });
    const unrotated = renderLayout([key({ index: 0 })], { keyUnitPx: 100, gapPx: 0 });
    expect(rotated.height).toBeGreaterThan(unrotated.height);
    // Half-diagonal below the origin: sin(45°) * sqrt(2) = 1.0 key units of height
    // above plus the rotated extent below.
    expect(rotated.height).toBeCloseTo(Math.SQRT2 * 100, 5);
  });

  it('reports the rotation origin in the same normalised pixel space as the key', () => {
    const layout = renderLayout([key({ index: 0, x: 2, y: 2, r: 30, rx: 2, ry: 2 })], {
      keyUnitPx: 100,
      gapPx: 0,
    });
    const k = layout.keys[0]!;
    expect(k.rotation).toBe(30);
    // The key's own top-left sits at the rotation origin here, so after
    // normalisation both must land on the same point.
    expect(k.rotationOriginX).toBeCloseTo(k.x, 5);
    expect(k.rotationOriginY).toBeCloseTo(k.y, 5);
  });
});

describe('fitToWidth', () => {
  it('scales a wide board down to the container', () => {
    const keys = Array.from({ length: 20 }, (_, i) => key({ index: i, x: i }));
    const layout = fitToWidth(keys, 600, { gapPx: 0 });
    expect(layout.keyUnitPx).toBeCloseTo(30, 5);
    expect(layout.width).toBeCloseTo(600, 5);
  });

  it('does not scale a small board up beyond the maximum key size', () => {
    const layout = fitToWidth([key({ index: 0 })], 2000, { gapPx: 0 });
    expect(layout.keyUnitPx).toBe(DEFAULT_KEY_UNIT_PX);
  });

  it('degrades gracefully for a zero-width container', () => {
    const layout = fitToWidth([key({ index: 0 })], 0, { gapPx: 0 });
    expect(layout.keyUnitPx).toBe(DEFAULT_KEY_UNIT_PX);
    expect(Number.isFinite(layout.width)).toBe(true);
  });
});
