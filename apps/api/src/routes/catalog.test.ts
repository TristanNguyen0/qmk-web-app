import { describe, expect, it, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readCatalogSample } from '@qmk-web-app/qmk-fixtures';
import type { Catalog } from '@qmk-web-app/domain';
import { buildApp } from '../app.ts';
import { CatalogStore } from '../catalog-store.ts';
import { InMemoryConfigurationRepository } from '../configurations/memory-repository.ts';

const base = readCatalogSample() as Catalog;

/** The fixture is all-supported, so add a synthetic unsupported entry to exercise it. */
const catalog: Catalog = {
  ...base,
  keyboards: [
    ...base.keyboards,
    {
      supported: false,
      keyboardId: 'broken/kb',
      reason: 'qmk_parse_errors',
      detail: 'internal detail that must not be exposed',
    },
  ],
};

let app: FastifyInstance;

beforeAll(() => {
  const store = new CatalogStore();
  store.add(catalog);
  app = buildApp({
    store,
    repository: new InMemoryConfigurationRepository(),
    sessionSecret: 'test-secret-that-is-long-enough-to-pass-0123',
  });
});

async function get(url: string) {
  const res = await app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json() as Record<string, unknown>, raw: res };
}

describe('catalog index', () => {
  it('reports the active version and every loaded version', async () => {
    const { status, body } = await get('/v1/catalog');
    expect(status).toBe(200);
    expect(body['activeVersion']).toBe(catalog.catalogVersion);
    expect(body['versions']).toEqual([catalog.catalogVersion]);
  });

  it('versions every payload', async () => {
    for (const url of ['/v1/catalog', '/v1/catalog/latest', '/v1/catalog/latest/keyboards']) {
      const { body } = await get(url);
      expect(body['apiVersion'], url).toBe(1);
    }
  });

  it('resolves `latest` to a concrete version so clients can pin to it', async () => {
    const { body } = await get('/v1/catalog/latest/keyboards');
    expect(body['catalogVersion']).toBe(catalog.catalogVersion);
    expect(body['catalogVersion']).not.toBe('latest');
  });

  it('404s an unknown catalog version', async () => {
    const { status, body } = await get('/v1/catalog/9.9.9-1/keyboards');
    expect(status).toBe(404);
    expect((body['error'] as Record<string, unknown>)['code']).toBe('NOT_FOUND');
  });
});

describe('listing keyboards', () => {
  it('returns only supported keyboards by default', async () => {
    const { body } = await get('/v1/catalog/latest/keyboards');
    const items = body['items'] as { keyboardId: string; supported: boolean }[];
    expect(items.every((i) => i.supported)).toBe(true);
    expect(items.map((i) => i.keyboardId)).not.toContain('broken/kb');
  });

  it('includes unsupported keyboards with a reason when asked', async () => {
    const { body } = await get('/v1/catalog/latest/keyboards?includeUnsupported=true');
    const items = body['items'] as { keyboardId: string; unsupportedReason?: string }[];
    const broken = items.find((i) => i.keyboardId === 'broken/kb');
    expect(broken?.unsupportedReason).toBe('qmk_parse_errors');
  });

  it('does not leak operator-facing detail for unsupported keyboards', async () => {
    const { raw } = await get('/v1/catalog/latest/keyboards?includeUnsupported=true');
    expect(raw.body).not.toContain('internal detail');
  });

  it('filters by search across id and display name', async () => {
    const { body } = await get('/v1/catalog/latest/keyboards?search=crkbd');
    const items = body['items'] as { keyboardId: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]?.keyboardId).toBe('crkbd/rev1');
  });

  it('paginates', async () => {
    const { body } = await get('/v1/catalog/latest/keyboards?pageSize=1&page=2');
    expect(body['pageSize']).toBe(1);
    expect(body['page']).toBe(2);
    expect((body['items'] as unknown[]).length).toBe(1);
    expect(body['totalItems']).toBe(2);
    expect(body['totalPages']).toBe(2);
  });

  it('rejects malformed and oversized pagination', async () => {
    for (const q of ['page=0', 'page=abc', 'pageSize=-1', 'pageSize=100000']) {
      const { status } = await get(`/v1/catalog/latest/keyboards?${q}`);
      expect(status, q).toBe(400);
    }
  });

  it('omits layout geometry from list responses', async () => {
    const { body } = await get('/v1/catalog/latest/keyboards');
    const first = (body['items'] as Record<string, unknown>[])[0]!;
    expect(first).not.toHaveProperty('layouts');
    expect(first['layoutNames']).toBeInstanceOf(Array);
  });
});

describe('keyboard detail', () => {
  it('returns everything needed to render, including real geometry', async () => {
    const { status, body } = await get('/v1/catalog/latest/keyboards/crkbd/rev1');
    expect(status).toBe(200);
    const kb = body['keyboard'] as Record<string, unknown>;
    expect(kb['keyboardId']).toBe('crkbd/rev1');
    expect(kb['processor']).toBe('atmega32u4');

    const layouts = kb['layouts'] as { name: string; positions: unknown[] }[];
    const split = layouts.find((l) => l.name === 'LAYOUT_split_3x6_3')!;
    expect(split.positions).toHaveLength(42);
    expect(split.positions[0]).toMatchObject({ index: 0, x: expect.any(Number) });
  });

  it('carries provenance so a client can show which QMK revision it sees', async () => {
    const { body } = await get('/v1/catalog/latest/keyboards/crkbd/rev1');
    const provenance = (body['keyboard'] as Record<string, unknown>)['provenance'] as Record<string, unknown>;
    expect(provenance['qmkCommit']).toBe(catalog.qmkCommit);
  });

  it('returns 409 with the reason for an unsupported keyboard', async () => {
    const { status, body } = await get('/v1/catalog/latest/keyboards/broken/kb');
    expect(status).toBe(409);
    expect((body['error'] as Record<string, unknown>)['code']).toBe('CATALOG_KEYBOARD_UNAVAILABLE');
    expect((body['keyboard'] as Record<string, unknown>)['unsupportedReason']).toBe('qmk_parse_errors');
  });

  it('404s an unknown keyboard', async () => {
    const { status } = await get('/v1/catalog/latest/keyboards/nope/nothing');
    expect(status).toBe(404);
  });

  it('rejects traversal and malformed ids without touching the filesystem', async () => {
    for (const id of ['..', 'planck/../../etc', 'PLANCK/rev6', 'planck rev6']) {
      const { status } = await get(`/v1/catalog/latest/keyboards/${encodeURI(id)}`);
      expect([400, 404], id).toContain(status);
    }
  });
});

describe('keycodes', () => {
  it('serves the product allowlist, not the whole QMK set', async () => {
    const { status, body } = await get('/v1/catalog/latest/keycodes');
    expect(status).toBe(200);
    const keycodes = body['keycodes'] as { name: string }[];
    const names = new Set(keycodes.map((k) => k.name));
    expect(names.has('KC_A')).toBe(true);
    // A destructive/advanced keycode that is deliberately not offered yet.
    expect(names.has('QK_BOOTLOADER')).toBe(false);
    expect(keycodes.length).toBeLessThan(200);
  });

  it('reports the pinned keycode spec version', async () => {
    const { body } = await get('/v1/catalog/latest/keycodes');
    expect(body['keycodeSpecVersion']).toBe(catalog.keycodeSpecVersion);
  });
});

describe('SOCD capabilities', () => {
  it('lists the verified policies for a compile-verified keyboard', async () => {
    const { status, body } = await get('/v1/catalog/latest/socd-capabilities/crkbd/rev1');
    expect(status).toBe(200);
    expect(body['available']).toBe(true);
    expect((body['policies'] as { id: string }[]).map((p) => p.id)).toEqual([
      'neutral',
      'last_input_priority',
    ]);
    expect(body['verticalPairs']).toEqual([
      ['KC_W', 'KC_S'],
      ['KC_UP', 'KC_DOWN'],
    ]);
  });

  it('reports SOCD unavailable, with a reason, for a keyboard that has not been verified', async () => {
    const { status, body } = await get('/v1/catalog/latest/socd-capabilities/planck/rev6');
    expect(status).toBe(200);
    expect(body['available']).toBe(false);
    expect(body['policies']).toEqual([]);
    expect(body['reason']).toMatch(/compile-verified/);
  });

  it('states that SOCD compliance is the user’s responsibility', async () => {
    // claude.md rule 10: never make a compliance claim on the user's behalf.
    const { body } = await get('/v1/catalog/latest/socd-capabilities/crkbd/rev1');
    expect(body['compliance']).toMatch(/no compliance claim/i);
  });

  it('404s for a keyboard that is not supported', async () => {
    const { status } = await get('/v1/catalog/latest/socd-capabilities/broken/kb');
    expect(status).toBe(404);
  });
});
