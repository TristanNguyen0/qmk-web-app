/**
 * Typed client for the catalog API.
 *
 * claude.md § Recommended project boundaries — Frontend: "Render metadata and edit
 * configuration", and must not "make QMK validity claims without server validation".
 * So this file contains no keyboard knowledge whatsoever: it only describes the shape
 * of what the server said. Every fact rendered by the UI arrives through here.
 */
import type { CatalogKeyPosition, Layer } from '@qmk-web-app/domain';

const API_BASE = process.env['QWA_API_URL'] ?? 'http://127.0.0.1:3001';

export interface CatalogMeta {
  catalogVersion: string;
  qmkCommit: string;
  keycodeSpecVersion: string;
  generatedAt: string;
  totalKeyboards: number;
  supportedKeyboards: number;
  unsupportedByReason: Record<string, number>;
}

export interface KeyboardSummary {
  keyboardId: string;
  supported: boolean;
  displayName: string;
  manufacturer: string | null;
  processor: string | null;
  bootloader: string | null;
  layoutNames: string[];
  unsupportedReason?: string;
}

export interface KeyboardPage {
  catalogVersion: string;
  items: KeyboardSummary[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface KeyboardLayoutDetail {
  name: string;
  positionCount: number;
  positions: CatalogKeyPosition[];
}

export interface KeyboardDetail {
  keyboardId: string;
  supported: true;
  displayName: string;
  manufacturer: string | null;
  url: string | null;
  processor: string;
  bootloader: string;
  platform: string | null;
  features: Record<string, boolean>;
  layouts: KeyboardLayoutDetail[];
  /** Standard arrangements QMK ships a keymap for and this keyboard supports. */
  communityLayouts: { name: string; layout: string }[];
  provenance: { keyboardFolder: string; qmkCommit: string; parseWarnings: string[] };
}

/** A keyboard the catalog knows about but cannot offer, with the reason why. */
export interface UnsupportedKeyboard {
  keyboardId: string;
  supported: false;
  unsupportedReason: string;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    // Catalog data is immutable per version, but the API is the source of truth for
    // freshness; never serve a stale keyboard from a build-time cache.
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new ApiError(response.status, body?.error?.message ?? `request failed: ${path}`);
  }
  return (await response.json()) as T;
}

export async function fetchCatalogMeta(version = 'latest'): Promise<CatalogMeta> {
  const body = await getJson<{ catalog: CatalogMeta }>(`/v1/catalog/${version}`);
  return body.catalog;
}

export async function fetchKeyboards(options: {
  version?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  includeUnsupported?: boolean;
}): Promise<KeyboardPage> {
  const params = new URLSearchParams();
  if (options.search) params.set('search', options.search);
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  if (options.includeUnsupported) params.set('includeUnsupported', 'true');
  const query = params.toString();
  return getJson<KeyboardPage>(
    `/v1/catalog/${options.version ?? 'latest'}/keyboards${query ? `?${query}` : ''}`,
  );
}

export type KeyboardResult =
  | { kind: 'supported'; keyboard: KeyboardDetail; catalogVersion: string }
  | { kind: 'unsupported'; keyboard: UnsupportedKeyboard }
  | { kind: 'not_found' };

/**
 * Distinguishes "unknown" from "known but unsupported" — the UI must explain the
 * second case rather than showing a dead end (claude.md § Discovery, step 5).
 */
export async function fetchKeyboard(
  keyboardId: string,
  version = 'latest',
): Promise<KeyboardResult> {
  const response = await fetch(`${API_BASE}/v1/catalog/${version}/keyboards/${keyboardId}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });

  if (response.status === 404) return { kind: 'not_found' };

  const body = (await response.json()) as Record<string, unknown>;

  if (response.status === 409) {
    return { kind: 'unsupported', keyboard: body['keyboard'] as UnsupportedKeyboard };
  }
  if (!response.ok) {
    throw new ApiError(response.status, `failed to load ${keyboardId}`);
  }
  return {
    kind: 'supported',
    keyboard: body['keyboard'] as KeyboardDetail,
    catalogVersion: body['catalogVersion'] as string,
  };
}

/**
 * The keyboard's QMK default keymap, interpreted by the server into product bindings
 * for one layout. `unmapped` lists what QMK's default contains that this product cannot
 * represent; those positions are left unassigned so the user sees the gap.
 */
export type DefaultKeymapResult =
  | {
      available: true;
      source: string;
      sourceLayout: string;
      layers: Layer[];
      unmapped: { layerIndex: number; position: number; keycode: string }[];
      droppedLayers: number;
      unmatchedPositions: number;
    }
  | { available: false; reason: string };

export async function fetchDefaultKeymap(
  keyboardId: string,
  layoutId: string,
  version = 'latest',
  preset?: string,
): Promise<DefaultKeymapResult> {
  try {
    const query = new URLSearchParams({ layout: layoutId });
    if (preset) query.set('preset', preset);
    return await getJson<DefaultKeymapResult>(
      `/v1/catalog/${version}/default-keymap/${keyboardId}?${query.toString()}`,
    );
  } catch (error) {
    // A missing default is a reason to start blank, never a reason to fail the page.
    return { available: false, reason: error instanceof ApiError ? error.message : 'unreachable' };
  }
}
