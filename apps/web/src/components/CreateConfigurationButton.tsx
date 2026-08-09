'use client';

/**
 * Starts a configuration for a keyboard/layout and navigates into the editor.
 *
 * The new configuration begins completely unbound — no default keymap is invented.
 * QMK ships defaults, but adopting one silently would present someone else's choices
 * as the user's own, and rule 2 forbids inventing keymap data.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, createConfiguration } from '../lib/client.ts';

export interface CreateConfigurationButtonProps {
  keyboardId: string;
  displayName: string;
  layoutId: string;
  catalogVersion: string;
  qmkCommit: string;
}

export function CreateConfigurationButton(props: CreateConfigurationButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const created = await createConfiguration({
        name: `${props.displayName} keymap`,
        catalogVersion: props.catalogVersion,
        qmkCommit: props.qmkCommit,
        keyboardId: props.keyboardId,
        layoutId: props.layoutId,
        layers: [
          {
            id: crypto.randomUUID(),
            index: 0,
            name: 'Base',
            bindings: {},
          },
        ],
        macros: [],
        socd: null,
      });
      router.push(`/configurations/${created.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : 'could not reach the server',
      );
      setBusy(false);
    }
  }

  return (
    <div className="create-config">
      <button type="button" onClick={() => void start()} disabled={busy}>
        {busy ? 'Creating…' : `Edit a keymap for ${props.layoutId}`}
      </button>
      {error ? (
        <p className="notice" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
