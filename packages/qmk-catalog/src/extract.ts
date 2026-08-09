/**
 * Runs the extractor inside the pinned build image and returns its raw dump.
 *
 * Discovery is an offline administrative step (ADR 0002), never a request-time
 * operation, and it runs under exactly the same isolation as a firmware build.
 */
import type { BuildSandbox } from '@qmk-web-app/qmk-sandbox';
import { isValidKeyboardIdShape } from '@qmk-web-app/domain';
import { CatalogNormalizationError } from './normalize.ts';

export interface ExtractOptions {
  sandbox: BuildSandbox;
  /** Commit the caller has already verified; the extractor aborts on disagreement. */
  expectedQmkCommit: string;
  /** Restrict to specific keyboards. Empty means the whole tree. */
  keyboards?: readonly string[];
  /** Cap the number of keyboards, for smoke runs. */
  limit?: number;
  timeoutMs?: number;
}

export async function extractCatalog(options: ExtractOptions): Promise<string> {
  const args: string[] = ['--expect-commit', options.expectedQmkCommit];

  for (const keyboard of options.keyboards ?? []) {
    // These become arguments to a process inside the sandbox. They are operator
    // input rather than end-user input, but validate anyway — this is the boundary.
    if (!isValidKeyboardIdShape(keyboard)) {
      throw new CatalogNormalizationError(`refusing to extract invalid keyboard id: ${keyboard}`);
    }
    args.push('--keyboard', keyboard);
  }

  if (options.limit !== undefined) {
    if (!Number.isInteger(options.limit) || options.limit < 0) {
      throw new CatalogNormalizationError(`invalid extraction limit: ${options.limit}`);
    }
    args.push('--limit', String(options.limit));
  }

  const result = await options.sandbox.run({
    verb: 'extract-catalog',
    args,
    limits: {
      // A whole-tree extraction resolves thousands of keyboards.
      timeoutMs: options.timeoutMs ?? 45 * 60 * 1000,
      maxOutputBytes: 512 * 1024 * 1024,
    },
  });

  if (result.outcome !== 'succeeded') {
    throw new CatalogNormalizationError(
      `catalog extraction ${result.outcome}: ${result.stderr.slice(-4000) || result.stdout.slice(-4000)}`,
    );
  }
  if (result.truncated) {
    // Silently losing keyboards would produce a catalog that looks complete.
    throw new CatalogNormalizationError('extractor output was truncated; refusing to build a partial catalog');
  }

  return result.stdout;
}
