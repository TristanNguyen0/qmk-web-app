/**
 * Filesystem-backed artifact store.
 *
 * ADR 0004: development and single-host deployments store artifacts on a directory
 * the API and the worker both mount; S3 arrives behind the same interface when there
 * is more than one host. Nothing above this file knows which is in use.
 *
 * The containment check exists even though keys come from `keys.ts`, because this is
 * the point where a key becomes a real filesystem path — the same reasoning as
 * `qmk-generator/write-workspace.ts`. Defence at the boundary, not at the source.
 */
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { assertValidKey } from './keys.ts';
import { ArtifactStoreError, type ArtifactStore, type PutObjectArgs } from './types.ts';

export class FilesystemArtifactStore implements ArtifactStore {
  readonly #root: string;

  constructor(root: string) {
    if (!isAbsolute(root)) {
      throw new ArtifactStoreError(`artifact store root must be an absolute path`);
    }
    this.#root = resolve(root);
  }

  get root(): string {
    return this.#root;
  }

  #pathFor(key: string): string {
    assertValidKey(key);

    const target = resolve(this.#root, key);
    const rel = relative(this.#root, target);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
      throw new ArtifactStoreError('storage key escapes the artifact store root');
    }
    return target;
  }

  async put(args: PutObjectArgs): Promise<void> {
    const target = this.#pathFor(args.key);
    await mkdir(dirname(target), { recursive: true, mode: 0o750 });

    // Write to a temporary name first, so a reader never observes a half-written
    // firmware image. `wx` makes two writers racing on the same build an error rather
    // than a corrupted file.
    const temporary = `${target}.partial`;
    try {
      await writeFile(temporary, args.contents, { mode: 0o640, flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ArtifactStoreError(`an object is already being written for key ${args.key}`);
      }
      throw error;
    }

    try {
      // `link` rather than `rename`: rename would silently replace an existing object,
      // and an artifact must be written exactly once. link() fails with EEXIST if the
      // target is already there, and is atomic either way.
      //
      // The content type is not stored: every object this application serves is either
      // firmware or a text log, and which one is decided by the artifact record rather
      // than by anything on disk.
      await link(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ArtifactStoreError(`an object already exists for key ${args.key}`);
      }
      throw new ArtifactStoreError(`failed to store object for key ${args.key}`, { cause: error });
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async get(key: string): Promise<Buffer | null> {
    const target = this.#pathFor(key);
    try {
      return await readFile(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<boolean> {
    const target = this.#pathFor(key);
    try {
      await rm(target);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  /** Removes the per-build directory once its objects are gone. Best effort. */
  async removeBuildDirectory(buildId: string): Promise<void> {
    const target = this.#pathFor(`builds/${buildId}/firmware`);
    await rm(join(dirname(target)), { recursive: true, force: true });
  }
}
