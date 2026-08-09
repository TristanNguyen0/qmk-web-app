/**
 * Fetch and verify the pinned QMK source tree.
 *
 * claude.md rule 6: the commit used for discovery and builds is pinned, and every
 * configuration/build records it. This script is the only sanctioned way to
 * materialise that tree. It refuses to leave a checkout in place whose HEAD does
 * not match the manifest, so a wrong tree can never be silently reused.
 *
 * Usage: pnpm qmk:fetch [--submodules]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadManifest, qmkSourcePath } from '../manifest.ts';

const withSubmodules = process.argv.includes('--submodules');

function git(args: string[], cwd?: string): string {
  // Argument array, never a shell string (claude.md § Build isolation).
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function headOf(dir: string): string | null {
  try {
    return git(['rev-parse', 'HEAD'], dir);
  } catch {
    return null;
  }
}

const manifest = loadManifest();
const dest = qmkSourcePath(manifest);

if (existsSync(dest)) {
  const head = headOf(dest);
  if (head === manifest.commit) {
    console.log(`QMK ${manifest.tag} already present and verified at ${dest}`);
  } else {
    console.error(
      `Existing checkout at ${dest} has HEAD ${head ?? '<unreadable>'}, ` +
        `expected ${manifest.commit}. Removing it.`,
    );
    rmSync(dest, { recursive: true, force: true });
  }
}

if (!existsSync(dest)) {
  console.log(`Fetching QMK ${manifest.tag} (${manifest.commit})…`);
  mkdirSync(dirname(dest), { recursive: true });

  // Fetch the exact commit rather than trusting a tag name to stay put.
  git(['init', '--quiet', dest]);
  git(['remote', 'add', 'origin', manifest.upstreamUrl], dest);
  git(['fetch', '--depth', '1', '--no-tags', 'origin', manifest.commit], dest);
  git(['checkout', '--quiet', 'FETCH_HEAD'], dest);
}

const head = headOf(dest);
if (head !== manifest.commit) {
  console.error(`FATAL: checkout HEAD is ${head ?? '<unreadable>'}, expected ${manifest.commit}`);
  process.exit(1);
}

if (withSubmodules) {
  // Submodules (chibios, lufa, …) are only needed to compile, not to discover.
  console.log('Initialising submodules (required for compilation)…');
  git(['submodule', 'update', '--init', '--recursive', '--depth', '1'], dest);
}

console.log(`Verified QMK ${manifest.tag} at ${head}`);
console.log(dest);
