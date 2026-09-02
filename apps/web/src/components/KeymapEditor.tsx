'use client';

/**
 * The keymap editor.
 *
 * claude.md § Visual keymap editor, point by point:
 *  - layer tabs, a selected-position inspector, a searchable allowlisted keycode
 *    picker, undo/redo, and validation feedback before a build is requested;
 *  - unassigned positions stay visibly unassigned;
 *  - macros are structured steps, never user-entered C;
 *  - drafts are marked explicitly rather than silently treated as build-ready.
 *
 * All editing logic lives in `lib/editor-state.ts`; this component is the view plus
 * save orchestration.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Binding, CatalogKeyPosition, Macro } from '@qmk-web-app/domain';
import { fitToWidth } from '../lib/layout-geometry.ts';
import {
  canRedo,
  canUndo,
  createEditorState,
  describeBinding,
  editorReducer,
} from '../lib/editor-state.ts';
import {
  ApiRequestError,
  updateConfiguration,
  type ConfigurationResponse,
  type FieldError,
  type SocdCapabilitiesResponse,
  type SupportedKeycode,
} from '../lib/client.ts';
import { BindingPicker } from './BindingPicker.tsx';
import { BuildPanel } from './BuildPanel.tsx';
import { MacroEditor } from './MacroEditor.tsx';
import { SocdPanel } from './SocdPanel.tsx';

export interface KeymapEditorProps {
  configuration: ConfigurationResponse;
  positions: CatalogKeyPosition[];
  keycodes: SupportedKeycode[];
  /** Null when the capability lookup failed; the panel says so rather than guessing. */
  socdCapabilities: SocdCapabilitiesResponse | null;
}

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; at: string }
  | { status: 'invalid'; message: string; fieldErrors: FieldError[] }
  | { status: 'conflict'; message: string }
  | { status: 'error'; message: string };

export function KeymapEditor({
  configuration,
  positions,
  keycodes,
  socdCapabilities,
}: KeymapEditorProps) {
  const [state, dispatch] = useReducer(
    editorReducer,
    createEditorState(
      {
        name: configuration.name,
        layers: configuration.layers,
        macros: configuration.macros,
        socd: configuration.socd,
      },
      configuration.revision,
    ),
  );

  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const revisionRef = useRef(configuration.revision);
  // Draft-ness is the server's verdict and changes as keys are bound, so it is tracked
  // from save responses rather than frozen at page load.
  const [isDraft, setIsDraft] = useState(configuration.isDraft);

  const layout = useMemo(() => fitToWidth(positions, 1000, { gapPx: 3 }), [positions]);
  const activeLayer = state.document.layers.find((l) => l.index === state.activeLayerIndex);

  const persist = useCallback(async () => {
    setSave({ status: 'saving' });
    try {
      const updated = await updateConfiguration(configuration.id, revisionRef.current, {
        name: state.document.name,
        catalogVersion: configuration.catalogVersion,
        qmkCommit: configuration.qmkCommit,
        keyboardId: configuration.keyboardId,
        layoutId: configuration.layoutId,
        layers: state.document.layers,
        macros: state.document.macros,
        socd: state.document.socd,
      });
      revisionRef.current = updated.revision;
      setIsDraft(updated.isDraft);
      dispatch({ type: 'saved', revision: updated.revision });
      setSave({ status: 'saved', at: new Date().toLocaleTimeString() });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 409) {
          // Never silently overwrite. The user is told, and reload is the way out.
          setSave({
            status: 'conflict',
            message: `${error.message} (server is at revision ${error.currentRevision ?? '?'})`,
          });
          return;
        }
        if (error.status === 422 || error.status === 400) {
          setSave({ status: 'invalid', message: error.message, fieldErrors: error.fieldErrors });
          return;
        }
        setSave({ status: 'error', message: error.message });
        return;
      }
      setSave({ status: 'error', message: 'could not reach the server' });
    }
  }, [configuration, state.document]);

  /**
   * Autosave, debounced.
   *
   * claude.md: "Autosave only validated drafts, or mark drafts explicitly as
   * incomplete". Validation is the server's job, so autosave submits and surfaces
   * whatever the server says — an invalid document is reported, not silently kept.
   */
  useEffect(() => {
    if (!state.dirty) return;
    const timer = setTimeout(() => {
      void persist();
    }, 1200);
    return () => clearTimeout(timer);
  }, [state.dirty, state.document, persist]);

  // Undo/redo keyboard shortcuts.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        dispatch({ type: 'undo' });
      } else if ((event.key === 'z' && event.shiftKey) || event.key === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const selectedBinding =
    state.selectedPosition === null
      ? undefined
      : activeLayer?.bindings[String(state.selectedPosition)];

  function setBinding(binding: Binding) {
    if (state.selectedPosition === null) return;
    dispatch({
      type: 'set_binding',
      layerIndex: state.activeLayerIndex,
      position: state.selectedPosition,
      binding,
    });
  }

  return (
    <div className="editor">
      <div className="editor__toolbar">
        <label className="visually-hidden" htmlFor="config-name">
          Configuration name
        </label>
        <input
          id="config-name"
          className="editor__name"
          value={state.document.name}
          onChange={(e) => dispatch({ type: 'rename', name: e.target.value })}
        />

        <button type="button" disabled={!canUndo(state)} onClick={() => dispatch({ type: 'undo' })}>
          Undo
        </button>
        <button type="button" disabled={!canRedo(state)} onClick={() => dispatch({ type: 'redo' })}>
          Redo
        </button>
        <button type="button" onClick={() => void persist()} disabled={save.status === 'saving'}>
          Save now
        </button>

        <SaveIndicator state={save} dirty={state.dirty} />
      </div>

      {save.status === 'invalid' ? (
        <div className="notice" role="alert">
          <strong>Not saved — the server rejected this configuration.</strong>
          <p>{save.message}</p>
          {save.fieldErrors.length > 0 ? (
            <ul>
              {save.fieldErrors.slice(0, 8).map((fieldError) => (
                <li key={`${fieldError.path}:${fieldError.message}`}>
                  <code>{fieldError.path}</code> — {fieldError.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {save.status === 'conflict' ? (
        <div className="notice" role="alert">
          <strong>Not saved — this configuration changed elsewhere.</strong>
          <p>{save.message}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload the latest version
          </button>
        </div>
      ) : null}

      {isDraft ? (
        <p className="notice">
          This configuration is a <strong>draft</strong>: no keys are bound yet, so it cannot be
          built. Assign at least one key.
        </p>
      ) : null}

      <ul className="layout-tabs" role="tablist" aria-label="Layers">
        {state.document.layers.map((layer) => (
          <li key={layer.id}>
            <button
              type="button"
              role="tab"
              aria-selected={layer.index === state.activeLayerIndex}
              className="layout-tab"
              onClick={() => dispatch({ type: 'select_layer', index: layer.index })}
            >
              {layer.name}{' '}
              <span className="muted">({Object.keys(layer.bindings).length})</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="layout-tab" onClick={() => dispatch({ type: 'add_layer' })}>
            + Add layer
          </button>
        </li>
        {state.activeLayerIndex !== 0 ? (
          <li>
            <button
              type="button"
              className="layout-tab"
              onClick={() => dispatch({ type: 'remove_layer', index: state.activeLayerIndex })}
            >
              Remove “{activeLayer?.name}”
            </button>
          </li>
        ) : null}
      </ul>

      <div className="layout-wrapper">
        <svg
          className="keyboard"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          role="group"
          aria-label={`${configuration.layoutId}, ${activeLayer?.name ?? 'layer'}`}
        >
          {layout.keys.map((key) => {
            const binding = activeLayer?.bindings[String(key.index)];
            const label = describeBinding(binding, state.document.macros);
            const isSelected = key.index === state.selectedPosition;
            return (
              <g
                key={key.index}
                tabIndex={0}
                role="button"
                aria-pressed={isSelected}
                aria-label={`Position ${key.index}: ${label ?? 'unassigned'}`}
                className={`key${isSelected ? ' key--selected' : ''}${
                  label === null ? ' key--unassigned' : ''
                }`}
                transform={
                  key.rotation === 0
                    ? undefined
                    : `rotate(${key.rotation} ${key.rotationOriginX} ${key.rotationOriginY})`
                }
                onClick={() => dispatch({ type: 'select_position', position: key.index })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    dispatch({ type: 'select_position', position: key.index });
                  }
                }}
              >
                <rect x={key.x} y={key.y} width={key.width} height={key.height} rx={4} />
                {isSelected ? (
                  <rect
                    className="key__selection-ring"
                    x={key.x + 3}
                    y={key.y + 3}
                    width={Math.max(key.width - 6, 0)}
                    height={Math.max(key.height - 6, 0)}
                    rx={2}
                    fill="none"
                  />
                ) : null}
                <text
                  x={key.x + key.width / 2}
                  y={key.y + key.height / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="key__label"
                >
                  {/* Unassigned shows a dash, never a plausible-looking legend. */}
                  {label ?? '·'}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="inspector">
          {state.selectedPosition === null ? (
            <p className="muted">Select a key to assign a binding.</p>
          ) : (
            <>
              <h3>Position {state.selectedPosition}</h3>
              <p className="muted">
                Currently:{' '}
                <strong>{describeBinding(selectedBinding, state.document.macros) ?? 'unassigned'}</strong>
              </p>
              <BindingPicker
                keycodes={keycodes}
                layerCount={state.document.layers.length}
                macros={state.document.macros}
                current={selectedBinding}
                onChange={setBinding}
                onClear={() =>
                  dispatch({
                    type: 'clear_binding',
                    layerIndex: state.activeLayerIndex,
                    position: state.selectedPosition!,
                  })
                }
              />
            </>
          )}
        </div>
      </div>

      <MacroEditor
        macros={state.document.macros}
        keycodes={keycodes}
        onAdd={(macro: Macro) => dispatch({ type: 'add_macro', macro })}
        onUpdate={(macro: Macro) => dispatch({ type: 'update_macro', macro })}
        onRemove={(macroId: string) => dispatch({ type: 'remove_macro', macroId })}
      />

      <SocdPanel
        capabilities={socdCapabilities}
        socd={state.document.socd}
        positions={positions.map((p) => p.index)}
        onChange={(socd) => dispatch({ type: 'set_socd', socd })}
      />

      <BuildPanel
        configurationId={configuration.id}
        // A build compiles a stored revision, so anything not yet accepted by the
        // server blocks the button rather than being silently left out of the firmware.
        dirty={state.dirty || save.status === 'saving'}
        isDraft={isDraft}
      />
    </div>
  );
}

function SaveIndicator({ state, dirty }: { state: SaveState; dirty: boolean }) {
  // aria-live so the save state is announced, not only shown.
  let text: string;
  if (state.status === 'saving') text = 'Saving…';
  else if (dirty) text = 'Unsaved changes';
  else if (state.status === 'saved') text = `Saved at ${state.at}`;
  else if (state.status === 'invalid') text = 'Not saved';
  else if (state.status === 'conflict') text = 'Conflict';
  else if (state.status === 'error') text = 'Save failed';
  else text = 'Up to date';

  return (
    <span className="editor__save-state muted" aria-live="polite">
      {text}
    </span>
  );
}
