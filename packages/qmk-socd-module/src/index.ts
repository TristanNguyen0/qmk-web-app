/**
 * The first-party SOCD Cleaner QMK community module, and the code that places it in
 * a build workspace.
 *
 * The module's C source is **static, reviewed, first-party code** that lives in this
 * repository under `module/`. It is never generated, never templated, and contains no
 * user-derived value of any kind — a user's SOCD choice reaches the firmware purely as
 * keycode tokens in `keymap.json` (see docs/adr/0005). So this module has one job:
 * copy a fixed set of files into the ephemeral userspace, having first proved they are
 * the files that were reviewed.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The module path as it appears in `keymap.json`'s `modules` array — the path relative
 * to `modules/` in the userspace, per the pinned revision's
 * `lib/python/qmk/community_modules.py:find_module_path`.
 */
export const SOCD_MODULE_ID = 'qmkweb/socd_cleaner';

/**
 * Bumped whenever the module's C changes. Recorded with builds so a firmware image can
 * be traced to the exact SOCD implementation that produced it.
 */
export const SOCD_MODULE_VERSION = '1.0.0';

/**
 * The complete set of files that make up the module. Enforced in both directions: a
 * file here that is missing on disk fails, and a file on disk that is not here fails.
 * A stray `.c` in the module directory would otherwise be a way to get unreviewed code
 * into a firmware build, since QMK's build system globs module directories.
 */
export const SOCD_MODULE_FILES = Object.freeze([
  'qmk_module.json',
  'socd_cleaner.c',
  'socd_resolve.h',
] as const);

const moduleSourceDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'module',
  'qmkweb',
  'socd_cleaner',
);

export class SocdModuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SocdModuleError';
  }
}

/**
 * SHA-256 of every shipped file, pinned at review time.
 *
 * Regenerate with `pnpm socd:manifest` when the module source legitimately changes —
 * which should be a deliberate, reviewed act, because this source is compiled into
 * other people's firmware.
 */
export const SOCD_MODULE_DIGESTS: Readonly<Record<string, string>> = Object.freeze({
  'qmk_module.json': 'dee970a0c71d463e8ae30d1d134a0bcbd6793e10a9f66f1ec9fd8c116b95acbb',
  'socd_cleaner.c': '58bc50708136f26167e740cb328159f10cf27126faca3fd456a4a17d8a971ed6',
  'socd_resolve.h': '248f4cb56525db2060d338a9cf1f988a936cf0ef7b1c8e3db265d4aeab365dfe',
});

function sha256(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}

/** Reads the shipped module files, verifying the directory holds exactly what it should. */
export function readSocdModuleFiles(): { name: string; contents: Buffer; sha256: string }[] {
  const present = readdirSync(moduleSourceDir).sort();
  const expected = [...SOCD_MODULE_FILES].sort();
  if (present.join(',') !== expected.join(',')) {
    throw new SocdModuleError(
      `the SOCD module directory holds ${present.join(', ')}, but exactly ${expected.join(', ')} were expected`,
    );
  }

  return expected.map((name) => {
    const contents = readFileSync(join(moduleSourceDir, name));
    return { name, contents, sha256: sha256(contents) };
  });
}

/** Throws unless every shipped file matches its pinned digest. */
export function verifySocdModuleIntegrity(): void {
  for (const file of readSocdModuleFiles()) {
    const pinned = SOCD_MODULE_DIGESTS[file.name];
    if (pinned !== file.sha256) {
      throw new SocdModuleError(
        `SOCD module file ${file.name} does not match its reviewed digest ` +
          `(pinned ${pinned}, found ${file.sha256}); regenerate with pnpm socd:manifest if this change is intended`,
      );
    }
  }
}

/**
 * Copies the module into a build workspace's userspace.
 *
 * Returns the absolute paths written. Every path component is a compile-time constant
 * in this file, so there is nothing here for a user value to influence.
 */
export function materializeSocdModule(userspaceDir: string): string[] {
  verifySocdModuleIntegrity();

  const targetDir = join(userspaceDir, 'modules', 'qmkweb', 'socd_cleaner');
  mkdirSync(targetDir, { recursive: true, mode: 0o750 });

  const written: string[] = [];
  for (const file of readSocdModuleFiles()) {
    const target = join(targetDir, file.name);
    // `wx`: a fresh workspace has no such file, so an existing one means something
    // unexpected is already there and must not be overwritten silently.
    writeFileSync(target, file.contents, { mode: 0o640, flag: 'wx' });
    written.push(target);
  }
  return written;
}
