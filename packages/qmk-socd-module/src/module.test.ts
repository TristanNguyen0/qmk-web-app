/**
 * Tests for the shipped SOCD module: its integrity, how it lands in a workspace, and
 * that its C and the TypeScript that generates keycodes for it agree.
 *
 * The last point matters more than it looks. The application emits keycode tokens into
 * keymap.json; the module defines those tokens in C. A token the module does not
 * define is an undefined identifier at compile time, and a token wired to the wrong
 * pair would send the wrong key — silently, on someone's keyboard.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SOCD_MODULE_DIGESTS,
  SOCD_MODULE_FILES,
  SOCD_MODULE_ID,
  SOCD_MODULE_VERSION,
  SocdModuleError,
  materializeSocdModule,
  readSocdModuleFiles,
  verifySocdModuleIntegrity,
} from './index.ts';
import {
  MODULE_REGISTRY,
  SOCD_HORIZONTAL_PAIRS,
  SOCD_MODULE_KEYCODES,
  SOCD_VERTICAL_PAIRS,
} from '@qmk-web-app/domain';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const moduleDir = join(packageRoot, 'module', 'qmkweb', 'socd_cleaner');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qwa-socd-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('module integrity', () => {
  it('matches the digests pinned at review time', () => {
    expect(() => verifySocdModuleIntegrity()).not.toThrow();
  });

  it('ships exactly the reviewed files and nothing else', () => {
    // QMK's build system picks up what is in a module directory, so an unlisted file
    // arriving there is a way to get unreviewed code into a firmware image.
    expect(readdirSync(moduleDir).sort()).toEqual([...SOCD_MODULE_FILES].sort());
  });

  it('is the path QMK will look for the module under', () => {
    expect(SOCD_MODULE_ID).toBe('qmkweb/socd_cleaner');
    // `<module>.c` must match the directory name for QMK to compile it automatically.
    expect(SOCD_MODULE_FILES).toContain(`${SOCD_MODULE_ID.split('/')[1]}.c`);
  });
});

describe('materialising into a workspace', () => {
  it('places the module where the userspace build will find it', () => {
    const written = materializeSocdModule(root);
    expect(written).toHaveLength(SOCD_MODULE_FILES.length);
    for (const name of SOCD_MODULE_FILES) {
      expect(written).toContain(join(root, 'modules', 'qmkweb', 'socd_cleaner', name));
    }
  });

  it('copies the source byte for byte', () => {
    materializeSocdModule(root);
    for (const file of readSocdModuleFiles()) {
      const copied = readFileSync(join(root, 'modules', 'qmkweb', 'socd_cleaner', file.name));
      expect(copied.equals(file.contents)).toBe(true);
    }
  });

  it('refuses to overwrite a file that is already there', () => {
    materializeSocdModule(root);
    expect(() => materializeSocdModule(root)).toThrow();
  });

  it('declares the module manifest QMK validates against its schema', () => {
    materializeSocdModule(root);
    const manifest = JSON.parse(
      readFileSync(join(root, 'modules', 'qmkweb', 'socd_cleaner', 'qmk_module.json'), 'utf8'),
    );
    // Required by qmk.community_module.v1 at the pinned revision.
    expect(manifest.module_name).toBeTruthy();
    expect(manifest.maintainer).toBeTruthy();
  });
});

describe('the C and the TypeScript agree', () => {
  const manifest = JSON.parse(readFileSync(join(moduleDir, 'qmk_module.json'), 'utf8')) as {
    keycodes: { key: string; aliases?: string[] }[];
  };
  const source = readFileSync(join(moduleDir, 'socd_cleaner.c'), 'utf8');

  it('every keycode the application emits is declared by the module', () => {
    const declared = new Set(manifest.keycodes.map((k) => k.key));
    for (const keycode of SOCD_MODULE_KEYCODES) {
      expect(declared.has(keycode), `${keycode} is not declared in qmk_module.json`).toBe(true);
    }
  });

  it('declares no keycode the application never emits', () => {
    // An undeclared-but-defined keycode is dead weight in a firmware image and an
    // untested code path.
    const emitted = new Set(SOCD_MODULE_KEYCODES);
    for (const declared of manifest.keycodes) {
      expect(emitted.has(declared.key), `${declared.key} is declared but never emitted`).toBe(true);
    }
  });

  it('handles every declared keycode in the C dispatch', () => {
    for (const { key } of manifest.keycodes) {
      expect(source.includes(`case ${key}:`), `${key} has no case in socd_cleaner.c`).toBe(true);
    }
  });

  it('keeps its alias names within QMK’s 7-character limit', () => {
    // data/schemas/definitions.jsonschema#keycode_short at the pinned revision.
    for (const { aliases = [] } of manifest.keycodes) {
      for (const alias of aliases) {
        expect(alias.length, `${alias} is too long to be a QMK keycode alias`).toBeLessThanOrEqual(7);
      }
    }
  });

  it('pairs the same directions in C as the domain does', () => {
    // socd_pair_basics in the C, against SOCD_*_PAIRS in the domain.
    for (const [a, b] of [...SOCD_VERTICAL_PAIRS, ...SOCD_HORIZONTAL_PAIRS]) {
      expect(source.includes(`{${a}, ${b}}`), `the C has no pair {${a}, ${b}}`).toBe(true);
    }
  });
});

describe('integrity failures are loud', () => {
  it('refuses to materialise a module whose source has been altered', () => {
    // Simulated by pointing the check at a tampered copy: the digest is what stands
    // between reviewed C and whatever ends up in the module directory.
    const tampered = join(root, 'socd_cleaner.c');
    writeFileSync(tampered, `${readFileSync(join(moduleDir, 'socd_cleaner.c'), 'utf8')}\n// edit`);
    const original = readFileSync(join(moduleDir, 'socd_cleaner.c'));
    try {
      writeFileSync(join(moduleDir, 'socd_cleaner.c'), readFileSync(tampered));
      expect(() => verifySocdModuleIntegrity()).toThrow(SocdModuleError);
      expect(() => materializeSocdModule(root)).toThrow(/reviewed digest/);
    } finally {
      writeFileSync(join(moduleDir, 'socd_cleaner.c'), original);
    }
    expect(() => verifySocdModuleIntegrity()).not.toThrow();
  });
});

describe('the curated module registry agrees with this package', () => {
  // MODULE_REGISTRY (packages/domain) cannot import this package — that would be a
  // dependency cycle, since this package already depends on domain — so it carries a
  // hand-pinned copy of these facts instead. This is the one place both packages can
  // be imported together, so this is where drift between the two gets caught.
  const manifest = JSON.parse(readFileSync(join(moduleDir, 'qmk_module.json'), 'utf8')) as {
    license: string;
  };
  const registryEntry = MODULE_REGISTRY['qmkweb/socd_cleaner'];

  it('pins the same module version this package publishes', () => {
    expect(registryEntry.sourceRevision.moduleVersion).toBe(SOCD_MODULE_VERSION);
  });

  it('pins the same license qmk_module.json declares', () => {
    expect(registryEntry.license).toBe(manifest.license);
  });

  it('pins the same digested file set the digest manifest covers', () => {
    expect(new Set(registryEntry.sourceRevision.digestedFiles)).toEqual(
      new Set(Object.keys(SOCD_MODULE_DIGESTS)),
    );
  });
});
