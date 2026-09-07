/**
 * Natural-language assistant routes.
 *
 * `POST /v1/configurations/:id/assistant` takes a prompt and returns a *candidate*:
 * the resolved configuration the user may apply, the list of changes, anything that
 * could not be honoured, and any operations the resolver refused. It never writes.
 * Applying is the editor's job, saving goes through the ordinary PUT with `If-Match`,
 * and building stays behind the ordinary build request — so the assistant adds no
 * new path to storage, generation, or the build queue.
 *
 * Authorization is the configuration's: the record is loaded by (id, owner), and a
 * stranger's id is a 404 exactly as on the configuration routes.
 *
 * The client may send its current, unsaved document with the prompt so the
 * proposal builds on what the user actually sees rather than on the last autosave.
 * That document is untrusted input like any other: it is overlaid on the stored
 * record's immutable fields and parsed against the schema before use.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ASSISTANT_LIMITS,
  DomainError,
  parseConfiguration,
  type Configuration,
} from '@qmk-web-app/domain';
import { ProviderError, runAssistant, type AssistantProvider } from '@qmk-web-app/assistant';
import type { CatalogStore } from '../catalog-store.ts';
import { catalogFor } from '../configurations/service.ts';
import type { ConfigurationRepository } from '../configurations/types.ts';
import { API_VERSION, sendBadRequest, sendDomainError, sendNotFound } from '../errors.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AssistantQuotaLimits {
  requestsPerOwnerPerHour: number;
  requestWindowMs: number;
  maxGlobalInFlight: number;
}

/**
 * Per-owner sliding window plus a global in-flight cap, in memory. Cost control for
 * a single-process deployment; a second API replica would need this in Postgres, and
 * that is the trigger to move it — not a reason to build it now.
 */
export class AssistantQuota {
  readonly #limits: AssistantQuotaLimits;
  readonly #byOwner = new Map<string, number[]>();
  #inFlight = 0;
  readonly #now: () => number;

  constructor(limits: AssistantQuotaLimits = ASSISTANT_LIMITS, now: () => number = Date.now) {
    this.#limits = limits;
    this.#now = now;
  }

  /** Reserves a slot or explains the refusal. The caller must `release()` after a reservation. */
  acquire(ownerId: string): { ok: true } | { ok: false; reason: string; retryAfterSeconds: number } {
    const now = this.#now();
    const windowStart = now - this.#limits.requestWindowMs;
    const recent = (this.#byOwner.get(ownerId) ?? []).filter((t) => t > windowStart);
    if (recent.length >= this.#limits.requestsPerOwnerPerHour) {
      const oldest = recent[0]!;
      return {
        ok: false,
        reason: `this session has used its ${this.#limits.requestsPerOwnerPerHour} assistant requests for the hour`,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.#limits.requestWindowMs - now) / 1000)),
      };
    }
    if (this.#inFlight >= this.#limits.maxGlobalInFlight) {
      return { ok: false, reason: 'the assistant is busy; try again in a moment', retryAfterSeconds: 5 };
    }
    recent.push(now);
    this.#byOwner.set(ownerId, recent);
    this.#inFlight += 1;
    return { ok: true };
  }

  release(): void {
    this.#inFlight = Math.max(0, this.#inFlight - 1);
  }
}

export interface AssistantRouteOptions {
  store: CatalogStore;
  configurations: ConfigurationRepository;
  provider: AssistantProvider;
  quota?: AssistantQuota;
  maxAttempts?: number;
  timeoutMs?: number;
}

interface IdParams {
  id: string;
}

function sendAssistantError(
  reply: FastifyReply,
  status: number,
  code: 'ASSISTANT_DISABLED' | 'ASSISTANT_FAILED' | 'RATE_LIMITED',
  message: string,
  retryAfterSeconds?: number,
): FastifyReply {
  if (retryAfterSeconds !== undefined) reply.header('retry-after', String(retryAfterSeconds));
  return reply.code(status).send({ apiVersion: API_VERSION, error: { code, message } });
}

/** Registered whether or not a provider exists, so the UI can ask before showing the panel. */
export function registerAssistantStatusRoute(app: FastifyInstance, provider: AssistantProvider | null): void {
  app.get('/v1/assistant', async () => ({
    apiVersion: API_VERSION,
    enabled: provider !== null,
    ...(provider ? { model: provider.model } : {}),
    limits: {
      maxPromptLength: ASSISTANT_LIMITS.maxPromptLength,
      requestsPerOwnerPerHour: ASSISTANT_LIMITS.requestsPerOwnerPerHour,
    },
  }));
}

export function registerAssistantRoutes(app: FastifyInstance, options: AssistantRouteOptions): void {
  const quota = options.quota ?? new AssistantQuota();
  const maxAttempts = options.maxAttempts ?? ASSISTANT_LIMITS.maxAttempts;
  const timeoutMs = options.timeoutMs ?? ASSISTANT_LIMITS.timeoutMs;

  app.post<{ Params: IdParams }>('/v1/configurations/:id/assistant', async (request, reply) => {
    if (!UUID_RE.test(request.params.id)) return sendBadRequest(reply, 'id must be a UUID');

    const body = request.body;
    if (typeof body !== 'object' || body === null) return sendBadRequest(reply, 'request body must be an object');
    const { prompt, document } = body as { prompt?: unknown; document?: unknown };
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      return sendBadRequest(reply, 'prompt is required', [{ path: 'prompt', message: 'must be a non-empty string' }]);
    }
    if (prompt.length > ASSISTANT_LIMITS.maxPromptLength) {
      return sendBadRequest(reply, `prompt must be at most ${ASSISTANT_LIMITS.maxPromptLength} characters`, [
        { path: 'prompt', message: 'too long' },
      ]);
    }

    const record = await options.configurations.get(request.params.id, request.ownerId);
    if (!record) return sendNotFound(reply, 'no such configuration');

    // Overlay the client's working document, if any, on the stored record. Only the
    // editable fields are read; identity, catalog binding, and ownership stay the
    // server's. The result must parse before it is trusted for anything.
    let configuration: Configuration = record.document;
    if (document !== undefined) {
      if (typeof document !== 'object' || document === null) {
        return sendBadRequest(reply, 'document must be an object when present');
      }
      const d = document as Record<string, unknown>;
      try {
        configuration = parseConfiguration({
          ...record.document,
          ...(typeof d['name'] === 'string' ? { name: d['name'] } : {}),
          layers: d['layers'] ?? record.document.layers,
          macros: d['macros'] ?? record.document.macros,
          socd: d['socd'] === undefined ? record.document.socd : d['socd'],
        });
      } catch (error) {
        if (error instanceof DomainError) return sendDomainError(reply, error);
        throw error;
      }
    }

    const reservation = quota.acquire(request.ownerId);
    if (!reservation.ok) {
      return sendAssistantError(reply, 429, 'RATE_LIMITED', reservation.reason, reservation.retryAfterSeconds);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await runAssistant({
        provider: options.provider,
        configuration,
        catalog: catalogFor(options.store, record.catalogVersion, record.keyboardId),
        prompt,
        maxAttempts,
        signal: controller.signal,
      });

      if (result.outcome === 'malformed') {
        request.log.warn({ errors: result.errors.slice(0, 5), attempts: result.attempts }, 'assistant produced no parseable proposal');
        return sendAssistantError(reply, 502, 'ASSISTANT_FAILED', 'the assistant did not produce a usable proposal; try rephrasing');
      }

      const { resolved } = result;
      return reply.send({
        apiVersion: API_VERSION,
        configurationId: record.id,
        /** The revision the candidate was derived from; the client saves with If-Match as usual. */
        baseRevision: record.revision,
        ok: resolved.ok,
        summary: resolved.summary,
        unsupported: resolved.unsupported,
        changes: resolved.changes,
        issues: resolved.issues,
        validation: resolved.validation,
        candidate: {
          name: resolved.candidate.name,
          layers: resolved.candidate.layers,
          macros: resolved.candidate.macros,
          socd: resolved.candidate.socd,
        },
        attempts: result.attempts,
        usage: result.usage,
      });
    } catch (error) {
      if (error instanceof ProviderError) {
        // Provider detail (status text, upstream message) is operator-facing.
        request.log.warn({ status: error.status, err: error.message }, 'assistant provider failure');
        return sendAssistantError(reply, 502, 'ASSISTANT_FAILED', 'the assistant is unavailable right now; try again shortly');
      }
      if (error instanceof DomainError) return sendDomainError(reply, error);
      if ((error as Error).name === 'AbortError') {
        return sendAssistantError(reply, 504, 'ASSISTANT_FAILED', 'the assistant took too long; try a shorter request');
      }
      throw error;
    } finally {
      clearTimeout(timer);
      quota.release();
    }
  });
}
