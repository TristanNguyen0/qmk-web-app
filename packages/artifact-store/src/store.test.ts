import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { artifactKey, assertValidKey, logKey } from './keys.ts';
import { FilesystemArtifactStore } from './filesystem-store.ts';
import { InMemoryArtifactStore } from './memory-store.ts';
import { ArtifactStoreError, type ArtifactStore } from './types.ts';

const BUILD_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

describe('storage keys', () => {
  it('derives one key per object from the build id alone', () => {
    expect(artifactKey(BUILD_ID)).toBe(`builds/${BUILD_ID}/firmware`);
    expect(logKey(BUILD_ID)).toBe(`builds/${BUILD_ID}/log`);
  });

  it('refuses anything that is not a build id', () => {
    // The only input to key derivation is a UUID, so traversal has nowhere to enter.
    for (const bad of ['../../etc/passwd', 'crkbd/rev1', '', 'AAAAAAAA-0000-4000-8000-000000000001']) {
      expect(() => artifactKey(bad), bad).toThrow(ArtifactStoreError);
    }
  });

  it('rejects a malformed key read back from the database', () => {
    for (const bad of [
      'builds/../../etc/passwd',
      `builds/${BUILD_ID}/../../escape`,
      `builds/${BUILD_ID}/firmware/extra`,
      `builds/${BUILD_ID}/keymap.c`,
      `/absolute/${BUILD_ID}/firmware`,
    ]) {
      expect(() => assertValidKey(bad), bad).toThrow(ArtifactStoreError);
    }
  });
});

function contractFor(name: string, make: () => ArtifactStore) {
  describe(name, () => {
    let store: ArtifactStore;
    beforeEach(() => {
      store = make();
    });

    it('stores and returns an object byte for byte', async () => {
      const contents = Buffer.from([0x00, 0xff, 0x10, 0x7f]);
      await store.put({ key: artifactKey(BUILD_ID), contents, contentType: 'application/octet-stream' });
      const read = await store.get(artifactKey(BUILD_ID));
      expect(read).toEqual(contents);
    });

    it('returns null for an absent key rather than throwing', async () => {
      expect(await store.get(logKey(BUILD_ID))).toBeNull();
    });

    it('refuses to overwrite an existing object', async () => {
      const key = artifactKey(BUILD_ID);
      await store.put({ key, contents: Buffer.from('first'), contentType: 'text/plain' });
      await expect(
        store.put({ key, contents: Buffer.from('second'), contentType: 'text/plain' }),
      ).rejects.toThrow(ArtifactStoreError);
      // The original survives: a second writer never silently replaces firmware.
      expect((await store.get(key))?.toString()).toBe('first');
    });

    it('reports whether a delete removed anything', async () => {
      const key = logKey(BUILD_ID);
      await store.put({ key, contents: Buffer.from('log'), contentType: 'text/plain' });
      expect(await store.delete(key)).toBe(true);
      expect(await store.delete(key)).toBe(false);
      expect(await store.get(key)).toBeNull();
    });

    it('rejects a malformed key on every operation', async () => {
      const bad = `builds/${BUILD_ID}/../../../etc/passwd`;
      await expect(store.get(bad)).rejects.toThrow(ArtifactStoreError);
      await expect(store.delete(bad)).rejects.toThrow(ArtifactStoreError);
      await expect(
        store.put({ key: bad, contents: Buffer.alloc(1), contentType: 'text/plain' }),
      ).rejects.toThrow(ArtifactStoreError);
    });
  });
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qwa-artifacts-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

contractFor('InMemoryArtifactStore', () => new InMemoryArtifactStore());
contractFor('FilesystemArtifactStore', () => new FilesystemArtifactStore(root));

describe('FilesystemArtifactStore', () => {
  it('requires an absolute root', () => {
    expect(() => new FilesystemArtifactStore('relative/path')).toThrow(ArtifactStoreError);
  });

  it('does not serve a partially written object', async () => {
    // A `.partial` file left by a crashed writer must not be readable as the artifact.
    const store = new FilesystemArtifactStore(root);
    const key = artifactKey(BUILD_ID);
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(root, 'builds', BUILD_ID), { recursive: true });
    writeFileSync(join(root, 'builds', BUILD_ID, 'firmware.partial'), 'half a file');
    expect(await store.get(key)).toBeNull();
  });

  it('removes a build directory once its objects are reaped', async () => {
    const store = new FilesystemArtifactStore(root);
    await store.put({
      key: artifactKey(BUILD_ID),
      contents: Buffer.from('fw'),
      contentType: 'application/octet-stream',
    });
    await store.removeBuildDirectory(BUILD_ID);
    expect(await store.get(artifactKey(BUILD_ID))).toBeNull();
  });
});
