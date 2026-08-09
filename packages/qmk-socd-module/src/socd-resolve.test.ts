/**
 * Compiles and runs the SOCD resolution logic as C.
 *
 * claude.md § SOCD Cleaner requirement 6 asks for behavioural tests of each policy
 * covering simultaneous opposite presses and release ordering. Asserting that in
 * TypeScript would only test a TypeScript reimplementation — and a reimplementation
 * that agrees with itself proves nothing about the firmware. So the actual C that ships
 * in the module is compiled here and its assertions are run.
 *
 * `socd_resolve.h` deliberately depends on nothing but stdbool/stdint, which is what
 * makes this possible without an AVR toolchain or a QMK tree.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const includeDir = join(packageRoot, 'module', 'qmkweb', 'socd_cleaner');
const testSource = join(packageRoot, 'test', 'socd_resolve_test.c');

/** A C compiler is not a dependency of this project, so skip rather than fail without one. */
const hasCompiler = spawnSync('cc', ['--version'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!hasCompiler)('SOCD resolution (compiled C)', () => {
  it('compiles warning-free and passes every behavioural assertion', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qwa-socd-cc-'));
    const binary = join(dir, 'socd_resolve_test');
    try {
      // -Werror: this source is compiled into firmware, where a warning is a defect.
      execFileSync(
        'cc',
        [
          '-std=c11',
          '-Wall',
          '-Wextra',
          '-Werror',
          '-O1',
          '-I',
          includeDir,
          testSource,
          '-o',
          binary,
        ],
        { stdio: 'pipe' },
      );

      const output = execFileSync(binary, { encoding: 'utf8' });
      expect(output).toMatch(/0 failures/);
      // Guard against the suite silently degrading to no assertions at all.
      const checks = Number(/(\d+) checks/.exec(output)?.[1] ?? '0');
      expect(checks).toBeGreaterThan(100);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
