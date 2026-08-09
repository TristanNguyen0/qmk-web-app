import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GenerationError } from './generate.ts';
import { createWorkspaceLayout, writeGeneratedFiles } from './write-workspace.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qwa-test-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function result(files: { path: string; contents: string }[]) {
  return {
    files,
    keymapName: 'qwa_deadbeef',
    compileTarget: { keyboard: 'crkbd/rev1', keymap: 'qwa_deadbeef' },
    generatorVersion: '1.0.0',
    totalBytes: files.reduce((n, f) => n + f.contents.length, 0),
  };
}

describe('workspace containment', () => {
  it('creates the fixed layout the build container expects', () => {
    const layout = createWorkspaceLayout(root);
    expect(layout.userspaceDir).toBe(join(root, 'userspace'));
    expect(layout.buildDir).toBe(join(root, 'build'));
    expect(layout.qmkRootDir).toBe(join(root, 'qmkroot'));
  });

  it('writes allowlisted files inside the userspace root', () => {
    const layout = createWorkspaceLayout(root);
    const written = writeGeneratedFiles(
      layout,
      result([
        { path: 'qmk.json', contents: '{}\n' },
        { path: 'keyboards/crkbd/rev1/keymaps/qwa_deadbeef/keymap.json', contents: '{"a":1}\n' },
      ]),
    );
    expect(written).toHaveLength(2);
    expect(readFileSync(written[1]!, 'utf8')).toBe('{"a":1}\n');
  });

  it('rejects traversal out of the userspace root', () => {
    const layout = createWorkspaceLayout(root);
    for (const path of [
      '../escape.json',
      'keyboards/../../qmk.json',
      '../../../etc/passwd',
      '/etc/passwd',
    ]) {
      expect(() => writeGeneratedFiles(layout, result([{ path, contents: 'x' }])), path).toThrow(
        GenerationError,
      );
    }
  });

  it('rejects a filename outside the generated-file allowlist', () => {
    const layout = createWorkspaceLayout(root);
    for (const path of [
      'keyboards/crkbd/rev1/keymaps/qwa_deadbeef/rules.mk',
      'keyboards/crkbd/rev1/keymaps/qwa_deadbeef/keymap.c',
      'keyboards/crkbd/rev1/keymaps/qwa_deadbeef/config.h',
      'Makefile',
    ]) {
      expect(() => writeGeneratedFiles(layout, result([{ path, contents: 'x' }])), path).toThrow(
        GenerationError,
      );
    }
  });

  it('rejects a NUL byte in a generated path', () => {
    const layout = createWorkspaceLayout(root);
    expect(() =>
      writeGeneratedFiles(layout, result([{ path: 'qmk.json\0.txt', contents: 'x' }])),
    ).toThrow(GenerationError);
  });

  it('does not follow a symlink that redirects outside the workspace', () => {
    const layout = createWorkspaceLayout(root);
    const outside = mkdtempSync(join(tmpdir(), 'qwa-outside-'));
    try {
      // Plant a symlinked directory inside the userspace, as a compromised or
      // partially-reused workspace might contain.
      mkdirSync(join(layout.userspaceDir, 'keyboards'), { recursive: true });
      symlinkSync(outside, join(layout.userspaceDir, 'keyboards', 'evil'), 'dir');
      writeFileSync(join(outside, 'sentinel'), 'untouched');

      expect(() =>
        writeGeneratedFiles(layout, result([{ path: 'keyboards/evil/qmk.json', contents: 'x' }])),
      ).toThrow(GenerationError);
      expect(readFileSync(join(outside, 'sentinel'), 'utf8')).toBe('untouched');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite an existing file', () => {
    const layout = createWorkspaceLayout(root);
    const files = [{ path: 'qmk.json', contents: '{}\n' }];
    writeGeneratedFiles(layout, result(files));
    expect(() => writeGeneratedFiles(layout, result(files))).toThrow();
  });
});
