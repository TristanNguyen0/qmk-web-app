/**
 * Browser-side API client.
 *
 * Requests go to `/api/...` on this origin, which the route handler proxies to the
 * API. That keeps the session cookie same-origin and `HttpOnly`.
 *
 * The client carries no keyboard or keycode knowledge of its own — everything it
 * knows arrives in a response (claude.md § Catalog interfaces).
 */
import type {
  Binding,
  CatalogKeyPosition,
  Layer,
  Macro,
  SocdConfiguration,
} from '@qmk-web-app/domain';

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
  init: {
    method?: string;
    body?: unknown;
    ifMatch?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<{ data: T; etag: string | null }> {
  const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
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
  socd: SocdConfiguration | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the server says SOCD can do for one keyboard.
 *
 * Mirrors `GET /v1/catalog/:version/socd-capabilities/*`. The UI renders exactly this
 * and adds nothing to it — an empty `policies` with a `reason` is the honest answer for
 * a keyboard that has not been compile-verified.
 */
export interface SocdCapabilitiesResponse {
  keyboardId: string;
  available: boolean;
  reason?: string;
  policies: { id: string; label: string; description: string }[];
  verticalPairs: [string, string][];
  horizontalPairs: [string, string][];
  compliance: string;
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
  socd: SocdConfiguration | null;
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

/**
 * A build, exactly as the server describes it.
 *
 * There is no client-side notion of "probably done" or "should be downloadable": the
 * status and the presence of `artifact` come from the server, because only the server
 * knows whether a firmware exists and has not expired.
 */
export interface BuildSummary {
  id: string;
  configurationId: string;
  configurationRevision: number;
  status:
    | 'queued'
    | 'preparing'
    | 'building'
    | 'uploading'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'expired';
  failureCode: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  attemptCount: number;
  catalogVersion: string;
  qmkCommit: string;
  generatorVersion: string;
  artifact: {
    filename: string;
    byteSize: number;
    sha256: string;
    contentType: string;
    expiresAt: string;
  } | null;
}

/** Statuses that will not change again without a new build being requested. */
export function isBuildFinished(status: BuildSummary['status']): boolean {
  return ['succeeded', 'failed', 'cancelled', 'expired'].includes(status);
}

/**
 * Requests a build. `idempotencyKey` must be stable across retries of the *same*
 * intent, so a failed or repeated request cannot queue a second compile.
 */
export async function requestBuild(
  configurationId: string,
  idempotencyKey: string,
): Promise<BuildSummary> {
  const { data } = await request<{ build: BuildSummary }>(
    `/v1/configurations/${configurationId}/builds`,
    { method: 'POST', headers: { 'idempotency-key': idempotencyKey } },
  );
  return data.build;
}

export async function fetchBuild(buildId: string): Promise<BuildSummary> {
  const { data } = await request<{ build: BuildSummary }>(`/v1/builds/${buildId}`);
  return data.build;
}

export async function fetchBuilds(
  configurationId: string,
  pageSize = 10,
): Promise<BuildSummary[]> {
  const { data } = await request<{ items: BuildSummary[] }>(
    `/v1/configurations/${configurationId}/builds?pageSize=${pageSize}`,
  );
  return data.items;
}

export async function cancelBuild(buildId: string): Promise<BuildSummary | null> {
  const { data } = await request<{ build: BuildSummary | null }>(`/v1/builds/${buildId}/cancel`, {
    method: 'POST',
  });
  return data.build;
}

/**
 * Download URLs are plain API paths, not storage URLs: the request carries the session
 * cookie and the API authorizes it (claude.md § Error handling — "Never expose a direct
 * storage key").
 */
export function artifactUrl(buildId: string): string {
  return `/api/v1/builds/${buildId}/artifact`;
}

export function buildLogUrl(buildId: string): string {
  return `/api/v1/builds/${buildId}/log`;
}

export type { Binding, CatalogKeyPosition, Layer, Macro };
