import Fastify, { type FastifyInstance } from 'fastify';
import type { CatalogStore } from './catalog-store.ts';
import type { ConfigurationRepository } from './configurations/types.ts';
import { registerCatalogRoutes } from './routes/catalog.ts';
import { registerConfigurationRoutes } from './routes/configurations.ts';
import { registerSessions } from './session.ts';

export interface BuildAppOptions {
  store: CatalogStore;
  repository: ConfigurationRepository;
  sessionSecret: string;
  /** Set Secure on session cookies. Must be true behind HTTPS in production. */
  secureCookies?: boolean;
  logger?: boolean;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    // Configurations are the largest body we accept; a full 8-layer keymap with
    // macros is well under this.
    bodyLimit: 1024 * 1024,
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    // Configuration data is per-session and must never be cached by a shared proxy.
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    return payload;
  });

  registerSessions(app, {
    secret: options.sessionSecret,
    secure: options.secureCookies ?? false,
  });

  app.get('/health', async () => ({ status: 'ok' }));

  registerCatalogRoutes(app, options.store);
  registerConfigurationRoutes(app, options.store, options.repository);

  return app;
}
