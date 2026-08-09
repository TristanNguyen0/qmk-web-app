/**
 * Worker-level tests for the SOCD half of a build.
 *
 * The compile itself is covered by `pnpm socd:matrix`, which needs Docker. What is
 * tested here is the part that decides *what the compiler is given*: whether the SOCD
 * module reaches the userspace at all, and whether it stays out when SOCD is off.
 *
 * The sandbox is faked, and the fake drops a firmware file where QMK would, so the
 * whole runBuild path — generate, materialise, compile, collect — runs without Docker.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCatalogSample } from '@qmk-web-app/qmk-fixtures';
import {
  generatedKeymapName,
  type Catalog,
  type Configuration,
  type SupportedCatalogKeyboard,
} from '@qmk-web-app/domain';
import { GENERATOR_VERSION } from '@qmk-web-app/qmk-generator';
import type { BuildSandbox, SandboxRunRequest, SandboxRunResult } from '@qmk-web-app/qmk-sandbox';
import { expectedTargetName } from './collect-artifact.ts';
import { runBuild } from './run-build.ts';

const catalog = readCatalogSample() as Catalog;
const keyboard = catalog.keyboards.find(
  (k): k is SupportedCatalogKeyboard => k.supported && k.keyboardId === 'crkbd/rev1',
)!;

const BUILD_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

/**
 * Stands in for the build image: records what it was asked to do, writes the firmware
 * QMK would have written, and remembers the workspace so a test can inspect it.
 */
class FakeSandbox implements BuildSandbox {
  workspace: string | null = null;
  /** Files present under the userspace when the "compile" ran. */
  userspaceAtCompile: string[] = [];

  async verify(): Promise<void> {}

  async run(request: SandboxRunRequest): Promise<SandboxRunResult> {
    const mount = request.mounts?.find((m) => m.containerPath === '/workspace');
    this.workspace = mount?.hostPath ?? null;

    if (this.workspace) {
      const userspace = join(this.workspace, 'userspace');
      this.userspaceAtCompile = walk(userspace, userspace);
      const target = expectedTargetName(keyboard.keyboardId, generatedKeymapName(BUILD_ID));
      writeFileSync(join(userspace, `${target}.hex`), 'firmware');
    }

    return {
      outcome: 'succeeded',
      exitCode: 0,
      stdout: '',
      stderr: '',
      truncated: false,
      durationMs: 1,
      imageRef: 'fake',
      imageDigest: null,
    };
  }
}

function walk(dir: string, root: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, root));
    else out.push(full.slice(root.length + 1));
  }
  return out.sort();
}

function config(socdEnabled: boolean): Configuration {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: '22222222-2222-4222-8222-222222222222',
    ownerId: null,
    schemaVersion: 1,
    catalogVersion: catalog.catalogVersion,
    qmkCommit: catalog.qmkCommit,
    keyboardId: 'crkbd/rev1',
    layoutId: 'LAYOUT_split_3x6_3',
    name: 'Test',
    revision: 1,
    createdAt: now,
    updatedAt: now,
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
    macros: [],
    socd: socdEnabled
      ? {
          enabled: true,
          policyId: 'neutral',
          directionalKeys: { up: 0, down: 1, left: 2, right: 3 },
          directionalKeycodes: { up: 'KC_W', down: 'KC_S', left: 'KC_A', right: 'KC_D' },
        }
      : null,
    generatorVersion: GENERATOR_VERSION,
  } as Configuration;
}

describe('SOCD module placement', () => {
  it('places the module in the userspace when SOCD is on', async () => {
    const sandbox = new FakeSandbox();
    const result = await runBuild({ buildId: BUILD_ID, configuration: config(true), keyboard, sandbox });

    expect(result.status).toBe('succeeded');
    expect(sandbox.userspaceAtCompile).toContain('modules/qmkweb/socd_cleaner/socd_cleaner.c');
    expect(sandbox.userspaceAtCompile).toContain('modules/qmkweb/socd_cleaner/qmk_module.json');
    expect(sandbox.userspaceAtCompile).toContain('modules/qmkweb/socd_cleaner/socd_resolve.h');
  });

  it('leaves the module out entirely when SOCD is off', async () => {
    const sandbox = new FakeSandbox();
    const result = await runBuild({ buildId: BUILD_ID, configuration: config(false), keyboard, sandbox });

    expect(result.status).toBe('succeeded');
    expect(sandbox.userspaceAtCompile.some((f) => f.startsWith('modules/'))).toBe(false);
  });

  it('still writes only qmk.json and keymap.json as generated output', async () => {
    const sandbox = new FakeSandbox();
    await runBuild({ buildId: BUILD_ID, configuration: config(true), keyboard, sandbox });

    // Everything under modules/ is copied static source, not generated; nothing else
    // may appear.
    const generated = sandbox.userspaceAtCompile.filter((f) => !f.startsWith('modules/'));
    expect(generated).toEqual([
      `keyboards/crkbd/rev1/keymaps/${generatedKeymapName(BUILD_ID)}/keymap.json`,
      'qmk.json',
    ]);
  });

  it('names the module in keymap.json so QMK actually links it', async () => {
    const sandbox = new FakeSandbox();
    let keymap: Record<string, unknown> | null = null;
    const capturing: BuildSandbox = {
      verify: () => sandbox.verify(),
      run: async (request) => {
        const mount = request.mounts?.find((m) => m.containerPath === '/workspace');
        const path = join(
          mount!.hostPath,
          'userspace',
          'keyboards',
          'crkbd',
          'rev1',
          'keymaps',
          generatedKeymapName(BUILD_ID),
          'keymap.json',
        );
        keymap = JSON.parse(readFileSync(path, 'utf8'));
        return sandbox.run(request);
      },
    };

    await runBuild({ buildId: BUILD_ID, configuration: config(true), keyboard, sandbox: capturing });
    expect(keymap!['modules']).toEqual(['qmkweb/socd_cleaner']);
  });
});
