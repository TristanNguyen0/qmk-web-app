/**
 * Keyboard detail: physical layout renderer plus validated specifications.
 *
 * The route is a catch-all because QMK keyboard ids contain slashes
 * (`crkbd/rev1`, `handwired/onekey/promicro`). The id is passed straight to the API,
 * which is the component that matches it against the catalog — this page never
 * touches the filesystem with it.
 */
import { notFound } from 'next/navigation';
import { CreateConfigurationButton } from '../../../components/CreateConfigurationButton.tsx';
import { KeyboardLayout } from '../../../components/KeyboardLayout.tsx';
import { fetchDefaultKeymap, fetchKeyboard, type DefaultKeymapResult } from '../../../lib/api.ts';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ keyboardId: string[] }>;
  searchParams: Promise<{ layout?: string }>;
}

/** QMK's reasons, rendered as something a user can act on. */
const UNSUPPORTED_EXPLANATIONS: Record<string, string> = {
  extraction_failed: 'QMK could not read this keyboard’s metadata at the pinned revision.',
  qmk_parse_errors: 'QMK reported errors while parsing this keyboard’s definition.',
  no_layouts: 'This keyboard does not declare any layouts we can render.',
  missing_build_target:
    'This keyboard does not declare a complete build target (processor and bootloader), so firmware cannot be compiled for it.',
  layout_position_invalid:
    'This keyboard’s layout data contains key positions we could not read, so drawing it would be guesswork.',
  layout_too_large: 'This keyboard’s layout exceeds the size this application supports.',
};

interface StartingPointProps {
  defaultKeymap: DefaultKeymapResult | null;
  /** Community layouts QMK ships a keymap for and this keyboard supports. */
  presets: { name: string; layout: string }[];
  keyboardId: string;
  displayName: string;
  layoutId: string;
  catalogVersion: string;
  qmkCommit: string;
}

/**
 * Offers QMK's default keymap as the starting point when the catalog has one for this
 * layout, saying exactly where it came from and what could not be carried over. The
 * default is QMK's, so it is named as such rather than presented as a blank slate the
 * user filled in.
 */
function StartingPoint({ defaultKeymap, presets, ...create }: StartingPointProps) {
  if (!defaultKeymap?.available) {
    return (
      <div className="starting-point">
        <h3>Start a keymap</h3>
        <p className="muted">
          The catalog has no usable QMK default keymap for this layout, so the keymap starts
          empty.
        </p>
        <CreateConfigurationButton {...create} label={`Edit a blank keymap for ${create.layoutId}`} />
        <PresetStarts presets={presets} {...create} />
      </div>
    );
  }

  const boundKeys = defaultKeymap.layers.reduce(
    (sum, layer) => sum + Object.keys(layer.bindings).length,
    0,
  );
  const layerWord = defaultKeymap.layers.length === 1 ? 'layer' : 'layers';

  return (
    <div className="starting-point">
      <h3>Start from QMK’s default keymap</h3>
      <p className="muted" style={{ margin: 0 }}>
        QMK ships a default for this keyboard at{' '}
        <code>{defaultKeymap.source}</code>
        {defaultKeymap.sourceLayout !== create.layoutId ? (
          <>
            {' '}
            (written for <code>{defaultKeymap.sourceLayout}</code>; keys were matched to{' '}
            <code>{create.layoutId}</code> by physical switch)
          </>
        ) : null}
        . It gives you {defaultKeymap.layers.length} {layerWord} and {boundKeys} bound keys to
        edit. These are QMK’s choices, not yours, until you change them.
      </p>

      {defaultKeymap.unmapped.length > 0 ||
      defaultKeymap.droppedLayers > 0 ||
      defaultKeymap.unmatchedPositions > 0 ? (
        <details>
          <summary className="muted" style={{ fontSize: '0.875rem' }}>
            {defaultKeymap.unmapped.length > 0
              ? `${defaultKeymap.unmapped.length} key${defaultKeymap.unmapped.length === 1 ? '' : 's'} in QMK’s default use features this editor does not offer yet and will start unassigned`
              : 'Some of the default could not be carried over'}
            {defaultKeymap.droppedLayers > 0
              ? `; ${defaultKeymap.droppedLayers} extra layer${defaultKeymap.droppedLayers === 1 ? '' : 's'} beyond the limit were not imported`
              : ''}
            {defaultKeymap.unmatchedPositions > 0
              ? `; ${defaultKeymap.unmatchedPositions} position${defaultKeymap.unmatchedPositions === 1 ? '' : 's'} in this layout have no key in the default`
              : ''}
            .
          </summary>
          {defaultKeymap.unmapped.length > 0 ? (
            <ul className="muted" style={{ fontSize: '0.8125rem' }}>
              {defaultKeymap.unmapped.map((u) => (
                <li key={`${u.layerIndex}-${u.position}`}>
                  <code>{u.keycode}</code> — {defaultKeymap.layers[u.layerIndex]?.name ?? `layer ${u.layerIndex}`}, position {u.position}
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      ) : null}

      <div className="starting-point__actions">
        <CreateConfigurationButton
          {...create}
          initialLayers={defaultKeymap.layers}
          label={`Edit QMK’s default for ${create.layoutId}`}
        />
        <CreateConfigurationButton {...create} label="Start blank instead" secondary />
      </div>
      <PresetStarts presets={presets} {...create} />
    </div>
  );
}

/**
 * Standard arrangements as further starting points: QMK's canonical keymap for each
 * community layout this keyboard supports (`layouts/default/<name>/…` in the pinned
 * tree), carried onto the chosen layout by physical switch.
 */
function PresetStarts({ presets, ...create }: { presets: { name: string; layout: string }[] } & Omit<StartingPointProps, 'defaultKeymap' | 'presets'>) {
  if (presets.length === 0) return null;
  return (
    <div className="preset-starts">
      <p className="muted" style={{ margin: '0.75rem 0 0.25rem' }}>
        Or start from one of QMK’s standard arrangements for this keyboard (its <code>layouts/default</code>{' '}
        keymaps), carried onto <code>{create.layoutId}</code> by physical switch:
      </p>
      <div className="starting-point__actions">
        {presets.map((p) => (
          <CreateConfigurationButton key={p.name} {...create} preset={p.name} label={p.name} secondary />
        ))}
      </div>
    </div>
  );
}

export default async function KeyboardDetailPage({ params, searchParams }: PageProps) {
  const { keyboardId: segments } = await params;
  const { layout: requestedLayout } = await searchParams;
  const keyboardId = segments.join('/');

  const result = await fetchKeyboard(keyboardId);

  if (result.kind === 'not_found') notFound();

  if (result.kind === 'unsupported') {
    // A known-but-unsupported keyboard gets a real explanation rather than a 404,
    // so the user learns why it is absent (claude.md § Discovery process, step 5).
    const reason = result.keyboard.unsupportedReason;
    return (
      <>
        <h1>{keyboardId}</h1>
        <p>
          <span className="unsupported-badge">Unsupported</span>
        </p>
        <p className="notice">
          {UNSUPPORTED_EXPLANATIONS[reason] ?? 'This keyboard cannot be offered by this catalog.'}
        </p>
        <p className="muted">
          Nothing is guessed or filled in for unsupported keyboards, so this one cannot be
          configured or built here. It may become available in a future catalog version.
        </p>
        <p>
          <a href="/">← Back to all keyboards</a>
        </p>
      </>
    );
  }

  const { keyboard, catalogVersion } = result;
  const layout =
    keyboard.layouts.find((l) => l.name === requestedLayout) ?? keyboard.layouts[0] ?? null;
  const defaultKeymap: DefaultKeymapResult | null = layout
    ? await fetchDefaultKeymap(keyboard.keyboardId, layout.name, catalogVersion)
    : null;

  return (
    <>
      <h1>{keyboard.displayName}</h1>
      <p className="keyboard-card__id">{keyboard.keyboardId}</p>

      <p className="provenance">
        Catalog <code>{catalogVersion}</code> · QMK{' '}
        <code>{keyboard.provenance.qmkCommit.slice(0, 12)}</code> · source{' '}
        <code>keyboards/{keyboard.provenance.keyboardFolder}</code>
      </p>

      {keyboard.provenance.parseWarnings.length > 0 ? (
        <p className="notice">
          QMK reported {keyboard.provenance.parseWarnings.length} warning
          {keyboard.provenance.parseWarnings.length === 1 ? '' : 's'} for this keyboard. It is
          still supported, but double-check the layout below matches your hardware.
        </p>
      ) : null}

      <h2>Layout</h2>
      {keyboard.layouts.length > 1 ? (
        <ul className="layout-tabs">
          {keyboard.layouts.map((l) => (
            <li key={l.name}>
              <a
                className="layout-tab"
                href={`/keyboards/${keyboard.keyboardId}?layout=${encodeURIComponent(l.name)}`}
                aria-current={l.name === layout?.name}
              >
                {l.name} <span className="muted">({l.positionCount})</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {layout ? (
        <>
          <KeyboardLayout
            key={layout.name}
            positions={layout.positions}
            layoutName={layout.name}
          />
          <p className="muted" style={{ fontSize: '0.8125rem', marginTop: '0.75rem' }}>
            Keys show their physical position index and matrix coordinates. Start a keymap to
            assign bindings.
          </p>
          <StartingPoint
            defaultKeymap={defaultKeymap}
            presets={keyboard.communityLayouts ?? []}
            keyboardId={keyboard.keyboardId}
            displayName={keyboard.displayName}
            layoutId={layout.name}
            catalogVersion={catalogVersion}
            qmkCommit={keyboard.provenance.qmkCommit}
          />
        </>
      ) : (
        <p className="notice">This keyboard has no renderable layout in this catalog version.</p>
      )}

      <h2>Specifications</h2>
      {/* Only fields QMK actually reported. Absent values are shown as absent. */}
      <table className="spec-table">
        <tbody>
          <tr>
            <th scope="row">Processor</th>
            <td>{keyboard.processor}</td>
          </tr>
          <tr>
            <th scope="row">Bootloader</th>
            <td>{keyboard.bootloader}</td>
          </tr>
          <tr>
            <th scope="row">Platform</th>
            <td>{keyboard.platform ?? <span className="muted">not reported</span>}</td>
          </tr>
          <tr>
            <th scope="row">Manufacturer</th>
            <td>{keyboard.manufacturer ?? <span className="muted">not reported</span>}</td>
          </tr>
          <tr>
            <th scope="row">Layouts</th>
            <td>{keyboard.layouts.map((l) => l.name).join(', ')}</td>
          </tr>
        </tbody>
      </table>

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/">← Back to all keyboards</a>
      </p>
    </>
  );
}
