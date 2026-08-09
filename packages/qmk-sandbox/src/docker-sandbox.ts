import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import type {
  BuildSandbox,
  SandboxLimits,
  SandboxMount,
  SandboxRunRequest,
  SandboxRunResult,
} from './types.ts';

/**
 * Docker-backed sandbox.
 *
 * Every flag here maps to a specific requirement in claude.md § Build isolation:
 *
 *   --network=none            no network access in workers
 *   --read-only               container root filesystem is immutable
 *   -v <qmk>:/qmk:ro          QMK base source mounted read-only
 *   --tmpfs /workspace        separate temporary writable workspace
 *   --user <uid>:<gid>        unprivileged user
 *   --cap-drop=ALL            drop Linux capabilities
 *   --security-opt …          no privilege escalation
 *   --memory/--cpus/--pids-limit + wall clock   resource limits
 *   --rm                      ephemeral workspace removed regardless of outcome
 */

export const DEFAULT_LIMITS: SandboxLimits = {
  timeoutMs: 10 * 60 * 1000,
  memory: '2g',
  cpus: 2,
  pids: 512,
  maxOutputBytes: 4 * 1024 * 1024,
};

export interface DockerSandboxOptions {
  imageRef: string;
  /** Absolute path of the verified pinned QMK checkout. */
  qmkSourcePath: string;
  uid?: number;
  gid?: number;
  limits?: Partial<SandboxLimits>;
  dockerBinary?: string;
}

/**
 * Container paths are part of our own configuration, never user input, but they are
 * still validated so a future caller cannot smuggle an option-looking value into the
 * docker argument vector.
 */
function assertSafeContainerPath(p: string, label: string): void {
  if (!isAbsolute(p) || normalize(p) !== p) {
    throw new Error(`${label} must be a normalised absolute path, got ${JSON.stringify(p)}`);
  }
  if (p.includes(':') || p.includes(',') || p.includes('\0')) {
    throw new Error(`${label} contains a character that is unsafe in a docker mount spec`);
  }
}

function assertSafeHostPath(p: string, label: string): void {
  if (!isAbsolute(p) || normalize(p) !== p) {
    throw new Error(`${label} must be a normalised absolute path, got ${JSON.stringify(p)}`);
  }
  if (p.includes(':') || p.includes(',') || p.includes('\0')) {
    throw new Error(`${label} contains a character that is unsafe in a docker mount spec`);
  }
  let st;
  try {
    st = statSync(p);
  } catch {
    throw new Error(`${label} does not exist on the host: ${p}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`${label} is not a directory: ${p}`);
  }
}

/**
 * Arguments are passed to the container as a vector, but a value beginning with `-`
 * would still be parsed as a flag by the program inside. Reject control characters
 * and NULs outright; callers construct these from validated identifiers only.
 */
function assertSafeArg(arg: string, index: number): void {
  for (let i = 0; i < arg.length; i += 1) {
    const code = arg.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new Error(`sandbox arg ${index} contains a control character at offset ${i}`);
    }
  }
}

export class DockerSandbox implements BuildSandbox {
  readonly #imageRef: string;
  readonly #qmkSourcePath: string;
  readonly #uid: number;
  readonly #gid: number;
  readonly #limits: SandboxLimits;
  readonly #docker: string;
  #cachedDigest: string | null | undefined;

  constructor(options: DockerSandboxOptions) {
    assertSafeHostPath(options.qmkSourcePath, 'qmkSourcePath');
    this.#imageRef = options.imageRef;
    this.#qmkSourcePath = options.qmkSourcePath;
    // The container writes into a host-backed workspace directory, so it must run as
    // a uid that can write it. Defaulting to the worker's own uid means artifacts
    // come back owned by the worker and the workspace never needs loose permissions.
    // Still unprivileged — the worker itself must never run as root.
    this.#uid = options.uid ?? process.getuid?.() ?? 2000;
    this.#gid = options.gid ?? process.getgid?.() ?? 2000;
    this.#limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.#docker = options.dockerBinary ?? 'docker';
  }

  async verify(): Promise<void> {
    const result = await this.run({ verb: 'verify-env', args: [] });
    if (result.outcome !== 'succeeded') {
      throw new Error(
        `build sandbox verification failed (${result.outcome}): ${result.stderr || result.stdout}`,
      );
    }
    const parsed: unknown = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}');
    const ok = (parsed as { ok?: unknown }).ok;
    if (ok !== true) {
      throw new Error(`build sandbox environment checks failed: ${result.stdout}`);
    }
  }

  async run(request: SandboxRunRequest): Promise<SandboxRunResult> {
    const limits: SandboxLimits = { ...this.#limits, ...request.limits };
    const args = this.#dockerArgs(request, limits);
    const startedAt = Date.now();
    const imageDigest = await this.#imageDigest();

    return await new Promise<SandboxRunResult>((resolve) => {
      const child = spawn(this.#docker, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        // No shell, ever.
        shell: false,
      });

      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let outBytes = 0;
      let errBytes = 0;
      let truncated = false;
      let timedOut = false;

      // Cap retained output rather than buffering an unbounded compiler log
      // (claude.md § Build isolation: "Cap logs and artifacts").
      const collect = (sink: Buffer[], chunk: Buffer, current: number): number => {
        const remaining = limits.maxOutputBytes - current;
        if (remaining <= 0) {
          truncated = true;
          return current;
        }
        if (chunk.length > remaining) {
          sink.push(chunk.subarray(0, remaining));
          truncated = true;
          return limits.maxOutputBytes;
        }
        sink.push(chunk);
        return current + chunk.length;
      };

      child.stdout.on('data', (c: Buffer) => {
        outBytes = collect(out, c, outBytes);
      });
      child.stderr.on('data', (c: Buffer) => {
        errBytes = collect(err, c, errBytes);
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, limits.timeoutMs);

      const finish = (exitCode: number | null, spawnError?: Error): void => {
        clearTimeout(timer);
        const stdout = Buffer.concat(out).toString('utf8');
        const stderr = spawnError
          ? `${Buffer.concat(err).toString('utf8')}\n${spawnError.message}`
          : Buffer.concat(err).toString('utf8');

        let outcome: SandboxRunResult['outcome'];
        if (spawnError) outcome = 'sandbox_error';
        else if (timedOut) outcome = 'timed_out';
        else if (exitCode === 0) outcome = 'succeeded';
        // 137 = SIGKILL, which docker reports for OOM kills.
        else if (exitCode === 137) outcome = 'resource_limit';
        else outcome = 'failed';

        resolve({
          outcome,
          exitCode,
          stdout,
          stderr,
          truncated,
          durationMs: Date.now() - startedAt,
          imageRef: this.#imageRef,
          imageDigest,
        });
      };

      child.on('error', (e: Error) => finish(null, e));
      child.on('close', (code) => finish(code));
    });
  }

  #dockerArgs(request: SandboxRunRequest, limits: SandboxLimits): string[] {
    const args = [
      'run',
      '--rm',
      '--network=none',
      '--read-only',
      `--user=${this.#uid}:${this.#gid}`,
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      `--memory=${limits.memory}`,
      // Disabling swap prevents evading the memory cap.
      `--memory-swap=${limits.memory}`,
      `--cpus=${limits.cpus}`,
      `--pids-limit=${limits.pids}`,
      // HOME and TMPDIR must land inside the writable workspace; with a read-only
      // root filesystem the image's defaults are not writable, and gcc silently
      // falls back to the working directory for temporaries.
      // These are the ONLY environment variables the container receives: no
      // credentials, no signed URLs, no host paths (claude.md § Build isolation,
      // "Keep secrets out of build jobs").
      '--env=HOME=/workspace/home',
      '--env=TMPDIR=/workspace/tmp',
    ];

    const mounts: SandboxMount[] = [
      { hostPath: this.#qmkSourcePath, containerPath: '/qmk', readonly: true },
      ...(request.mounts ?? []),
    ];
    for (const m of mounts) {
      assertSafeHostPath(m.hostPath, 'mount.hostPath');
      assertSafeContainerPath(m.containerPath, 'mount.containerPath');
      args.push(`--volume=${m.hostPath}:${m.containerPath}:${m.readonly ? 'ro' : 'rw'}`);
    }

    // Default to an in-memory workspace. Compilation overrides this with a
    // host-backed bind mount, because the artifact has to survive the container.
    const tmpfs = request.tmpfs ?? [{ path: '/workspace', sizeMb: 256 }];
    const mountTargets = new Set(mounts.map((m) => m.containerPath));
    for (const t of tmpfs) {
      assertSafeContainerPath(t.path, 'tmpfs.path');
      if (mountTargets.has(t.path)) {
        throw new Error(`tmpfs ${t.path} collides with a bind mount at the same path`);
      }
      if (!Number.isInteger(t.sizeMb) || t.sizeMb <= 0 || t.sizeMb > 8192) {
        throw new Error(`tmpfs size for ${t.path} out of range: ${t.sizeMb}`);
      }
      // A tmpfs is created owned by root, which the unprivileged build user cannot
      // write. uid/gid make it writable by exactly that user and no one else.
      args.push(
        `--tmpfs=${t.path}:rw,nosuid,size=${t.sizeMb}m,mode=0700,uid=${this.#uid},gid=${this.#gid}`,
      );
    }

    args.push(this.#imageRef, request.verb);
    request.args.forEach((a, i) => {
      assertSafeArg(a, i);
      args.push(a);
    });
    return args;
  }

  async #imageDigest(): Promise<string | null> {
    if (this.#cachedDigest !== undefined) return this.#cachedDigest;
    this.#cachedDigest = await new Promise<string | null>((resolve) => {
      const child = spawn(
        this.#docker,
        ['image', 'inspect', '--format={{index .RepoDigests 0}}', this.#imageRef],
        { stdio: ['ignore', 'pipe', 'ignore'], shell: false },
      );
      let buf = '';
      child.stdout.on('data', (c: Buffer) => {
        buf += c.toString('utf8');
      });
      child.on('error', () => resolve(null));
      child.on('close', (code) => resolve(code === 0 && buf.trim() ? buf.trim() : null));
    });
    return this.#cachedDigest;
  }
}
