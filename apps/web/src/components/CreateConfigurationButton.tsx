'use client';

/**
 * Starts a configuration for a keyboard/layout and navigates into the editor.
 *
 * The starting point is QMK's own default keymap for the keyboard, when the catalog
 * has one — it comes from the pinned tree and the server interprets it, so nothing is
 * invented (rule 2). It is clearly attributed to QMK on the page so the user knows
 * these are QMK's choices to edit, not theirs. A blank start remains available, and is
 * the only option when the catalog has no default for this keyboard.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Layer } from '@qmk-web-app/domain';
import { ApiRequestError, createConfiguration, fetchPresetKeymap } from '../lib/client.ts';
import { newId } from '../lib/ids.ts';

export interface CreateConfigurationButtonProps {
  keyboardId: string;
  displayName: string;
  layoutId: string;
  catalogVersion: string;
  qmkCommit: string;
  /** Layers to start from. Absent means one empty base layer. */
  initialLayers?: Layer[];
  /** A community layout preset to fetch on click and start from (takes precedence over initialLayers). */
  preset?: string;
  label: string;
  secondary?: boolean;
}

export function CreateConfigurationButton(props: CreateConfigurationButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      let layers = props.initialLayers;
      if (props.preset) {
        const fetched = await fetchPresetKeymap(props.catalogVersion, props.keyboardId, props.layoutId, props.preset);
        if (!fetched.available) {
          setError(`QMK's ${props.preset} keymap could not be applied to this layout (${fetched.reason})`);
          setBusy(false);
          return;
        }
        layers = fetched.layers;
      }
      const created = await createConfiguration({
        name: props.preset ? `${props.displayName} ${props.preset}` : `${props.displayName} keymap`,
        catalogVersion: props.catalogVersion,
        qmkCommit: props.qmkCommit,
        keyboardId: props.keyboardId,
        layoutId: props.layoutId,
        layers: layers ?? [
          {
            id: newId(),
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
      <button
        type="button"
        className={props.secondary ? 'button-secondary' : undefined}
        onClick={() => void start()}
        disabled={busy}
      >
        {busy ? 'Creating…' : props.label}
      </button>
      {error ? (
        <p className="notice" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
