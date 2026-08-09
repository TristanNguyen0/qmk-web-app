import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactError, collectArtifact, expectedTargetName } from './collect-artifact.ts';

const KEYBOARD = 'crkbd/rev1';
const KEYMAP = 'qwa_deadbeef';
const TARGET = expectedTargetName(KEYBOARD, KEYMAP);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qwa-artifact-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function collect() {
  return collectArtifact(dir, KEYBOARD, KEYMAP);
}

describe('expectedTargetName', () => {
  it('matches QMK make TARGET naming', () => {
    expect(TARGET).toBe('crkbd_rev1_qwa_deadbeef');
    expect(expectedTargetName('handwired/onekey/promicro', 'qwa_a')).toBe(
      'handwired_onekey_promicro_qwa_a',
    );
  });
});

describe('artifact identification', () => {
  it('accepts exactly the expected firmware file and checksums it', () => {
    writeFileSync(join(dir, `${TARGET}.hex`), 'firmware');
    writeFileSync(join(dir, 'qmk.json'), '{}');
    const artifact = collect();
    expect(artifact.filename).toBe(`${TARGET}.hex`);
    expect(artifact.extension).toBe('hex');
    expect(artifact.byteSize).toBe(8);
    expect(artifact.sha256).toBe(
      'c3bf47ea1f4a4a605470313cacb3a44f4a461f68c6faeab07e737610cb5ac835', // sha256("firmware")
    );
  });

  it('fails when no firmware was produced', () => {
    writeFileSync(join(dir, 'qmk.json'), '{}');
    expect(() => collect()).toThrow(ArtifactError);
    try {
      collect();
    } catch (e) {
      expect((e as ArtifactError).code).toBe('ARTIFACT_NOT_PRODUCED');
    }
  });

  it('rejects firmware that does not match the expected target name', () => {
    // A stray artifact from another build must never be served as this build's result.
    writeFileSync(join(dir, 'some_other_keyboard.hex'), 'firmware');
    try {
      collect();
      throw new Error('expected a rejection');
    } catch (e) {
      expect(e).toBeInstanceOf(ArtifactError);
      expect((e as ArtifactError).code).toBe('ARTIFACT_REJECTED');
    }
  });

  it('rejects a build that produced multiple matching firmware files', () => {
    writeFileSync(join(dir, `${TARGET}.hex`), 'a');
    writeFileSync(join(dir, `${TARGET}.bin`), 'b');
    try {
      collect();
      throw new Error('expected a rejection');
    } catch (e) {
      expect((e as ArtifactError).code).toBe('ARTIFACT_REJECTED');
    }
  });

  it('rejects an empty firmware file', () => {
    writeFileSync(join(dir, `${TARGET}.hex`), '');
    try {
      collect();
      throw new Error('expected a rejection');
    } catch (e) {
      expect((e as ArtifactError).code).toBe('ARTIFACT_REJECTED');
    }
  });

  it('ignores non-firmware files that are legitimately present', () => {
    writeFileSync(join(dir, `${TARGET}.hex`), 'firmware');
    writeFileSync(join(dir, 'qmk.json'), '{}');
    writeFileSync(join(dir, 'compile_commands.json'), '[]');
    expect(collect().filename).toBe(`${TARGET}.hex`);
  });
});
