'use client';

/**
 * Build submission, progress, and download.
 *
 * The component asserts nothing about a build itself. Whether a firmware exists,
 * whether it has expired, and why a build failed are all read from the server
 * (claude.md § Recommended project boundaries — the frontend must not "make QMK
 * validity claims without server validation").
 *
 * Two behaviours are deliberate:
 *
 *  - **A build cannot be requested while there are unsaved changes.** A build compiles
 *    a stored revision, so building mid-edit would produce firmware that does not match
 *    what is on screen.
 *  - **The idempotency key is generated once per intent**, not per request. Clicking
 *    Build twice, or retrying after a dropped connection, reaches the same build rather
 *    than queueing a second compile.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiRequestError,
  artifactUrl,
  buildLogUrl,
  cancelBuild,
  fetchBuild,
  fetchBuilds,
  isBuildFinished,
  requestBuild,
  type BuildSummary,
} from '../lib/client.ts';
import { newId } from '../lib/ids.ts';

export interface BuildPanelProps {
  configurationId: string;
  /** True while the editor holds changes the server has not accepted yet. */
  dirty: boolean;
  /** True while the configuration has nothing bound and so cannot be built. */
  isDraft: boolean;
}

/** How often an in-flight build is re-read. Fast enough to feel live, slow enough to be cheap. */
const POLL_INTERVAL_MS = 1500;

const STATUS_TEXT: Record<BuildSummary['status'], string> = {
  queued: 'Queued',
  preparing: 'Preparing',
  building: 'Compiling',
  uploading: 'Storing firmware',
  succeeded: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/**
 * Plain-language explanations of the server's failure codes. The code is shown too:
 * it is the stable thing to quote in a bug report.
 */
const FAILURE_TEXT: Record<string, string> = {
  COMPILE_FAILED: 'QMK could not compile this configuration.',
  TIMEOUT: 'The build ran out of time.',
  RESOURCE_LIMIT: 'The build exceeded its memory or CPU allowance.',
  GENERATION_FAILED: 'This configuration could not be turned into a QMK keymap.',
  ARTIFACT_NOT_PRODUCED: 'The build finished but produced no firmware.',
  ARTIFACT_REJECTED: 'The build produced output we could not verify, so it was discarded.',
  SANDBOX_ERROR: 'The build environment failed. Trying again usually helps.',
  CANCELLED: 'You cancelled this build.',
};

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}

export function BuildPanel({ configurationId, dirty, isDraft }: BuildPanelProps) {
  const [current, setCurrent] = useState<BuildSummary | null>(null);
  const [history, setHistory] = useState<BuildSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Stable across retries of one intent; replaced only once a build has been accepted.
  const idempotencyKey = useRef<string>(newId());

  const loadHistory = useCallback(async () => {
    try {
      const items = await fetchBuilds(configurationId);
      setHistory(items);
      // Adopt the newest build as "current" on mount, so a reload during a compile
      // resumes showing it rather than looking like nothing ever happened.
      setCurrent((existing) => existing ?? items[0] ?? null);
    } catch {
      // A failed history read is not worth an error banner; the build button still works.
    }
  }, [configurationId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Poll while a build is in flight.
  useEffect(() => {
    if (!current || isBuildFinished(current.status)) return;

    let cancelled = false;
    const timer = setInterval(() => {
      void fetchBuild(current.id)
        .then((build) => {
          if (cancelled) return;
          setCurrent(build);
          if (isBuildFinished(build.status)) void loadHistory();
        })
        .catch(() => {
          // Transient; the next tick tries again. Clients must tolerate this
          // (claude.md § API/interface expectations).
        });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [current, loadHistory]);

  async function onBuild() {
    setSubmitting(true);
    setError(null);
    try {
      const build = await requestBuild(configurationId, idempotencyKey.current);
      // Accepted: the next build is a new intent and needs its own key.
      idempotencyKey.current = newId();
      setCurrent(build);
      void loadHistory();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : 'could not reach the server',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function onCancel(buildId: string) {
    try {
      const build = await cancelBuild(buildId);
      if (build) setCurrent(build);
      void loadHistory();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'could not cancel the build');
    }
  }

  const blockedReason = isDraft
    ? 'Bind at least one key before building.'
    : dirty
      ? 'Waiting for your changes to save…'
      : null;

  return (
    <section className="build-panel" aria-labelledby="build-heading">
      <h2 id="build-heading">Firmware</h2>

      <div className="build-panel__actions">
        <button type="button" onClick={() => void onBuild()} disabled={submitting || blockedReason !== null}>
          {submitting ? 'Requesting…' : 'Build firmware'}
        </button>
        {blockedReason ? <span className="muted">{blockedReason}</span> : null}
      </div>

      {error ? (
        <div className="notice" role="alert">
          <strong>Build not started.</strong> <span>{error}</span>
        </div>
      ) : null}

      {current ? <CurrentBuild build={current} onCancel={onCancel} /> : null}

      {history.length > 1 ? (
        <details className="build-panel__history">
          <summary>Earlier builds ({history.length - 1})</summary>
          <ul>
            {history
              .filter((build) => build.id !== current?.id)
              .map((build) => (
                <li key={build.id}>
                  <span className={`build-status build-status--${build.status}`}>
                    {STATUS_TEXT[build.status]}
                  </span>{' '}
                  <span className="muted">
                    revision {build.configurationRevision} ·{' '}
                    {new Date(build.requestedAt).toLocaleString()}
                  </span>{' '}
                  {build.artifact ? (
                    <a href={artifactUrl(build.id)} download>
                      Download
                    </a>
                  ) : null}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function CurrentBuild({
  build,
  onCancel,
}: {
  build: BuildSummary;
  onCancel: (buildId: string) => Promise<void>;
}) {
  const finished = isBuildFinished(build.status);
  const cancellable = build.status === 'queued' || build.status === 'preparing' || build.status === 'building';

  return (
    <div className="build-current">
      {/* aria-live so progress is announced, not only shown. */}
      <p aria-live="polite">
        <span className={`build-status build-status--${build.status}`}>
          {STATUS_TEXT[build.status]}
        </span>{' '}
        <span className="muted">
          revision {build.configurationRevision}
          {build.attemptCount > 1 ? ` · attempt ${build.attemptCount}` : ''}
        </span>
        {cancellable ? (
          <>
            {' '}
            <button type="button" onClick={() => void onCancel(build.id)}>
              Cancel
            </button>
          </>
        ) : null}
      </p>

      {build.status === 'succeeded' && build.artifact ? (
        <div className="build-current__artifact">
          <a className="button" href={artifactUrl(build.id)} download>
            Download {build.artifact.filename}
          </a>
          <p className="muted">
            {formatBytes(build.artifact.byteSize)} · expires{' '}
            {new Date(build.artifact.expiresAt).toLocaleDateString()}
          </p>
          {/* Shown in full so it can be compared against the downloaded file. */}
          <p className="muted build-current__checksum">
            SHA-256 <code>{build.artifact.sha256}</code>
          </p>
          <p className="muted">
            Built from QMK <code>{build.qmkCommit.slice(0, 12)}</code>, catalog{' '}
            <code>{build.catalogVersion}</code>. Flashing is your responsibility — check that this
            firmware is for your exact keyboard revision.
          </p>
        </div>
      ) : null}

      {build.status === 'failed' ? (
        <div className="notice" role="alert">
          <strong>{FAILURE_TEXT[build.failureCode ?? ''] ?? 'This build did not finish.'}</strong>
          <p className="muted">
            Code <code>{build.failureCode ?? 'UNKNOWN'}</code>
          </p>
          <p>
            <a href={buildLogUrl(build.id)} download>
              Download the build log
            </a>
          </p>
        </div>
      ) : null}

      {build.status === 'expired' ? (
        <p className="notice">
          This build’s firmware has expired and been deleted. Build again to get a fresh one.
        </p>
      ) : null}

      {!finished ? (
        <p className="muted">
          Compiling takes a minute or two. You can keep editing — this build compiles revision{' '}
          {build.configurationRevision}, not your unsaved changes.
        </p>
      ) : null}
    </div>
  );
}
