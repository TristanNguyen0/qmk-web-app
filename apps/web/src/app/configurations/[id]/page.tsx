/**
 * Editor page.
 *
 * The server component loads the configuration and the layout it targets, then hands
 * both to the client editor. The layout geometry comes from the catalog, not from the
 * stored configuration, so a configuration can never carry its own idea of where the
 * keys are.
 */
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { KeymapEditor } from '../../../components/KeymapEditor.tsx';
import { fetchKeyboard } from '../../../lib/api.ts';
import type {
  AssistantStatusResponse,
  ConfigurationResponse,
  SocdCapabilitiesResponse,
  SupportedKeycode,
} from '../../../lib/client.ts';

export const dynamic = 'force-dynamic';

const API_BASE = process.env['QWA_API_URL'] ?? 'http://127.0.0.1:3001';

interface PageProps {
  params: Promise<{ id: string }>;
}

/** Server-side fetch that forwards the caller's session cookie. */
async function apiGet<T>(path: string): Promise<T | null> {
  const cookieHeader = (await cookies()).toString();
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { accept: 'application/json', cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

export default async function EditorPage({ params }: PageProps) {
  const { id } = await params;

  const configBody = await apiGet<{ configuration: ConfigurationResponse }>(
    `/v1/configurations/${id}`,
  );
  // The API already scoped this to the session, so a miss means "not yours or not
  // there" — either way, not found.
  if (!configBody) notFound();

  const configuration = configBody.configuration;

  const [keyboardResult, keycodesBody, socdCapabilities, assistantStatus] = await Promise.all([
    fetchKeyboard(configuration.keyboardId, configuration.catalogVersion),
    apiGet<{ keycodes: SupportedKeycode[] }>(
      `/v1/catalog/${configuration.catalogVersion}/keycodes`,
    ),
    // Whether SOCD is offered is the server's answer, per keyboard — the editor never
    // decides it locally (claude.md § Catalog interfaces: listSocdCapabilities).
    apiGet<SocdCapabilitiesResponse>(
      `/v1/catalog/${configuration.catalogVersion}/socd-capabilities/${configuration.keyboardId}`,
    ),
    // Whether an assistant exists is the server's to say; the panel hides otherwise.
    apiGet<AssistantStatusResponse>('/v1/assistant'),
  ]);

  if (keyboardResult.kind !== 'supported') {
    return (
      <>
        <h1>{configuration.name}</h1>
        <p className="notice">
          The keyboard this configuration targets (<code>{configuration.keyboardId}</code>) is not
          available in catalog <code>{configuration.catalogVersion}</code>, so it cannot be
          edited. The configuration is preserved and unchanged.
        </p>
        <p>
          <a href="/configurations">← Back to your configurations</a>
        </p>
      </>
    );
  }

  const layout = keyboardResult.keyboard.layouts.find((l) => l.name === configuration.layoutId);
  if (!layout) {
    return (
      <>
        <h1>{configuration.name}</h1>
        <p className="notice">
          Layout <code>{configuration.layoutId}</code> no longer exists for this keyboard in
          catalog <code>{configuration.catalogVersion}</code>.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>{configuration.name}</h1>
      <p className="provenance">
        {keyboardResult.keyboard.displayName} · <code>{configuration.layoutId}</code> · catalog{' '}
        <code>{configuration.catalogVersion}</code> · revision {configuration.revision}
      </p>

      <KeymapEditor
        configuration={configuration}
        positions={layout.positions}
        keycodes={keycodesBody?.keycodes ?? []}
        socdCapabilities={socdCapabilities}
        assistantStatus={assistantStatus}
      />

      <p style={{ marginTop: '2rem' }}>
        <a href="/configurations">← Your configurations</a>
      </p>
    </>
  );
}
