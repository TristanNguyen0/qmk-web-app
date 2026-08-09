/**
 * Browser-side API client.
 *
 * Requests go to `/api/...` on this origin, which the route handler proxies to the
 * API. That keeps the session cookie same-origin and `HttpOnly`.
 *
 * The client carries no keyboard or keycode knowledge of its own — everything it
 * knows arrives in a response (claude.md § Catalog interfaces).
 */
import type { Binding, CatalogKeyPosition, Layer, Macro } from '@qmk-web-app/domain';

export interface SupportedKeycode {
  name: string;
  group: string;
  label: string;
}

export interface FieldError {
  path: string;
  message: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldError[];
  /** Present on a 409 conflict: the revision the server actually holds. */
  readonly currentRevision: number | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors: FieldError[] = [],
    currentRevision?: number,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.currentRevision = currentRevision;
  }
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; ifMatch?: number } = {},
): Promise<{ data: T; etag: string | null }> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.ifMatch !== undefined) headers['if-match'] = `"${init.ifMatch}"`;

  const response = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers,
    // Spread rather than `body: undefined`: with exactOptionalPropertyTypes, an
    // explicit undefined is not the same as an absent property.
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  if (response.status === 204) return { data: undefined as T, etag: null };

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    const error = (body?.['error'] ?? {}) as Record<string, unknown>;
    throw new ApiRequestError(
      response.status,
      String(error['code'] ?? 'UNKNOWN'),
      String(error['message'] ?? 'request failed'),
      (error['fieldErrors'] as FieldError[]) ?? [],
      body?.['currentRevision'] as number | undefined,
    );
  }

  return { data: body as T, etag: response.headers.get('etag') };
}

export interface ConfigurationResponse {
  id: string;
  name: string;
  keyboardId: string;
  layoutId: string;
  catalogVersion: string;
  qmkCommit: string;
  revision: number;
  isDraft: boolean;
  layers: Layer[];
  macros: Macro[];
  socd: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigurationSummary {
  id: string;
  name: string;
  keyboardId: string;
  layoutId: string;
  revision: number;
  isDraft: boolean;
  layerCount: number;
  updatedAt: string;
}

export interface SaveConfigurationInput {
  name: string;
  catalogVersion: string;
  qmkCommit: string;
  keyboardId: string;
  layoutId: string;
  layers: Layer[];
  macros: Macro[];
  socd: unknown;
}

export async function createConfiguration(
  input: SaveConfigurationInput,
): Promise<ConfigurationResponse> {
  const { data } = await request<{ configuration: ConfigurationResponse }>('/v1/configurations', {
    method: 'POST',
    body: input,
  });
  return data.configuration;
}

export async function updateConfiguration(
  id: string,
  revision: number,
  input: SaveConfigurationInput,
): Promise<ConfigurationResponse> {
  const { data } = await request<{ configuration: ConfigurationResponse }>(
    `/v1/configurations/${id}`,
    { method: 'PUT', body: input, ifMatch: revision },
  );
  return data.configuration;
}

export async function deleteConfiguration(id: string): Promise<void> {
  await request<void>(`/v1/configurations/${id}`, { method: 'DELETE' });
}

export type { Binding, CatalogKeyPosition, Layer, Macro };
