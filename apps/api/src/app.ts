import Fastify, { type FastifyInstance, type FastifyLoggerOptions } from 'fastify';
import type { ArtifactStore } from '@qmk-web-app/artifact-store';
import type { AssistantProvider } from '@qmk-web-app/assistant';
import type { CatalogStore } from './catalog-store.ts';
import type { BuildEnvironment } from './builds/service.ts';
import type { BuildRepository } from '@qmk-web-app/build-queue';
import type { ConfigurationRepository } from './configurations/types.ts';
import { registerAssistantRoutes, registerAssistantStatusRoute, type AssistantQuota } from './routes/assistant.ts';
import { registerBuildRoutes } from './routes/builds.ts';
import { registerCatalogRoutes } from './routes/catalog.ts';
import { registerConfigurationRoutes } from './routes/configurations.ts';
import { registerSessions, type SessionIssuanceLimit } from './session.ts';

export interface BuildAppOptions {
  store: CatalogStore;
  repository: ConfigurationRepository;
  sessionSecret: string;
  /**
   * Build request/status/download routes. Omitted in tests that only exercise the
   * catalog and configuration surfaces; when absent, those routes are simply not
   * registered rather than being present and broken.
   */
  builds?: {
    repository: BuildRepository;
    artifacts: ArtifactStore;
    environment: BuildEnvironment;
  };
  /**
   * Natural-language assistant. Omitted (the default, and what a missing
   * `QWA_ASSISTANT_API_KEY` produces) registers only the status route, which reports
   * `enabled: false`; the UI hides the panel. Nothing else in the app depends on it.
   */
  assistant?: {
    provider: AssistantProvider;
    quota?: AssistantQuota;
    maxAttempts?: number;
    timeoutMs?: number;
  };
  /** Set Secure on session cookies. Must be true behind HTTPS in production. */
  secureCookies?: boolean;
  /**
   * The known reverse-proxy hop allowed to set X-Forwarded-For (an address, a CIDR,
   * or a list of either), or `false` to trust nothing. Omitting it means trusting
   * nothing, which is correct for an in-process test with no reverse proxy in front
   * of it. See `apps/api/src/config.ts#parseTrustProxy` for how a caller derives this
   * from `QWA_TRUST_PROXY` — never pass `true` here (D-14).
   */
  trustProxy?: string | string[] | false;
  /** Overrides SESSION_LIMITS for tests; see `session.ts#SessionOptions.issuanceLimit`. */
  sessionIssuanceLimit?: SessionIssuanceLimit;
  /** See `session.ts#SessionOptions.sessionRequiredPathPrefixes`. */
  sessionRequiredPathPrefixes?: string[];
  /**
   * `false`/omitted disables Fastify's request logger entirely — the default for
   * tests, none of which need it. A caller that does want it (server.ts) must pass a
   * `FastifyLoggerOptions` object rather than `true`: Fastify's own default `req`
   * serializer includes `remoteAddress`, and this app must never let a client IP reach
   * a log line (see `PRODUCTION_LOGGER_OPTIONS` below).
   */
  logger?: boolean | FastifyLoggerOptions;
}

/**
 * The request-logger configuration `server.ts` ships in production. Fastify's default
 * `req` serializer (`fastify/lib/logger-pino.js`) includes `remoteAddress`/
 * `remotePort`; overriding it to omit both is a hard Phase 5 requirement — the client
 * IP is a rate-limit key held in memory and must never reach a log line, a build/
 * configuration row, or a telemetry attribute (see
 * `docs/deployment-requirements.md`'s log-sink section). Exported so `server.ts` and
 * this module's regression test share one definition instead of two copies that could
 * silently drift apart.
 */
export const PRODUCTION_LOGGER_OPTIONS: FastifyLoggerOptions = {
  serializers: {
    req(req) {
      return { method: req.method, url: req.url };
    },
  },
};

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    // Configurations are the largest body we accept; a full 8-layer keymap with
    // macros is well under this.
    bodyLimit: 1024 * 1024,
    trustProxy: options.trustProxy ?? false,
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    // Configuration data is per-session and must never be cached by a shared proxy.
    // Firmware downloads are per-owner and short-lived, so the same applies.
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    return payload;
  });

  registerSessions(app, {
    secret: options.sessionSecret,
    secure: options.secureCookies ?? false,
    ...(options.sessionIssuanceLimit ? { issuanceLimit: options.sessionIssuanceLimit } : {}),
    ...(options.sessionRequiredPathPrefixes
      ? { sessionRequiredPathPrefixes: options.sessionRequiredPathPrefixes }
      : {}),
  });

  app.get('/health', async () => ({ status: 'ok' }));

  registerCatalogRoutes(app, options.store);
  registerConfigurationRoutes(app, options.store, options.repository);

  registerAssistantStatusRoute(app, options.assistant?.provider ?? null);
  if (options.assistant) {
    registerAssistantRoutes(app, {
      store: options.store,
      configurations: options.repository,
      provider: options.assistant.provider,
      ...(options.assistant.quota ? { quota: options.assistant.quota } : {}),
      ...(options.assistant.maxAttempts !== undefined ? { maxAttempts: options.assistant.maxAttempts } : {}),
      ...(options.assistant.timeoutMs !== undefined ? { timeoutMs: options.assistant.timeoutMs } : {}),
    });
  }

  if (options.builds) {
    registerBuildRoutes(app, {
      store: options.store,
      configurations: options.repository,
      builds: options.builds.repository,
      artifacts: options.builds.artifacts,
      environment: options.builds.environment,
    });
  }

  return app;
}
