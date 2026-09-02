/**
 * The worker loop, driven against a fake sandbox.
 *
 * No Docker and no database: `runOnce()` is called explicitly so each test is a
 * deterministic sequence rather than a race with a poll timer. What is being checked
 * is the loop's contract with the queue — that every path reaches a terminal state,
 * that a lost lease stops the worker touching the build, and that a failure never
 * leaves a downloadable artifact behind.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryArtifactStore, artifactKey, logKey } from '@qmk-web-app/artifact-store';
import { InMemoryBuildStore } from '@qmk-web-app/build-queue';
import type { BuildRecord, Catalog, Configuration } from '@qmk-web-app/domain';
import { readCatalogSample } from '@qmk-web-app/qmk-fixtures';
import { SOCD_MODULE_VERSION } from '@qmk-web-app/qmk-socd-module';
import type {
  BuildSandbox,
  SandboxOutcome,
  SandboxRunRequest,
  SandboxRunResult,
} from '@qmk-web-app/qmk-sandbox';
import { QueueRunner } from './queue-runner.ts';
import { expectedTargetName } from './collect-artifact.ts';
import { generatedKeymapName } from '@qmk-web-app/domain';

const catalog = readCatalogSample() as Catalog;
const KEYBOARD_ID = 'crkbd/rev1';
const LAYOUT_ID = 'LAYOUT_split_3x6_3';
const WORKER = 'worker-under-test';
const OWNER = '11111111-1111-4111-8111-111111111111';

/**
 * A sandbox that writes the firmware QMK would have produced, or fails, without
 * running anything. It writes into the real workspace the generator prepared, so the
 * artifact collection path is exercised for real.
 */
class FakeSandbox implements BuildSandbox {
  outcome: SandboxOutcome = 'succeeded';
  /** Bytes the "compiler" emits. Changing it changes the artifact's checksum. */
  firmware = Buffer.from('fake firmware');
  /** Set to skip writing the firmware even on a successful run. */
  produceArtifact = true;
  readonly requests: SandboxRunRequest[] = [];
  onRun?: () => void | Promise<void>;

  async verify(): Promise<void> {}

  async run(request: SandboxRunRequest): Promise<SandboxRunResult> {
    this.requests.push(request);
    await this.onRun?.();

    if (this.outcome === 'succeeded' && this.produceArtifact) {
      const { writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const workspace = request.mounts?.find((m) => m.containerPath === '/workspace');
      if (!workspace) throw new Error('the worker did not mount a workspace');
      const keymap = request.args[request.args.indexOf('-km') + 1] as string;
      const keyboard = request.args[request.args.indexOf('-kb') + 1] as string;
      writeFileSync(
        join(workspace.hostPath, 'userspace', `${expectedTargetName(keyboard, keymap)}.hex`),
        this.firmware,
      );
    }

    return {
      outcome: this.outcome,
      exitCode: this.outcome === 'succeeded' ? 0 : 1,
      stdout: 'Compiling: keyboards/crkbd/rev1/rev1.c\nSize: 20624/28672\n',
      stderr: this.outcome === 'succeeded' ? '' : "error: 'KC_NOPE' undeclared\n",
      truncated: false,
      durationMs: 5,
      imageRef: 'qmk-web-app/qmk-build:test',
      imageDigest: 'sha256:' + 'd'.repeat(64),
    };
  }
}

let queue: InMemoryBuildStore;
let artifacts: InMemoryArtifactStore;
let sandbox: FakeSandbox;
let runner: QueueRunner;
let configuration: Configuration;
const configurationId = '22222222-2222-4222-8222-222222222222';

function makeConfiguration(): Configuration {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: configurationId,
    ownerId: OWNER,
    schemaVersion: 1,
    catalogVersion: catalog.catalogVersion,
    qmkCommit: catalog.qmkCommit,
    keyboardId: KEYBOARD_ID,
    layoutId: LAYOUT_ID,
    name: 'Worker test',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    layers: [
      {
        id: '33333333-3333-4333-8333-333333333331',
        index: 0,
        name: 'Base',
        bindings: {
          '0': { kind: 'keycode', keycode: 'KC_A' },
          '1': { kind: 'keycode', keycode: 'KC_B' },
        },
      },
    ],
    macros: [],
    socd: null,
    generatorVersion: '1',
  } as Configuration;
}

function buildRecord(overrides: Partial<BuildRecord> = {}): BuildRecord {
  return {
    id: randomUUID(),
    configurationId,
    configurationRevision: 1,
    ownerId: OWNER,
    catalogVersion: catalog.catalogVersion,
    qmkCommit: catalog.qmkCommit,
    generatorVersion: '1',
    socdModuleVersion: null,
    buildImageRef: 'qmk-web-app/qmk-build:test',
    buildImageDigest: null,
    status: 'queued',
    idempotencyKey: randomUUID(),
    requestedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    attemptCount: 0,
    artifactId: null,
    outputFormat: null,
    logReference: null,
    failureCode: null,
    ...overrides,
  };
}

beforeEach(() => {
  configuration = makeConfiguration();
  queue = new InMemoryBuildStore(async (id, revision) =>
    id === configurationId && revision === 1 ? configuration : null,
  );
  artifacts = new InMemoryArtifactStore();
  sandbox = new FakeSandbox();
  runner = new QueueRunner({
    workerId: WORKER,
    queue,
    artifacts,
    sandbox,
    catalogs: (version) => (version === catalog.catalogVersion ? catalog : null),
    heartbeatMs: 5,
  });
});

async function enqueue(overrides: Partial<BuildRecord> = {}): Promise<string> {
  const { build } = await queue.create(buildRecord(overrides));
  return build.id;
}

describe('QueueRunner.runOnce', () => {
  it('reports idle on an empty queue', async () => {
    expect(await runner.runOnce()).toBe('idle');
  });

  it('compiles a queued build and records its artifact', async () => {
    const buildId = await enqueue();

    expect(await runner.runOnce()).toBe('succeeded');

    const build = await queue.get(buildId, OWNER);
    expect(build?.status).toBe('succeeded');
    expect(build?.outputFormat).toBe('hex');
    // The image actually used is recorded, digest included, per claude.md § Build isolation.
    expect(build?.buildImageDigest).toBe('sha256:' + 'd'.repeat(64));
    // No SOCD in this configuration, so no module version is attributed.
    expect(build?.socdModuleVersion).toBeNull();

    const artifact = await queue.getArtifact(buildId, OWNER);
    expect(artifact?.byteSize).toBe(sandbox.firmware.byteLength);
    expect(await artifacts.get(artifactKey(buildId))).toEqual(sandbox.firmware);
  });

  it('records the SOCD module version the compile used, passed through unchanged', async () => {
    configuration = {
      ...configuration,
      layers: [
        {
          id: '33333333-3333-4333-8333-333333333331',
          index: 0,
          name: 'Base',
          bindings: {
            '0': { kind: 'keycode', keycode: 'KC_W' },
            '1': { kind: 'keycode', keycode: 'KC_S' },
            '2': { kind: 'keycode', keycode: 'KC_A' },
            '3': { kind: 'keycode', keycode: 'KC_D' },
          },
        },
      ],
      socd: {
        enabled: true,
        policyId: 'neutral',
        directionalKeys: { up: 0, down: 1, left: 2, right: 3 },
        directionalKeycodes: { up: 'KC_W', down: 'KC_S', left: 'KC_A', right: 'KC_D' },
      },
    };

    const buildId = await enqueue();
    expect(await runner.runOnce()).toBe('succeeded');

    const build = await queue.get(buildId, OWNER);
    expect(build?.socdModuleVersion).toBe(SOCD_MODULE_VERSION);
  });

  it('names the artifact from the build id, never from the configuration name', async () => {
    const buildId = await enqueue();
    await runner.runOnce();

    const artifact = await queue.getArtifact(buildId, OWNER);
    expect(artifact?.originalFilename).toBe(
      `${expectedTargetName(KEYBOARD_ID, generatedKeymapName(buildId))}.hex`,
    );
    expect(artifact?.originalFilename).not.toContain('Worker test');
  });

  it('stores a redacted log and references it from the build', async () => {
    const buildId = await enqueue();
    await runner.runOnce();

    const build = await queue.get(buildId, OWNER);
    expect(build?.logReference).toBe(logKey(buildId));
    const log = await artifacts.get(logKey(buildId));
    expect(log?.toString()).toContain('Size: 20624/28672');
  });

  it('fails a build whose compile failed, and stores no artifact', async () => {
    sandbox.outcome = 'failed';
    const buildId = await enqueue();

    expect(await runner.runOnce()).toBe('failed');

    const build = await queue.get(buildId, OWNER);
    expect(build?.status).toBe('failed');
    expect(build?.failureCode).toBe('COMPILE_FAILED');
    // The compiler error is available; the firmware is not.
    expect((await artifacts.get(logKey(buildId)))?.toString()).toContain('undeclared');
    expect(await artifacts.get(artifactKey(buildId))).toBeNull();
    expect(await queue.getArtifact(buildId, OWNER)).toBeNull();
  });

  it('maps a timeout to its own failure code', async () => {
    sandbox.outcome = 'timed_out';
    const buildId = await enqueue();

    await runner.runOnce();
    expect((await queue.get(buildId, OWNER))?.failureCode).toBe('TIMEOUT');
  });

  it('fails a build that compiled but produced no firmware', async () => {
    sandbox.produceArtifact = false;
    const buildId = await enqueue();

    expect(await runner.runOnce()).toBe('failed');
    const build = await queue.get(buildId, OWNER);
    expect(build?.failureCode).toBe('ARTIFACT_NOT_PRODUCED');
    expect(build?.status).toBe('failed');
  });

  it('fails a build whose configuration revision has vanished', async () => {
    // Reachable if a revision is removed while a build is queued. Guessing a
    // replacement is never acceptable, so the build fails.
    const buildId = await enqueue({ configurationRevision: 99 });

    expect(await runner.runOnce()).toBe('failed');
    expect((await queue.get(buildId, OWNER))?.failureCode).toBe('GENERATION_FAILED');
  });

  it('fails a build whose catalog this worker does not have', async () => {
    const buildId = await enqueue({ catalogVersion: 'not-a-catalog' });

    expect(await runner.runOnce()).toBe('failed');
    expect((await queue.get(buildId, OWNER))?.failureCode).toBe('GENERATION_FAILED');
  });

  it('re-validates the stored configuration rather than trusting it', async () => {
    // The API validated this when it was queued; the worker treats the database read
    // as untrusted and checks again.
    configuration = {
      ...configuration,
      layers: [
        {
          ...configuration.layers[0]!,
          bindings: { '9999': { kind: 'keycode', keycode: 'KC_A' } },
        },
      ],
    };
    const buildId = await enqueue();

    expect(await runner.runOnce()).toBe('failed');
    const build = await queue.get(buildId, OWNER);
    expect(build?.failureCode).toBe('GENERATION_FAILED');
    expect((await artifacts.get(logKey(buildId)))?.toString()).toContain('positions');
  });

  it('passes only validated catalog values to the sandbox', async () => {
    const buildId = await enqueue();
    await runner.runOnce();

    const request = sandbox.requests[0]!;
    expect(request.verb).toBe('compile');
    expect(request.args).toEqual([
      '-kb',
      KEYBOARD_ID,
      '-km',
      generatedKeymapName(buildId),
      '-j',
      '4',
    ]);
  });
});

describe('cancellation', () => {
  it('does not start a build cancelled before it was claimed', async () => {
    const buildId = await enqueue();
    await queue.requestCancellation(buildId, OWNER);

    // A cancelled build leaves the queue entirely.
    expect(await runner.runOnce()).toBe('idle');
    expect((await queue.get(buildId, OWNER))?.status).toBe('cancelled');
    expect(sandbox.requests).toHaveLength(0);
  });

  it('discards a compile cancelled while it was running', async () => {
    const buildId = await enqueue();
    sandbox.onRun = async () => {
      await queue.requestCancellation(buildId, OWNER);
    };

    expect(await runner.runOnce()).toBe('cancelled');

    const build = await queue.get(buildId, OWNER);
    expect(build?.status).toBe('cancelled');
    expect(build?.failureCode).toBe('CANCELLED');
    // The firmware compiled, and is deliberately not published.
    expect(await artifacts.get(artifactKey(buildId))).toBeNull();
    expect(await queue.getArtifact(buildId, OWNER)).toBeNull();
    // The log is kept and referenced, so a user can read what happened before they
    // cancelled — and so the reaper knows the object exists.
    expect(await artifacts.get(logKey(buildId))).not.toBeNull();
    expect(build?.logReference).toBe(logKey(buildId));
  });
});

describe('lease loss', () => {
  it('abandons a build whose lease was taken over mid-compile', async () => {
    // A worker holding a zero-length lease is, by definition, already overdue.
    const shortLeased = new QueueRunner({
      workerId: WORKER,
      queue,
      artifacts,
      sandbox,
      catalogs: () => catalog,
      leaseMs: 0,
    });
    const buildId = await enqueue();
    sandbox.onRun = async () => {
      // The reclaimer notices the expired lease and puts the build back in the queue.
      await queue.reclaimExpiredLeases({ maxAttempts: 5 });
    };

    expect(await shortLeased.runOnce()).toBe('abandoned');

    // The build is back in the queue for whoever holds it now — not failed by us, and
    // above all not completed by us.
    expect((await queue.get(buildId, OWNER))?.status).toBe('queued');
    expect(await queue.getArtifact(buildId, OWNER)).toBeNull();
  });

  it('does not leave an orphaned object when completion loses the race', async () => {
    const buildId = await enqueue();
    // The upload succeeds, then the completing write finds the lease gone.
    vi.spyOn(queue, 'complete').mockResolvedValue(false);

    expect(await runner.runOnce()).toBe('abandoned');
    expect(await artifacts.get(artifactKey(buildId))).toBeNull();
  });
});

describe('failure containment', () => {
  it('fails the build rather than leaving it in flight when the worker throws', async () => {
    const buildId = await enqueue();
    sandbox.onRun = () => {
      throw new Error('the sandbox exploded');
    };

    expect(await runner.runOnce()).toBe('failed');

    const build = await queue.get(buildId, OWNER);
    expect(build?.status).toBe('failed');
    expect(build?.failureCode).toBe('SANDBOX_ERROR');
    // No internal detail escapes into the stored log.
    expect((await artifacts.get(logKey(buildId)))?.toString()).not.toContain('exploded');
  });

  it('still finishes the build when its log cannot be stored', async () => {
    const buildId = await enqueue();
    vi.spyOn(artifacts, 'put').mockImplementation(async (args) => {
      if (args.key === logKey(buildId)) throw new Error('storage is down');
      InMemoryArtifactStore.prototype.put.call(artifacts, args);
    });

    expect(await runner.runOnce()).toBe('succeeded');
    expect((await queue.get(buildId, OWNER))?.logReference).toBeNull();
  });
});

describe('maintenance', () => {
  it('requeues an abandoned build and deletes expired objects', async () => {
    const buildId = await enqueue();
    await runner.runOnce();

    // Expire the artifact by hand, then reap.
    const stored = await queue.getArtifact(buildId, OWNER);
    expect(stored).not.toBeNull();
    vi.setSystemTime(new Date(Date.parse(stored!.expiresAt) + 1000));

    const result = await runner.maintain();
    expect(result.objectsDeleted).toBeGreaterThanOrEqual(1);
    expect(await artifacts.get(artifactKey(buildId))).toBeNull();
    expect((await queue.get(buildId, OWNER))?.status).toBe('expired');

    vi.useRealTimers();
  });
});
