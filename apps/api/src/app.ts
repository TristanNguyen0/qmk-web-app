import Fastify, { type FastifyInstance } from 'fastify';
import type { ArtifactStore } from '@qmk-web-app/artifact-store';
import type { CatalogStore } from './catalog-store.ts';
import type { BuildEnvironment } from './builds/service.ts';
import type { BuildRepository } from '@qmk-web-app/build-queue';
import type { ConfigurationRepository } from './configurations/types.ts';
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
  logger?: boolean;
}

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
  });

  app.get('/health', async () => ({ status: 'ok' }));

  registerCatalogRoutes(app, options.store);
  registerConfigurationRoutes(app, options.store, options.repository);

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
