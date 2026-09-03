'use client';

/**
 * Downloads the currently loaded configuration as a versioned JSON file (phase 5
 * D-03, the escape hatch the data-loss notice points at).
 *
 * No new endpoint and no new dependency: the editor page has already loaded every
 * field the envelope needs, `toConfigurationFile` builds it, and the download uses
 * only `URL.createObjectURL` plus a synthetic anchor click — both already-available
 * browser APIs.
 */
import { toConfigurationFile, type ConfigurationFileDocument } from '@qmk-web-app/domain';
import type { ConfigurationResponse } from '../lib/client.ts';

export interface ExportConfigurationButtonProps {
  configuration: ConfigurationResponse;
}

/**
 * The same conservative character class `SAFE_FILENAME_RE` in
 * `apps/api/src/routes/builds.ts` uses for artifact filenames — applied here to a
 * user-chosen configuration name rather than a generator-produced one, so it must
 * strip rather than merely validate.
 */
const UNSAFE_FILENAME_CHARS = /[^A-Za-z0-9._-]+/g;

/** Exported for the unit test — filename derivation has no DOM dependency. */
export function filenameFor(doc: ConfigurationFileDocument, configurationId: string): string {
  const stripped = doc.name.replace(UNSAFE_FILENAME_CHARS, '-').replace(/^-+|-+$/g, '');
  const base = stripped.length > 0 ? stripped.slice(0, 100) : configurationId;
  return `${base}.qmkconfig.json`;
}

export function ExportConfigurationButton({ configuration }: ExportConfigurationButtonProps) {
  function exportNow() {
    const file = toConfigurationFile(configuration);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filenameFor(file.configuration, configuration.id);
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return (
    <button type="button" onClick={exportNow}>
      Export
    </button>
  );
}
