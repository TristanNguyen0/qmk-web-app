/**
 * Materialises generated files into a build workspace.
 *
 * claude.md § Build isolation: "resolve paths against a fixed workspace root; reject
 * traversal, separators, NULs". Containment is re-verified here at write time even
 * though the paths were constructed from validated parts, because this is the single
 * point where a path becomes a real filesystem write.
 */
import { lstatSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ALLOWED_GENERATED_FILES, GenerationError, type GenerationResult } from './generate.ts';

export interface BuildWorkspaceLayout {
  root: string;
  userspaceDir: string;
  buildDir: string;
  homeDir: string;
  tmpDir: string;
  qmkRootDir: string;
}

/**
 * Creates the fixed directory layout a build container expects (ADR 0003).
 * Directories are created by the worker rather than the container so the container
 * never needs permission to create anything at the workspace root.
 */
export function createWorkspaceLayout(root: string): BuildWorkspaceLayout {
  if (!isAbsolute(root)) {
    throw new GenerationError(`workspace root must be absolute: ${root}`);
  }
  const layout: BuildWorkspaceLayout = {
    root,
    userspaceDir: join(root, 'userspace'),
    buildDir: join(root, 'build'),
    homeDir: join(root, 'home'),
    tmpDir: join(root, 'tmp'),
    qmkRootDir: join(root, 'qmkroot'),
  };
  for (const dir of Object.values(layout)) {
    mkdirSync(dir, { recursive: true, mode: 0o750 });
  }
  return layout;
}

/**
 * Resolves a generated file's relative path inside the userspace root, refusing
 * anything that escapes it.
 */
function resolveContained(userspaceDir: string, relativePath: string): string {
  if (relativePath.includes('\0')) {
    throw new GenerationError('generated path contains a NUL byte');
  }
  if (isAbsolute(relativePath)) {
    throw new GenerationError(`generated path must be relative: ${relativePath}`);
  }

  const realRoot = realpathSync(userspaceDir);
  const target = resolve(realRoot, relativePath);
  const rel = relative(realRoot, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new GenerationError(`generated path escapes the userspace root: ${relativePath}`);
  }

  const segments = rel.split(sep);
  for (const segment of segments) {
    if (segment === '..' || segment === '.' || segment === '') {
      throw new GenerationError(`generated path contains a traversal segment: ${relativePath}`);
    }
  }

  // Textual containment is not enough: `resolve` does not follow symlinks in
  // intermediate components, so `userspace/keyboards/evil/x` would still escape if
  // `evil` were a symlink to somewhere else. The workspace is created fresh by this
  // process and legitimately contains no symlinks at all, so any symlink along the
  // path is treated as hostile rather than followed.
  let current = realRoot;
  for (const segment of segments) {
    current = join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      // Does not exist yet; it will be created as a plain directory or file.
      continue;
    }
    if (stat.isSymbolicLink()) {
      throw new GenerationError(
        `generated path traverses a symlink, which a build workspace must not contain: ${relativePath}`,
      );
    }
  }

  return target;
}

export function writeGeneratedFiles(
  layout: BuildWorkspaceLayout,
  result: GenerationResult,
): string[] {
  const allowed = new Set<string>(ALLOWED_GENERATED_FILES);
  const written: string[] = [];

  for (const file of result.files) {
    const basename = file.path.split('/').at(-1);
    if (!basename || !allowed.has(basename)) {
      throw new GenerationError(
        `refusing to write ${file.path}: only ${[...allowed].join(', ')} may be generated`,
      );
    }
    const target = resolveContained(layout.userspaceDir, file.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o750 });
    // `wx` fails if the file already exists: a build workspace is fresh, so an
    // existing file means something unexpected is present and must not be overwritten.
    writeFileSync(target, file.contents, { encoding: 'utf8', mode: 0o640, flag: 'wx' });
    written.push(target);
  }

  return written;
}
