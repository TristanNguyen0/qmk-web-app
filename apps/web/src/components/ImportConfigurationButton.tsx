'use client';

/**
 * Imports a previously exported configuration file as a NEW configuration (phase 5
 * D-03).
 *
 * This is explicitly not a new trust boundary: the parsed document goes through
 * `createConfiguration()` — the same `POST /v1/configurations`, the same `asInput`
 * field allowlist, and the same `validateConfiguration` call every other write takes.
 * No new endpoint is added.
 *
 * Import always creates. There is no code path here that calls `updateConfiguration`
 * or takes an existing configuration id — importing a file must never replace
 * something the user already has, because a file and a saved configuration have no
 * identity relationship the user could reason about.
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DomainError, parseConfigurationFile } from '@qmk-web-app/domain';
import { ApiRequestError, createConfiguration } from '../lib/client.ts';

/**
 * Matches the API's `bodyLimit` (1 MiB). Reading a larger file into the browser
 * before rejecting it would hang the tab to earn the same rejection the server would
 * give anyway, so the check runs before `file.text()`.
 */
const MAX_IMPORT_BYTES = 1024 * 1024;

export function ImportConfigurationButton() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      if (file.size > MAX_IMPORT_BYTES) {
        setError(
          `this file is too large to import (${file.size} bytes; the limit is ${MAX_IMPORT_BYTES} bytes)`,
        );
        return;
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(await file.text());
      } catch {
        setError('this file is not valid JSON');
        return;
      }

      const document = parseConfigurationFile(parsedJson);
      const created = await createConfiguration(document);
      router.push(`/configurations/${created.id}`);
    } catch (caught) {
      if (caught instanceof DomainError) {
        setError(caught.message);
        return;
      }
      if (caught instanceof ApiRequestError) {
        setError(caught.message);
        return;
      }
      setError('could not reach the server');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="import-config">
      <label className="visually-hidden" htmlFor="import-config-file">
        Import a configuration file
      </label>
      <input
        id="import-config-file"
        ref={inputRef}
        type="file"
        accept="application/json"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {error ? (
        <p className="notice" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
