/**
 * The build runner: validated configuration in, checksummed firmware artifact out.
 *
 * Implements claude.md § Deterministic generation and build workflow, steps 4–10.
 * Ordering matters and is deliberate:
 *
 *   4. verify the pinned source, create an ephemeral workspace
 *   5. generate ONLY allowlisted files into an application-owned keymap directory
 *   6. compile through an argument vector, never a shell string
 *   7. identify the artifact from the one expected location, rejecting surprises
 *   8. checksum it and hand it back with sanitized logs
 *  10. remove the workspace regardless of outcome
 *
 * This module does no I/O to the database or object store: it is handed a validated
 * configuration and returns a result. That keeps the build worker free of broad
 * application credentials (claude.md § Recommended project boundaries).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuildFailureCode, Configuration, SupportedCatalogKeyboard } from '@qmk-web-app/domain';
import { generatedKeymapName } from '@qmk-web-app/domain';
import {
  createWorkspaceLayout,
  generateKeymap,
  GenerationError,
  writeGeneratedFiles,
} from '@qmk-web-app/qmk-generator';
import type { BuildSandbox, SandboxLimits } from '@qmk-web-app/qmk-sandbox';
import { SocdModuleError, materializeSocdModule } from '@qmk-web-app/qmk-socd-module';
import { ArtifactError, collectArtifact, type CollectedArtifact } from './collect-artifact.ts';
import { redactLog } from './redact.ts';

export interface RunBuildOptions {
  buildId: string;
  configuration: Configuration;
  keyboard: SupportedCatalogKeyboard;
  sandbox: BuildSandbox;
  /** Where per-build workspaces are created. Defaults to the OS temp directory. */
  workspaceRoot?: string;
  /** Host paths to strip from user-visible logs. */
  redactPaths?: readonly string[];
  limits?: Partial<SandboxLimits>;
}

export type RunBuildResult =
  | {
      status: 'succeeded';
      artifact: CollectedArtifact;
      log: string;
      durationMs: number;
      imageRef: string;
      imageDigest: string | null;
      generatorVersion: string;
    }
  | {
      status: 'failed';
      failureCode: BuildFailureCode;
      log: string;
      durationMs: number;
      imageRef: string;
      imageDigest: string | null;
      generatorVersion: string | null;
    };

export async function runBuild(options: RunBuildOptions): Promise<RunBuildResult> {
  const { buildId, configuration, keyboard, sandbox } = options;
  const startedAt = Date.now();

  // The keymap directory name is derived from the build id and never from user text
  // (claude.md § Deterministic generation, step 5). Deriving it here as well means a
  // mismatch with the generator is impossible to miss.
  const keymapName = generatedKeymapName(buildId);

  const workspaceRoot = mkdtempSync(join(options.workspaceRoot ?? tmpdir(), 'qwa-build-'));

  try {
    const layout = createWorkspaceLayout(workspaceRoot);

    let generation;
    try {
      generation = generateKeymap({ configuration, keyboard, buildId });
      writeGeneratedFiles(layout, generation);
      if (generation.requiresSocdModule) {
        // Static, digest-verified first-party source — not generated output, which is
        // why it goes in through its own package rather than the generated-file
        // allowlist (docs/adr/0005).
        materializeSocdModule(layout.userspaceDir);
      }
    } catch (error) {
      if (error instanceof GenerationError || error instanceof SocdModuleError) {
        return {
          status: 'failed',
          failureCode: 'GENERATION_FAILED',
          log: redactLog(error.message, { extraPaths: options.redactPaths ?? [] }),
          durationMs: Date.now() - startedAt,
          imageRef: '',
          imageDigest: null,
          generatorVersion: null,
        };
      }
      throw error;
    }

    if (generation.keymapName !== keymapName) {
      throw new Error('generator and worker disagree on the generated keymap name');
    }

    const run = await sandbox.run({
      verb: 'compile',
      // Argument vector. Both values are derived from validated catalog data and the
      // build id — no user-supplied string reaches this array.
      args: [
        '-kb',
        generation.compileTarget.keyboard,
        '-km',
        generation.compileTarget.keymap,
        '-j',
        '4',
      ],
      mounts: [{ hostPath: workspaceRoot, containerPath: '/workspace', readonly: false }],
      // /workspace is a bind mount here, so no tmpfs may claim the same path.
      tmpfs: [],
      ...(options.limits ? { limits: options.limits } : {}),
    });

    const log = redactLog(`${run.stdout}\n${run.stderr}`, {
      extraPaths: [workspaceRoot, ...(options.redactPaths ?? [])],
    });

    if (run.outcome !== 'succeeded') {
      const failureCode: BuildFailureCode =
        run.outcome === 'timed_out'
          ? 'TIMEOUT'
          : run.outcome === 'resource_limit'
            ? 'RESOURCE_LIMIT'
            : run.outcome === 'sandbox_error'
              ? 'SANDBOX_ERROR'
              : 'COMPILE_FAILED';
      return {
        status: 'failed',
        failureCode,
        log,
        durationMs: Date.now() - startedAt,
        imageRef: run.imageRef,
        imageDigest: run.imageDigest,
        generatorVersion: generation.generatorVersion,
      };
    }

    let artifact: CollectedArtifact;
    try {
      artifact = collectArtifact(layout.userspaceDir, keyboard.keyboardId, keymapName);
    } catch (error) {
      if (error instanceof ArtifactError) {
        return {
          status: 'failed',
          failureCode: error.code,
          log,
          durationMs: Date.now() - startedAt,
          imageRef: run.imageRef,
          imageDigest: run.imageDigest,
          generatorVersion: generation.generatorVersion,
        };
      }
      throw error;
    }

    return {
      status: 'succeeded',
      artifact,
      log,
      durationMs: Date.now() - startedAt,
      imageRef: run.imageRef,
      imageDigest: run.imageDigest,
      generatorVersion: generation.generatorVersion,
    };
  } finally {
    // Step 10: cleanup happens regardless of outcome, including on a thrown error.
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}
