import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readCatalogSample } from '@qmk-web-app/qmk-fixtures';
import type { Catalog } from '@qmk-web-app/domain';
import { buildApp } from '../app.ts';
import { CatalogStore } from '../catalog-store.ts';
import { InMemoryConfigurationRepository } from '../configurations/memory-repository.ts';

const catalog = readCatalogSample() as Catalog;
const SECRET = 'test-secret-that-is-long-enough-to-pass-0123';

let app: FastifyInstance;

beforeEach(() => {
  const store = new CatalogStore();
  store.add(catalog);
  app = buildApp({
    store,
    repository: new InMemoryConfigurationRepository(),
    sessionSecret: SECRET,
  });
});

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'My layout',
    catalogVersion: catalog.catalogVersion,
    qmkCommit: catalog.qmkCommit,
    keyboardId: 'crkbd/rev1',
    layoutId: 'LAYOUT_split_3x6_3',
    layers: [
      {
        id: '33333333-3333-4333-8333-333333333331',
        index: 0,
        name: 'Base',
        bindings: { '0': { kind: 'keycode', keycode: 'KC_A' } },
      },
    ],
    macros: [],
    socd: null,
    ...overrides,
  };
}

/** A session is just a cookie; two different cookies are two different owners. */
async function newSession(): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/health' });
  const cookie = res.headers['set-cookie'];
  const raw = Array.isArray(cookie) ? cookie[0]! : (cookie as string);
  return raw.split(';')[0]!;
}

async function create(cookie: string, body = validBody()) {
  return app.inject({
    method: 'POST',
    url: '/v1/configurations',
    headers: { cookie },
    payload: body,
  });
}

describe('sessions', () => {
  it('issues a session cookie and reuses it', async () => {
    const cookie = await newSession();
    expect(cookie).toMatch(/^qwa_session=/);

    const first = await create(cookie);
    expect(first.statusCode).toBe(201);

    const list = await app.inject({ method: 'GET', url: '/v1/configurations', headers: { cookie } });
    expect(list.json()['totalItems']).toBe(1);
  });

  it('sets HttpOnly and SameSite on the session cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const raw = String(res.headers['set-cookie']);
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
  });

  it('treats a tampered cookie as a fresh session rather than honouring it', async () => {
    const cookie = await newSession();
    await create(cookie);

    // Flip the signature; the id is unchanged but the HMAC no longer matches.
    const tampered = `${cookie.slice(0, -4)}AAAA`;
    const list = await app.inject({
      method: 'GET',
      url: '/v1/configurations',
      headers: { cookie: tampered },
    });
    expect(list.json()['totalItems']).toBe(0);
  });
});

describe('creating configurations', () => {
  it('creates and returns an ETag', async () => {
    const cookie = await newSession();
    const res = await create(cookie);
    expect(res.statusCode).toBe(201);
    expect(res.headers['etag']).toBe('"1"');

    const config = res.json()['configuration'] as Record<string, unknown>;
    expect(config['revision']).toBe(1);
    expect(config['keyboardId']).toBe('crkbd/rev1');
    expect(config['isDraft']).toBe(false);
  });

  it('never exposes ownerId', async () => {
    const cookie = await newSession();
    const res = await create(cookie);
    expect(res.body).not.toContain('ownerId');
  });

  it('ignores client-supplied server-controlled fields', async () => {
    const cookie = await newSession();
    const res = await create(
      cookie,
      validBody({
        id: '00000000-0000-4000-8000-0000000000ff',
        ownerId: '00000000-0000-4000-8000-0000000000aa',
        revision: 999,
        schemaVersion: 42,
      }) as ReturnType<typeof validBody>,
    );
    expect(res.statusCode).toBe(201);
    const config = res.json()['configuration'] as Record<string, unknown>;
    // The forged values must not have been honoured.
    expect(config['id']).not.toBe('00000000-0000-4000-8000-0000000000ff');
    expect(config['revision']).toBe(1);
    expect(config['schemaVersion']).toBe(1);
  });

  it('marks a configuration with no bindings as a draft', async () => {
    const cookie = await newSession();
    const res = await create(
      cookie,
      validBody({
        layers: [
          { id: '33333333-3333-4333-8333-333333333331', index: 0, name: 'Base', bindings: {} },
        ],
      }),
    );
    expect(res.json()['configuration']['isDraft']).toBe(true);
  });

  it('rejects an invalid configuration with field-level errors', async () => {
    const cookie = await newSession();
    const res = await create(
      cookie,
      validBody({
        layers: [
          {
            id: '33333333-3333-4333-8333-333333333331',
            index: 0,
            name: 'Base',
            bindings: { '999': { kind: 'keycode', keycode: 'KC_A' } },
          },
        ],
      }),
    );
    expect(res.statusCode).toBe(422);
    const error = res.json()['error'] as Record<string, unknown>;
    expect(error['code']).toBe('CONFIG_INVALID');
    expect((error['fieldErrors'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('rejects an unknown catalog version', async () => {
    const cookie = await newSession();
    const res = await create(cookie, validBody({ catalogVersion: '9.9.9-1' }));
    expect(res.statusCode).toBe(422);
  });

  it('rejects a keycode outside the product allowlist', async () => {
    const cookie = await newSession();
    const res = await create(
      cookie,
      validBody({
        layers: [
          {
            id: '33333333-3333-4333-8333-333333333331',
            index: 0,
            name: 'Base',
            bindings: { '0': { kind: 'keycode', keycode: 'QK_BOOTLOADER' } },
          },
        ],
      }),
    );
    expect(res.statusCode).toBe(422);
  });

  it('refuses to enable SOCD', async () => {
    const cookie = await newSession();
    const res = await create(
      cookie,
      validBody({
        socd: {
          enabled: true,
          policyId: 'neutral',
          directionalKeys: { up: 0, down: 1, left: 2, right: 3 },
          directionalKeycodes: { up: 'KC_W', down: 'KC_S', left: 'KC_A', right: 'KC_D' },
        },
      }),
    );
    expect(res.statusCode).toBe(409);
    expect(res.json()['error']['code']).toBe('CAPABILITY_UNAVAILABLE');
  });
});

describe('ownership', () => {
  it('hides another session’s configuration as not-found', async () => {
    const alice = await newSession();
    const bob = await newSession();
    const id = (await create(alice)).json()['configuration']['id'] as string;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/configurations/${id}`,
      headers: { cookie: bob },
    });
    // 404 rather than 403: Bob must not learn that this id exists.
    expect(res.statusCode).toBe(404);
  });

  it('prevents another session from updating or deleting', async () => {
    const alice = await newSession();
    const bob = await newSession();
    const id = (await create(alice)).json()['configuration']['id'] as string;

    const update = await app.inject({
      method: 'PUT',
      url: `/v1/configurations/${id}`,
      headers: { cookie: bob, 'if-match': '"1"' },
      payload: validBody({ name: 'hijacked' }),
    });
    expect(update.statusCode).toBe(404);

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/configurations/${id}`,
      headers: { cookie: bob },
    });
    expect(del.statusCode).toBe(404);

    // Alice's copy is untouched.
    const still = await app.inject({
      method: 'GET',
      url: `/v1/configurations/${id}`,
      headers: { cookie: alice },
    });
    expect(still.json()['configuration']['name']).toBe('My layout');
  });

  it('lists only the requesting session’s configurations', async () => {
    const alice = await newSession();
    const bob = await newSession();
    await create(alice);
    await create(alice);
    await create(bob);

    const aliceList = await app.inject({
      method: 'GET',
      url: '/v1/configurations',
      headers: { cookie: alice },
    });
    expect(aliceList.json()['totalItems']).toBe(2);

    const bobList = await app.inject({
      method: 'GET',
      url: '/v1/configurations',
      headers: { cookie: bob },
    });
    expect(bobList.json()['totalItems']).toBe(1);
  });
});

describe('optimistic concurrency', () => {
  it('requires If-Match on updates', async () => {
    const cookie = await newSession();
    const id = (await create(cookie)).json()['configuration']['id'] as string;

    const res = await app.inject({
      method: 'PUT',
      url: `/v1/configurations/${id}`,
      headers: { cookie },
      payload: validBody({ name: 'renamed' }),
    });
    expect(res.statusCode).toBe(428);
  });

  it('accepts a matching revision and bumps it', async () => {
    const cookie = await newSession();
    const id = (await create(cookie)).json()['configuration']['id'] as string;

    const res = await app.inject({
      method: 'PUT',
      url: `/v1/configurations/${id}`,
      headers: { cookie, 'if-match': '"1"' },
      payload: validBody({ name: 'renamed' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['etag']).toBe('"2"');
    expect(res.json()['configuration']['name']).toBe('renamed');
  });

  it('rejects a stale revision instead of overwriting', async () => {
    const cookie = await newSession();
    const id = (await create(cookie)).json()['configuration']['id'] as string;

    await app.inject({
      method: 'PUT',
      url: `/v1/configurations/${id}`,
      headers: { cookie, 'if-match': '"1"' },
      payload: validBody({ name: 'first writer' }),
    });

    // Second writer still believes it is editing revision 1.
    const stale = await app.inject({
      method: 'PUT',
      url: `/v1/configurations/${id}`,
      headers: { cookie, 'if-match': '"1"' },
      payload: validBody({ name: 'second writer' }),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()['error']['code']).toBe('CONFIG_CONFLICT');
    expect(stale.json()['currentRevision']).toBe(2);

    const current = await app.inject({
      method: 'GET',
      url: `/v1/configurations/${id}`,
      headers: { cookie },
    });
    expect(current.json()['configuration']['name']).toBe('first writer');
  });

  it('refuses to change the keyboard or layout after creation', async () => {
    const cookie = await newSession();
    const id = (await create(cookie)).json()['configuration']['id'] as string;

    for (const override of [{ keyboardId: 'planck/rev6' }, { layoutId: 'LAYOUT_split_3x5_3' }]) {
      const res = await app.inject({
        method: 'PUT',
        url: `/v1/configurations/${id}`,
        headers: { cookie, 'if-match': '"1"' },
        payload: validBody(override),
      });
      expect(res.statusCode, JSON.stringify(override)).toBe(422);
    }
  });

  it('does not bump the revision when validation fails', async () => {
    const cookie = await newSession();
    const id = (await create(cookie)).json()['configuration']['id'] as string;

    await app.inject({
      method: 'PUT',
      url: `/v1/configurations/${id}`,
      headers: { cookie, 'if-match': '"1"' },
      payload: validBody({ name: '' }),
    });

    const current = await app.inject({
      method: 'GET',
      url: `/v1/configurations/${id}`,
      headers: { cookie },
    });
    expect(current.json()['configuration']['revision']).toBe(1);
  });
});

describe('revision history', () => {
  it('keeps each revision retrievable', async () => {
    const cookie = await newSession();
    const id = (await create(cookie)).json()['configuration']['id'] as string;
    await app.inject({
      method: 'PUT',
      url: `/v1/configurations/${id}`,
      headers: { cookie, 'if-match': '"1"' },
      payload: validBody({ name: 'v2' }),
    });

    const first = await app.inject({
      method: 'GET',
      url: `/v1/configurations/${id}/revisions/1`,
      headers: { cookie },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()['document']['name']).toBe('My layout');

    const second = await app.inject({
      method: 'GET',
      url: `/v1/configurations/${id}/revisions/2`,
      headers: { cookie },
    });
    expect(second.json()['document']['name']).toBe('v2');
  });

  it('does not expose another session’s revision', async () => {
    const alice = await newSession();
    const bob = await newSession();
    const id = (await create(alice)).json()['configuration']['id'] as string;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/configurations/${id}/revisions/1`,
      headers: { cookie: bob },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('deletion', () => {
  it('deletes and then reports not-found', async () => {
    const cookie = await newSession();
    const id = (await create(cookie)).json()['configuration']['id'] as string;

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/configurations/${id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/v1/configurations/${id}`,
      headers: { cookie },
    });
    expect(after.statusCode).toBe(404);
  });
});
