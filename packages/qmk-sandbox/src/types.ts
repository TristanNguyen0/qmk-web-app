/**
 * The sandbox contract. Catalog extraction and firmware compilation both run
 * through this interface so there is exactly one place where isolation policy is
 * expressed (claude.md § Build isolation).
 *
 * ADR 0001: the Docker implementation sits behind this interface so a microVM
 * backend can replace it without touching the generator or the worker's logic.
 */

/** Verbs accepted by the build image entrypoint. Not user-controllable. */
export type SandboxVerb = 'extract-catalog' | 'compile' | 'verify-env';

export interface SandboxMount {
  /** Absolute host path. Must already exist. */
  hostPath: string;
  /** Absolute path inside the container. */
  containerPath: string;
  readonly: boolean;
}

export interface SandboxLimits {
  /** Wall-clock limit for the whole run. */
  timeoutMs: number;
  /** e.g. '2g'. Passed to the container runtime verbatim. */
  memory: string;
  /** Fractional CPUs, e.g. 2. */
  cpus: number;
  /** Max process count inside the container. */
  pids: number;
  /** Bytes of stdout+stderr retained. Output beyond this is dropped, not buffered. */
  maxOutputBytes: number;
}

export interface SandboxRunRequest {
  verb: SandboxVerb;
  /**
   * Arguments after the verb, passed as an argument vector. Never a shell string,
   * never interpolated (claude.md § Build isolation: "Avoid shell evaluation
   * entirely"). Each entry is validated before use.
   */
  args: readonly string[];
  /** Extra mounts beyond the read-only QMK source. */
  mounts?: readonly SandboxMount[];
  /** tmpfs paths created writable inside the container, with a size cap. */
  tmpfs?: readonly { path: string; sizeMb: number }[];
  limits?: Partial<SandboxLimits>;
}

export type SandboxOutcome =
  | 'succeeded'
  /** Non-zero exit from the sandboxed process. */
  | 'failed'
  /** Killed for exceeding the wall-clock limit. */
  | 'timed_out'
  /** Killed by the OOM killer or another resource limit. */
  | 'resource_limit'
  /** The sandbox could not be started at all. */
  | 'sandbox_error';

export interface SandboxRunResult {
  outcome: SandboxOutcome;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** True when output hit `maxOutputBytes` and was truncated. */
  truncated: boolean;
  durationMs: number;
  /** Image reference actually used, recorded with every build (claude.md § Build isolation). */
  imageRef: string;
  /** Resolved image digest when the runtime can report one. */
  imageDigest: string | null;
}

export interface BuildSandbox {
  run(request: SandboxRunRequest): Promise<SandboxRunResult>;
  /** Asserts the image and pinned source are usable. Throws with a diagnosis if not. */
  verify(): Promise<void>;
}
