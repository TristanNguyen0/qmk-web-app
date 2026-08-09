/**
 * Same-origin proxy to the catalog/configuration API.
 *
 * The editor runs in the browser and writes configurations, which means the request
 * must carry the session cookie. Calling the API's origin directly would make those
 * cross-origin requests, requiring CORS plus `credentials: 'include'` plus a
 * `SameSite=None` cookie — three settings that each weaken the session in exchange
 * for nothing. Proxying keeps everything same-origin, so `SameSite=Lax` and
 * `HttpOnly` hold.
 *
 * This is a transparent pass-through: it forwards the method, body, cookies and
 * content type, and returns the upstream status and `set-cookie` unchanged. It adds
 * no authorization of its own — the API remains the only place that authorizes.
 */
import type { NextRequest } from 'next/server';

const API_BASE = process.env['QWA_API_URL'] ?? 'http://127.0.0.1:3001';

/** Headers safe to forward upstream. An allowlist, so nothing unexpected leaks. */
const FORWARD_REQUEST_HEADERS = ['cookie', 'content-type', 'accept', 'if-match'];

/** Headers forwarded back. Deliberately excludes hop-by-hop and encoding headers. */
const FORWARD_RESPONSE_HEADERS = ['content-type', 'etag', 'location', 'cache-control'];

async function proxy(request: NextRequest, path: string[]): Promise<Response> {
  const search = request.nextUrl.search;
  const url = `${API_BASE}/${path.join('/')}${search}`;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const method = request.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method,
      headers,
      cache: 'no-store',
      redirect: 'manual',
      ...(hasBody ? { body: await request.text() } : {}),
    });
  } catch {
    // The API being down is an expected local-dev state; report it as such rather
    // than leaking the upstream URL or a stack trace.
    return Response.json(
      { apiVersion: 1, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'the API is not reachable' } },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  // Session cookies must reach the browser or the session never sticks.
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', cookie);
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path);
}
export async function POST(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path);
}
export async function PUT(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path);
}
export async function DELETE(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path);
}
