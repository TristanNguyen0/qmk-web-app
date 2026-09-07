import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readCatalogSample } from '@qmk-web-app/qmk-fixtures';
import type { Catalog } from '@qmk-web-app/domain';
import { ProviderError, type AssistantProvider, type ProposeRequest } from '@qmk-web-app/assistant';
import { buildApp } from '../app.ts';
import { CatalogStore } from '../catalog-store.ts';
import { InMemoryConfigurationRepository } from '../configurations/memory-repository.ts';
import { AssistantQuota } from './assistant.ts';

const catalog = readCatalogSample() as Catalog;
const SECRET = 'test-secret-that-is-long-enough-to-pass-0123';

/** Scripted provider: hands back proposals in order and records the requests. */
function scripted(proposals: unknown[]): AssistantProvider & { requests: ProposeRequest[] } {
  const requests: ProposeRequest[] = [];
  return {
    model: 'fake-model',
    requests,
    async propose(request) {
      requests.push(request);
      const next = proposals.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error('scripted provider exhausted');
      return { proposal: next, usage: { inputTokens: 10, outputTokens: 5 }, model: 'fake-model' };
    },
  };
}

let app: FastifyInstance;

function build(options: { provider?: AssistantProvider; quota?: AssistantQuota } = {}) {
  const store = new CatalogStore();
  store.add(catalog);
  app = buildApp({
    store,
    repository: new InMemoryConfigurationRepository(),
    sessionSecret: SECRET,
    ...(options.provider ? { assistant: { provider: options.provider, ...(options.quota ? { quota: options.quota } : {}) } } : {}),
  });
}

async function newSession(): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/health' });
  const cookie = res.headers['set-cookie'];
  const raw = Array.isArray(cookie) ? cookie[0]! : (cookie as string);
  return raw.split(';')[0]!;
}

async function createConfiguration(cookie: string): Promise<{ id: string; revision: number }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/configurations',
    headers: { cookie },
    payload: {
      name: 'Corne',
      catalogVersion: catalog.catalogVersion,
      qmkCommit: catalog.qmkCommit,
      keyboardId: 'crkbd/rev1',
      layoutId: 'LAYOUT_split_3x6_3',
      layers: [
        {
          id: '33333333-3333-4333-8333-333333333331',
          index: 0,
          name: 'Base',
          bindings: { '1': { kind: 'keycode', keycode: 'KC_Q' }, '2': { kind: 'keycode', keycode: 'KC_W' } },
        },
      ],
      macros: [],
      socd: null,
    },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { configuration: { id: string; revision: number } };
  return body.configuration;
}

function ask(cookie: string, id: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: `/v1/configurations/${id}/assistant`, headers: { cookie }, payload });
}

describe('assistant status', () => {
  it('reports disabled, and registers no proposal route, when there is no provider', async () => {
    build();
    const status = await app.inject({ method: 'GET', url: '/v1/assistant' });
    expect(status.json()).toMatchObject({ apiVersion: 1, enabled: false });
    expect((status.json() as { model?: string }).model).toBeUndefined();

    const cookie = await newSession();
    const { id } = await createConfiguration(cookie);
    const res = await ask(cookie, id, { prompt: 'hi' });
    expect(res.statusCode).toBe(404);
  });

  it('reports the model when enabled', async () => {
    build({ provider: scripted([]) });
    const status = await app.inject({ method: 'GET', url: '/v1/assistant' });
    expect(status.json()).toMatchObject({ enabled: true, model: 'fake-model', limits: { maxPromptLength: 2000 } });
  });
});

describe('POST /v1/configurations/:id/assistant', () => {
  let provider: ReturnType<typeof scripted>;

  beforeEach(() => {
    provider = scripted([
      { summary: 'Made Q a Delete key.', operations: [{ op: 'set_key', layer: 0, key: { key: 'Q' }, binding: { type: 'keycode', keycode: 'Del' } }] },
    ]);
    build({ provider });
  });

  it('returns a validated candidate without writing anything', async () => {
    const cookie = await newSession();
    const { id, revision } = await createConfiguration(cookie);

    const res = await ask(cookie, id, { prompt: 'make Q a delete key' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      apiVersion: 1,
      configurationId: id,
      baseRevision: revision,
      ok: true,
      summary: 'Made Q a Delete key.',
      unsupported: [],
      issues: [],
      validation: { ok: true },
      attempts: 1,
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const candidate = body['candidate'] as { layers: { bindings: Record<string, unknown> }[]; name: string };
    expect(candidate.layers[0]?.bindings['1']).toEqual({ kind: 'keycode', keycode: 'KC_DELETE' });
    expect(Object.keys(candidate).sort()).toEqual(['layers', 'macros', 'name', 'socd']);

    // The stored configuration is untouched: applying is the client's decision.
    const stored = await app.inject({ method: 'GET', url: `/v1/configurations/${id}`, headers: { cookie } });
    const doc = stored.json() as { configuration: { revision: number; layers: { bindings: Record<string, unknown> }[] } };
    expect(doc.configuration.revision).toBe(revision);
    expect(doc.configuration.layers[0]?.bindings['1']).toEqual({ kind: 'keycode', keycode: 'KC_Q' });
  });

  it('grounds the model in the client’s working document when one is sent', async () => {
    const cookie = await newSession();
    const { id } = await createConfiguration(cookie);
    const res = await ask(cookie, id, {
      prompt: 'make Q a delete key',
      document: {
        name: 'Renamed locally',
        layers: [
          { id: '33333333-3333-4333-8333-333333333331', index: 0, name: 'Base', bindings: { '1': { kind: 'keycode', keycode: 'KC_Q' } } },
          { id: '33333333-3333-4333-8333-333333333332', index: 1, name: 'Nav', bindings: {} },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(provider.requests[0]?.system).toContain('Layer 1 "Nav"');
    expect(provider.requests[0]?.system).toContain('Configuration "Renamed locally"');
    const body = res.json() as { candidate: { layers: unknown[] } };
    expect(body.candidate.layers).toHaveLength(2);
  });

  it('rejects a working document that does not fit the schema instead of trusting it', async () => {
    const cookie = await newSession();
    const { id } = await createConfiguration(cookie);
    const res = await ask(cookie, id, { prompt: 'x', document: { layers: [{ id: 'not-a-uuid', index: 0, name: 'B', bindings: {} }] } });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe('CONFIG_INVALID');
    expect(provider.requests).toHaveLength(0);
  });

  it('never sends the owner or session to the provider', async () => {
    const cookie = await newSession();
    const { id } = await createConfiguration(cookie);
    await ask(cookie, id, { prompt: 'make Q a delete key' });
    const sent = JSON.stringify(provider.requests[0]);
    expect(sent).not.toContain(cookie.split('=')[1]!.split('.')[0]);
    expect(sent).not.toContain(id);
  });

  it('validates the prompt and the id', async () => {
    const cookie = await newSession();
    const { id } = await createConfiguration(cookie);
    expect((await ask(cookie, id, { prompt: '' })).statusCode).toBe(400);
    expect((await ask(cookie, id, { prompt: 42 })).statusCode).toBe(400);
    expect((await ask(cookie, id, { prompt: 'x'.repeat(2001) })).statusCode).toBe(400);
    const stringBody = await app.inject({
      method: 'POST',
      url: `/v1/configurations/${id}/assistant`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: '"not an object"',
    });
    expect(stringBody.statusCode).toBe(400);
    expect((await ask(cookie, 'not-a-uuid', { prompt: 'x' })).statusCode).toBe(400);
    expect(provider.requests).toHaveLength(0);
  });

  it('answers 404 for another session’s configuration, exactly like the configuration routes', async () => {
    const owner = await newSession();
    const stranger = await newSession();
    const { id } = await createConfiguration(owner);
    const res = await ask(stranger, id, { prompt: 'make Q a delete key' });
    expect(res.statusCode).toBe(404);
    expect(provider.requests).toHaveLength(0);
  });

  it('returns partial results with issues when the model could not be fully honoured', async () => {
    const bad = { summary: 's', operations: [{ op: 'set_key', layer: 0, key: { position: 1 }, binding: { type: 'keycode', keycode: 'RGB_TOG' } }] };
    build({ provider: scripted([bad, bad]) });
    const cookie = await newSession();
    const { id } = await createConfiguration(cookie);
    const res = await ask(cookie, id, { prompt: 'q toggles rgb' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; issues: unknown[]; attempts: number };
    expect(body.ok).toBe(false);
    expect(body.issues).toHaveLength(1);
    expect(body.attempts).toBe(2);
  });

  it('maps provider failures and unparseable output to ASSISTANT_FAILED without leaking detail', async () => {
    build({ provider: scripted([new ProviderError('upstream said: invalid x-api-key sk-secret', 401)]) });
    let cookie = await newSession();
    let created = await createConfiguration(cookie);
    let res = await ask(cookie, created.id, { prompt: 'x' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'ASSISTANT_FAILED' } });
    expect(res.body).not.toContain('sk-secret');

    build({ provider: scripted(['garbage', 'garbage']) });
    cookie = await newSession();
    created = await createConfiguration(cookie);
    res = await ask(cookie, created.id, { prompt: 'x' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'ASSISTANT_FAILED' } });
  });

  it('enforces the per-session quota and releases in-flight slots', async () => {
    let now = 1_000_000;
    const quota = new AssistantQuota({ requestsPerOwnerPerHour: 2, requestWindowMs: 60_000, maxGlobalInFlight: 4 }, () => now);
    const ok = { summary: 's', operations: [] };
    build({ provider: scripted([ok, ok, ok, ok]), quota });
    const cookie = await newSession();
    const { id } = await createConfiguration(cookie);

    expect((await ask(cookie, id, { prompt: 'a' })).statusCode).toBe(200);
    expect((await ask(cookie, id, { prompt: 'b' })).statusCode).toBe(200);
    const refused = await ask(cookie, id, { prompt: 'c' });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);

    // Another session is unaffected, and the window slides.
    const other = await newSession();
    const otherConfig = await createConfiguration(other);
    expect((await ask(other, otherConfig.id, { prompt: 'd' })).statusCode).toBe(200);
    now += 61_000;
    expect((await ask(cookie, id, { prompt: 'e' })).statusCode).toBe(200);
  });
});

describe('AssistantQuota', () => {
  it('caps global in-flight requests and frees them on release', () => {
    const quota = new AssistantQuota({ requestsPerOwnerPerHour: 100, requestWindowMs: 1000, maxGlobalInFlight: 1 }, () => 0);
    expect(quota.acquire('a')).toEqual({ ok: true });
    expect(quota.acquire('b')).toMatchObject({ ok: false, reason: expect.stringMatching(/busy/) });
    quota.release();
    expect(quota.acquire('b')).toEqual({ ok: true });
  });
});
