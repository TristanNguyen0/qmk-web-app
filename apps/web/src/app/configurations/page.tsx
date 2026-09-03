/**
 * The session's saved configurations.
 *
 * The list comes from the API scoped to this session's cookie; the page performs no
 * ownership logic of its own.
 */
import { cookies } from 'next/headers';
import { DataLossNotice } from '../../components/DataLossNotice.tsx';
import { ImportConfigurationButton } from '../../components/ImportConfigurationButton.tsx';
import type { ConfigurationSummary } from '../../lib/client.ts';

export const dynamic = 'force-dynamic';

const API_BASE = process.env['QWA_API_URL'] ?? 'http://127.0.0.1:3001';

interface ListBody {
  items: ConfigurationSummary[];
  totalItems: number;
}

export default async function ConfigurationsPage() {
  const cookieHeader = (await cookies()).toString();
  const response = await fetch(`${API_BASE}/v1/configurations?pageSize=100`, {
    headers: { accept: 'application/json', cookie: cookieHeader },
    cache: 'no-store',
  });

  if (!response.ok) {
    return (
      <>
        <h1>Your configurations</h1>
        <p className="notice">Could not load your configurations. Is the API running?</p>
      </>
    );
  }

  const body = (await response.json()) as ListBody;

  return (
    <>
      <h1>Your configurations</h1>
      <DataLossNotice />
      <ImportConfigurationButton />

      {body.items.length === 0 ? (
        <p className="notice">
          You have no saved configurations. <a href="/">Choose a keyboard</a> to start one.
        </p>
      ) : (
        <ul className="keyboard-grid">
          {body.items.map((config) => (
            <li key={config.id}>
              <a className="keyboard-card" href={`/configurations/${config.id}`}>
                <div>
                  <strong>{config.name}</strong>{' '}
                  {config.isDraft ? <span className="unsupported-badge">Draft</span> : null}
                </div>
                <div className="keyboard-card__id">{config.keyboardId}</div>
                <div className="keyboard-card__meta">
                  {config.layerCount} layer{config.layerCount === 1 ? '' : 's'} · revision{' '}
                  {config.revision} · updated {new Date(config.updatedAt).toLocaleString()}
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
