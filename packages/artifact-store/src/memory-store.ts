/**
 * In-memory artifact store for tests.
 *
 * Applies the same key validation as the filesystem store, so a test that would have
 * written a malformed key still fails here.
 */
import { assertValidKey } from './keys.ts';
import { ArtifactStoreError, type ArtifactStore, type PutObjectArgs } from './types.ts';

export class InMemoryArtifactStore implements ArtifactStore {
  readonly #objects = new Map<string, Buffer>();

  async put(args: PutObjectArgs): Promise<void> {
    assertValidKey(args.key);
    if (this.#objects.has(args.key)) {
      throw new ArtifactStoreError(`an object already exists for key ${args.key}`);
    }
    this.#objects.set(args.key, Buffer.from(args.contents));
  }

  async get(key: string): Promise<Buffer | null> {
    assertValidKey(key);
    const found = this.#objects.get(key);
    return found ? Buffer.from(found) : null;
  }

  async delete(key: string): Promise<boolean> {
    assertValidKey(key);
    return this.#objects.delete(key);
  }

  get size(): number {
    return this.#objects.size;
  }
}
