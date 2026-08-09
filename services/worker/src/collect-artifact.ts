/**
 * Artifact identification.
 *
 * claude.md § Deterministic generation, step 7: "Worker identifies the artifact only
 * from the expected build output manifest/known location; reject unexpected files and
 * cap file size."
 *
 * The rule is implemented as: compute the one filename QMK must have produced, accept
 * only that file, and fail the build if the workspace contains anything else that
 * looks like firmware. A build that produces a surprise file is a build we do not
 * understand, and an artifact we do not understand must never reach a user's keyboard.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Output formats QMK produces at the pinned revision that we are willing to serve. */
export const ACCEPTED_FIRMWARE_EXTENSIONS = Object.freeze(['hex', 'bin', 'uf2'] as const);

export type FirmwareExtension = (typeof ACCEPTED_FIRMWARE_EXTENSIONS)[number];

/** Refuse anything larger; real QMK firmware is far smaller than this. */
export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

export class ArtifactError extends Error {
  readonly code: 'ARTIFACT_NOT_PRODUCED' | 'ARTIFACT_REJECTED';
  constructor(code: ArtifactError['code'], message: string) {
    super(message);
    this.name = 'ArtifactError';
    this.code = code;
  }
}

export interface CollectedArtifact {
  path: string;
  filename: string;
  extension: FirmwareExtension;
  byteSize: number;
  sha256: string;
  contentType: string;
  contents: Buffer;
}

/**
 * QMK's make TARGET for a keyboard/keymap pair: the keyboard id with separators
 * replaced by underscores, then the keymap name.
 */
export function expectedTargetName(keyboardId: string, keymapName: string): string {
  return `${keyboardId.replace(/\//g, '_')}_${keymapName}`;
}

const CONTENT_TYPES: Readonly<Record<FirmwareExtension, string>> = Object.freeze({
  hex: 'application/octet-stream',
  bin: 'application/octet-stream',
  uf2: 'application/octet-stream',
});

export function collectArtifact(
  userspaceDir: string,
  keyboardId: string,
  keymapName: string,
): CollectedArtifact {
  const target = expectedTargetName(keyboardId, keymapName);
  const expected = new Map<string, FirmwareExtension>(
    ACCEPTED_FIRMWARE_EXTENSIONS.map((ext) => [`${target}.${ext}`, ext]),
  );

  // Only the userspace root is inspected — never a recursive walk of the workspace,
  // which also contains build intermediates.
  const entries = readdirSync(userspaceDir, { withFileTypes: true });

  const found: { filename: string; extension: FirmwareExtension }[] = [];
  const unexpected: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = expected.get(entry.name);
    if (extension) {
      found.push({ filename: entry.name, extension });
      continue;
    }
    // qmk.json is ours. Anything else with a firmware extension is a surprise.
    if (entry.name === 'qmk.json') continue;
    if (ACCEPTED_FIRMWARE_EXTENSIONS.some((ext) => entry.name.endsWith(`.${ext}`))) {
      unexpected.push(entry.name);
    }
  }

  if (unexpected.length > 0) {
    throw new ArtifactError(
      'ARTIFACT_REJECTED',
      `build produced unexpected firmware files: ${unexpected.sort().join(', ')}`,
    );
  }
  if (found.length === 0) {
    throw new ArtifactError(
      'ARTIFACT_NOT_PRODUCED',
      `no firmware named ${target}.{${ACCEPTED_FIRMWARE_EXTENSIONS.join(',')}} was produced`,
    );
  }
  if (found.length > 1) {
    throw new ArtifactError(
      'ARTIFACT_REJECTED',
      `build produced multiple firmware files: ${found.map((f) => f.filename).sort().join(', ')}`,
    );
  }

  const artifact = found[0] as { filename: string; extension: FirmwareExtension };
  const path = join(userspaceDir, artifact.filename);

  const stat = statSync(path);
  if (stat.size === 0) {
    throw new ArtifactError('ARTIFACT_REJECTED', 'firmware file is empty');
  }
  if (stat.size > MAX_ARTIFACT_BYTES) {
    throw new ArtifactError(
      'ARTIFACT_REJECTED',
      `firmware file is ${stat.size} bytes, over the ${MAX_ARTIFACT_BYTES} byte cap`,
    );
  }

  const contents = readFileSync(path);
  const sha256 = createHash('sha256').update(contents).digest('hex');

  return {
    path,
    filename: artifact.filename,
    extension: artifact.extension,
    byteSize: contents.byteLength,
    sha256,
    contentType: CONTENT_TYPES[artifact.extension],
    contents,
  };
}
