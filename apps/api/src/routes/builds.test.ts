/**
 * Build API surface.
 *
 * The assertions that matter most here are the negative ones: a draft cannot be built,
 * a quota cannot be exceeded, a retry cannot start a second compile, and no response
 * ever hands one session another session's build, log, or firmware.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { InMemoryArtifactStore, artifactKey, logKey } from '@qmk-web-app/artifact-store';
import { BUILD_LIMITS, type Catalog } from '@qmk-web-app/domain';
import { readCatalogSample } from '@qmk-web-app/qmk-fixtures';
import { buildApp } from '../app.ts';
import { InMemoryBuildStore } from '@qmk-web-app/build-queue';
import { CatalogStore } from '../catalog-store.ts';
import { InMemoryConfigurationRepository } from '../configurations/memory-repository.ts';
import { globalCapacityMessage, ownerConcurrencyMessage, ownerHourlyMessage } from './builds.ts';

const catalog = readCatalogSample() as Catalog;
const SECRET = 'test-secret-that-is-long-enough-to-pass-0123';
const ENVIRONMENT = { imageRef: 'qmk-web-app/qmk-build:test', imageDigest: null };
const WORKER = 'worker-1';

let app: FastifyInstance;
let builds: InMemoryBuildStore;
let artifacts: InMemoryArtifactStore;

beforeEach(() => {
  const store = new CatalogStore();
  store.add(catalog);
  builds = new InMemoryBuildStore();
  artifacts = new InMemoryArtifactStore();
  app = buildApp({
    store,
    repository: new InMemoryConfigurationRepository(),
    builds: { repository: builds, artifacts, environment: ENVIRONMENT },
    sessionSecret: SECRET,
  });
});

async function newSession(): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/health' });
  const cookie = res.headers['set-cookie'];
  const raw = Array.isArray(cookie) ? cookie[0]! : (cookie as string);
  return raw.split(';')[0]!;
}

function configurationBody(overrides: Record<string, unknown> = {}) {
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

async function createConfiguration(cookie: string, body = configurationBody()): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/configurations',
    headers: { cookie },
    payload: body,
  });
  expect(res.statusCode).toBe(201);
  return res.json()['configuration']['id'] as string;
}

async function requestBuild(cookie: string, configurationId: string, key: string = randomUUID()) {
  return app.inject({
    method: 'POST',
    url: `/v1/configurations/${configurationId}/builds`,
    headers: { cookie, 'idempotency-key': key },
  });
}

/** Drives a queued build to `succeeded` the way the worker would. */
async function succeed(buildId: string, ownerFilename = 'crkbd_rev1_qwa_build.hex') {
  const claimed = await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
  expect(claimed?.buildId).toBe(buildId);
  await builds.advance({ buildId, workerId: WORKER, from: 'preparing', to: 'building' });
  await builds.advance({ buildId, workerId: WORKER, from: 'building', to: 'uploading' });

  const contents = Buffer.from('firmware bytes');
  await artifacts.put({
    key: artifactKey(buildId),
    contents,
    contentType: 'application/octet-stream',
  });
  await artifacts.put({
    key: logKey(buildId),
    contents: Buffer.from('Linking: .build/x.elf\nSize: 20624/28672\n'),
    contentType: 'text/plain',
  });

  await builds.complete({
    buildId,
    workerId: WORKER,
    artifact: {
      id: randomUUID(),
      storageKey: artifactKey(buildId),
      originalFilename: ownerFilename,
      byteSize: contents.byteLength,
      sha256: 'a'.repeat(64),
      contentType: 'application/octet-stream',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
    outputFormat: 'hex',
    logReference: logKey(buildId),
    buildImageRef: ENVIRONMENT.imageRef,
    buildImageDigest: null,
    generatorVersion: '1',
    socdModuleVersion: null,
  });
}

describe('POST /v1/configurations/:id/builds', () => {
  it('queues a build for a complete configuration', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);

    const res = await requestBuild(cookie, configurationId);

    expect(res.statusCode).toBe(201);
    const build = res.json()['build'];
    expect(build['status']).toBe('queued');
    expect(build['configurationRevision']).toBe(1);
    // Reproducibility triple recorded at request time.
    expect(build['catalogVersion']).toBe(catalog.catalogVersion);
    expect(build['qmkCommit']).toBe(catalog.qmkCommit);
    expect(res.headers['location']).toBe(`/v1/builds/${build['id']}`);
  });

  it('requires an idempotency key', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/configurations/${configurationId}/builds`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a malformed idempotency key', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);

    for (const key of ['short', 'has spaces here', 'a'.repeat(129), '../../etc/passwd']) {
      const res = await requestBuild(cookie, configurationId, key);
      expect(res.statusCode, key).toBe(400);
    }
  });

  it('returns the same build for a repeated key, without queueing a second', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);
    const key = 'retry-key-0001';

    const first = await requestBuild(cookie, configurationId, key);
    const second = await requestBuild(cookie, configurationId, key);

    expect(first.statusCode).toBe(201);
    // 200, not 201: the retry is visibly a retry.
    expect(second.statusCode).toBe(200);
    expect(second.json()['build']['id']).toBe(first.json()['build']['id']);

    const list = await app.inject({
      method: 'GET',
      url: `/v1/configurations/${configurationId}/builds`,
      headers: { cookie },
    });
    expect(list.json()['totalItems']).toBe(1);
  });

  it('refuses to build a draft', async () => {
    const cookie = await newSession();
    // No bindings anywhere: structurally valid, nothing to compile.
    const configurationId = await createConfiguration(
      cookie,
      configurationBody({
        layers: [
          {
            id: '33333333-3333-4333-8333-333333333331',
            index: 0,
            name: 'Base',
            bindings: {},
          },
        ],
      }),
    );

    const res = await requestBuild(cookie, configurationId);
    expect(res.statusCode).toBe(422);
    expect(res.json()['error']['code']).toBe('CONFIG_INVALID');
  });

  it('enforces the concurrent build quota', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);

    for (let i = 0; i < BUILD_LIMITS.maxActiveBuildsPerOwner; i += 1) {
      expect((await requestBuild(cookie, configurationId)).statusCode).toBe(201);
    }

    const rejected = await requestBuild(cookie, configurationId);
    expect(rejected.statusCode).toBe(429);
    expect(rejected.json()['error']['code']).toBe('BUILD_QUEUE_LIMITED');
  });

  it('frees a quota slot when a build finishes', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);

    const first = await requestBuild(cookie, configurationId);
    await succeed(first.json()['build']['id']);

    for (let i = 0; i < BUILD_LIMITS.maxActiveBuildsPerOwner; i += 1) {
      expect((await requestBuild(cookie, configurationId)).statusCode).toBe(201);
    }
  });

  it('rejects a build over the global queue-depth cap with a capacity message, not a personal-quota one', async () => {
    // One build per session, spread across BUILD_LIMITS.maxGlobalActiveBuilds distinct
    // sessions, so no per-owner cap (2) intervenes before the global one does.
    for (let i = 0; i < BUILD_LIMITS.maxGlobalActiveBuilds; i += 1) {
      const cookie = await newSession();
      const configurationId = await createConfiguration(cookie);
      expect((await requestBuild(cookie, configurationId)).statusCode).toBe(201);
    }

    const outsider = await newSession();
    const outsiderConfigurationId = await createConfiguration(outsider);
    const rejected = await requestBuild(outsider, outsiderConfigurationId);

    expect(rejected.statusCode).toBe(429);
    expect(rejected.json()['error']['code']).toBe('BUILD_QUEUE_LIMITED');
    // The global rejection must not blame the caller: it must not read like either of
    // the two per-owner messages, and must read like the capacity message instead.
    const message = rejected.json()['error']['message'] as string;
    expect(message).toBe(globalCapacityMessage());
    expect(message).not.toBe(ownerConcurrencyMessage(0));
    expect(message).not.toBe(ownerConcurrencyMessage(1));
    expect(message).not.toBe(ownerConcurrencyMessage(2));
    expect(message).not.toBe(ownerHourlyMessage());
  });

  it('does not queue a build for another session’s configuration', async () => {
    const alice = await newSession();
    const bob = await newSession();
    const configurationId = await createConfiguration(alice);

    const res = await requestBuild(bob, configurationId);
    // 404 rather than 403, so a configuration id cannot be probed.
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /v1/builds/:id', () => {
  it('reports status to the owner', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);
    const id = (await requestBuild(cookie, configurationId)).json()['build']['id'];

    const res = await app.inject({ method: 'GET', url: `/v1/builds/${id}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()['build']['status']).toBe('queued');
    expect(res.json()['build']['artifact']).toBeNull();
  });

  it('hides a build from another session', async () => {
    const alice = await newSession();
    const bob = await newSession();
    const configurationId = await createConfiguration(alice);
    const id = (await requestBuild(alice, configurationId)).json()['build']['id'];

    const res = await app.inject({ method: 'GET', url: `/v1/builds/${id}`, headers: { cookie: bob } });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a malformed id', async () => {
    const cookie = await newSession();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/builds/not-a-uuid',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('never returns a storage key', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);
    const id = (await requestBuild(cookie, configurationId)).json()['build']['id'];
    await succeed(id);

    const res = await app.inject({ method: 'GET', url: `/v1/builds/${id}`, headers: { cookie } });
    expect(res.body).not.toContain('builds/');
    expect(res.json()['build']['artifact']['filename']).toBe('crkbd_rev1_qwa_build.hex');
  });
});

describe('cancellation', () => {
  it('cancels a queued build outright', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);
    const id = (await requestBuild(cookie, configurationId)).json()['build']['id'];

    const res = await app.inject({
      method: 'POST',
      url: `/v1/builds/${id}/cancel`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()['outcome']).toBe('cancelled');
    expect(res.json()['build']['status']).toBe('cancelled');
  });

  it('accepts a request for a running build', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);
    const id = (await requestBuild(cookie, configurationId)).json()['build']['id'];
    await builds.claim({ workerId: WORKER, leaseMs: 60_000 });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/builds/${id}/cancel`,
      headers: { cookie },
    });
    // 202: the worker has not stopped yet.
    expect(res.statusCode).toBe(202);
    expect(res.json()['outcome']).toBe('requested');
  });

  it('will not cancel another session’s build', async () => {
    const alice = await newSession();
    const bob = await newSession();
    const configurationId = await createConfiguration(alice);
    const id = (await requestBuild(alice, configurationId)).json()['build']['id'];

    const res = await app.inject({
      method: 'POST',
      url: `/v1/builds/${id}/cancel`,
      headers: { cookie: bob },
    });
    expect(res.statusCode).toBe(404);
    expect((await builds.get(id, 'anything')) ?? null).toBeNull();
  });
});

describe('artifact download', () => {
  it('serves the firmware to its owner with a checksum header', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);
    const id = (await requestBuild(cookie, configurationId)).json()['build']['id'];
    await succeed(id);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/builds/${id}/artifact`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.toString()).toBe('firmware bytes');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="crkbd_rev1_qwa_build.hex"',
    );
    expect(res.headers['x-artifact-sha256']).toBe('a'.repeat(64));
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('refuses the firmware to another session', async () => {
    const alice = await newSession();
    const bob = await newSession();
    const configurationId = await createConfiguration(alice);
    const id = (await requestBuild(alice, configurationId)).json()['build']['id'];
    await succeed(id);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/builds/${id}/artifact`,
      headers: { cookie: bob },
    });
    expect(res.statusCode).toBe(404);
  });

  it('does not offer a download for a build that has not succeeded', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);
    const id = (await requestBuild(cookie, configurationId)).json()['build']['id'];

    await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
    await builds.fail({
      buildId: id,
      workerId: WORKER,
      failureCode: 'COMPILE_FAILED',
      logReference: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/builds/${id}/artifact`,
      headers: { cookie },
    });
    // A failed compile must never look like flashable firmware.
    expect(res.statusCode).toBe(404);
    expect(res.json()['error']['code']).toBe('ARTIFACT_MISSING');
  });

  it('reports an expired artifact as gone rather than missing', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);
    const id = (await requestBuild(cookie, configurationId)).json()['build']['id'];

    await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
    await builds.advance({ buildId: id, workerId: WORKER, from: 'preparing', to: 'building' });
    await builds.advance({ buildId: id, workerId: WORKER, from: 'building', to: 'uploading' });
    await artifacts.put({
      key: artifactKey(id),
      contents: Buffer.from('fw'),
      contentType: 'application/octet-stream',
    });
    await builds.complete({
      buildId: id,
      workerId: WORKER,
      artifact: {
        id: randomUUID(),
        storageKey: artifactKey(id),
        originalFilename: 'crkbd_rev1_qwa_build.hex',
        byteSize: 2,
        sha256: 'b'.repeat(64),
        contentType: 'application/octet-stream',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      outputFormat: 'hex',
      logReference: null,
      buildImageRef: ENVIRONMENT.imageRef,
      buildImageDigest: null,
      generatorVersion: '1',
      socdModuleVersion: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/builds/${id}/artifact`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()['error']['code']).toBe('ARTIFACT_EXPIRED');
  });
});

describe('build log', () => {
  it('serves the sanitized log to its owner', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);
    const id = (await requestBuild(cookie, configurationId)).json()['build']['id'];
    await succeed(id);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/builds/${id}/log`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    // Attachment, so a log can never be rendered as a document by a browser.
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body).toContain('Size: 20624/28672');
  });

  it('refuses the log to another session', async () => {
    const alice = await newSession();
    const bob = await newSession();
    const configurationId = await createConfiguration(alice);
    const id = (await requestBuild(alice, configurationId)).json()['build']['id'];
    await succeed(id);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/builds/${id}/log`,
      headers: { cookie: bob },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s when a build has no log yet', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);
    const id = (await requestBuild(cookie, configurationId)).json()['build']['id'];

    const res = await app.inject({
      method: 'GET',
      url: `/v1/builds/${id}/log`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /v1/configurations/:id/builds', () => {
  it('lists a configuration’s builds newest first', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);

    const first = (await requestBuild(cookie, configurationId)).json()['build']['id'];
    await succeed(first);
    const second = (await requestBuild(cookie, configurationId)).json()['build']['id'];

    const res = await app.inject({
      method: 'GET',
      url: `/v1/configurations/${configurationId}/builds`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json()['items'];
    expect(items).toHaveLength(2);
    expect(items[0]['id']).toBe(second);
    expect(items[1]['artifact']['sha256']).toBe('a'.repeat(64));
  });

  it('rejects an out-of-range page size', async () => {
    const cookie = await newSession();
    const configurationId = await createConfiguration(cookie);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/configurations/${configurationId}/builds?pageSize=5000`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});
