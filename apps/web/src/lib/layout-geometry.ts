/**
 * Turns QMK layout metadata into a render model.
 *
 * claude.md § Visual keymap editor: "Render a keyboard only from the selected
 * layout's validated position metadata."
 *
 * This module is pure: catalog positions in, pixel rectangles out. No React, no DOM,
 * no fetching — so the geometry can be unit-tested exactly, which matters because a
 * mis-placed key is a silent correctness bug the user would have to spot by eye.
 *
 * QMK's coordinate system:
 *  - `x`/`y` are the key's top-left corner in key units (1u = one 1×1 key).
 *  - `y` grows downward.
 *  - `w`/`h` are the key's size in key units, defaulting to 1.
 *  - `r` rotates the key by that many degrees clockwise about (`rx`, `ry`), also in
 *    key units. Used by ~15 keyboards in the pinned tree.
 */
import type { CatalogKeyPosition } from '@qmk-web-app/domain';

/** Pixels per key unit at scale 1. A standard key is 54px, matching common renderers. */
export const DEFAULT_KEY_UNIT_PX = 54;

export interface RenderedKey {
  /** The catalog position index — the `positionId` bindings are keyed by. */
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees clockwise; 0 for almost every key. */
  rotation: number;
  /** Rotation origin in pixels, relative to the same box as `x`/`y`. */
  rotationOriginX: number;
  rotationOriginY: number;
  matrix: readonly [number, number];
  label: string | null;
}

export interface RenderedLayout {
  keys: readonly RenderedKey[];
  /** Bounding box of the whole keyboard, in pixels. */
  width: number;
  height: number;
  keyUnitPx: number;
}

export interface LayoutGeometryOptions {
  keyUnitPx?: number;
  /** Gap between adjacent keys, in pixels. Applied inside each key's cell. */
  gapPx?: number;
}

/** Rotates a point about an origin by `degrees` clockwise, in the same units. */
function rotatePoint(
  x: number,
  y: number,
  originX: number,
  originY: number,
  degrees: number,
): { x: number; y: number } {
  if (degrees === 0) return { x, y };
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = x - originX;
  const dy = y - originY;
  return {
    x: originX + dx * cos - dy * sin,
    y: originY + dx * sin + dy * cos,
  };
}

/**
 * Computes the bounding box in key units, accounting for rotation.
 *
 * A rotated key can extend past its unrotated rectangle, so all four corners are
 * transformed. Without this, rotated boards would be clipped.
 */
function boundingBox(positions: readonly CatalogKeyPosition[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of positions) {
    const corners = [
      [p.x, p.y],
      [p.x + p.w, p.y],
      [p.x, p.y + p.h],
      [p.x + p.w, p.y + p.h],
    ] as const;
    for (const [cx, cy] of corners) {
      const rotated = rotatePoint(cx, cy, p.rx, p.ry, p.r);
      minX = Math.min(minX, rotated.x);
      minY = Math.min(minY, rotated.y);
      maxX = Math.max(maxX, rotated.x);
      maxY = Math.max(maxY, rotated.y);
    }
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return { minX, minY, maxX, maxY };
}

export function renderLayout(
  positions: readonly CatalogKeyPosition[],
  options: LayoutGeometryOptions = {},
): RenderedLayout {
  const keyUnitPx = options.keyUnitPx ?? DEFAULT_KEY_UNIT_PX;
  const gapPx = options.gapPx ?? 2;

  const box = boundingBox(positions);

  // Normalise so the top-left of the bounding box is the origin. Some layouts have
  // negative or non-zero minimums; shifting keeps the SVG viewport tight.
  const keys: RenderedKey[] = positions.map((p) => ({
    index: p.index,
    x: (p.x - box.minX) * keyUnitPx + gapPx / 2,
    y: (p.y - box.minY) * keyUnitPx + gapPx / 2,
    width: p.w * keyUnitPx - gapPx,
    height: p.h * keyUnitPx - gapPx,
    rotation: p.r,
    rotationOriginX: (p.rx - box.minX) * keyUnitPx,
    rotationOriginY: (p.ry - box.minY) * keyUnitPx,
    matrix: p.matrix,
    label: p.label,
  }));

  return {
    keys,
    width: Math.max((box.maxX - box.minX) * keyUnitPx, 0),
    height: Math.max((box.maxY - box.minY) * keyUnitPx, 0),
    keyUnitPx,
  };
}

/**
 * Scales a layout to fit a container width, so a 20u board and a 10u board both fill
 * the available space sensibly. Never scales up past `maxKeyUnitPx`, because giant
 * keys look broken.
 */
export function fitToWidth(
  positions: readonly CatalogKeyPosition[],
  containerWidthPx: number,
  options: LayoutGeometryOptions & { maxKeyUnitPx?: number } = {},
): RenderedLayout {
  const maxKeyUnitPx = options.maxKeyUnitPx ?? DEFAULT_KEY_UNIT_PX;
  const box = boundingBox(positions);
  const widthInUnits = box.maxX - box.minX;

  if (widthInUnits <= 0 || containerWidthPx <= 0) {
    return renderLayout(positions, { ...options, keyUnitPx: maxKeyUnitPx });
  }

  const keyUnitPx = Math.min(containerWidthPx / widthInUnits, maxKeyUnitPx);
  return renderLayout(positions, { ...options, keyUnitPx });
}
