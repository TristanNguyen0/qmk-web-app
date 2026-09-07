/**
 * Catalog read routes.
 *
 * These are the interfaces claude.md § Catalog interfaces specifies:
 * `listKeyboards`, `getKeyboard`, `listKeycodes`, `listSocdCapabilities`.
 *
 * Two rules shape every handler here:
 *  - The frontend renders only from these responses and carries no catalog of its
 *    own, so a response must contain everything needed to draw a keyboard.
 *  - A keyboard id from the URL is untrusted until it is matched against the loaded
 *    catalog (claude.md rule 5). It is never used to touch the filesystem.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ERROR_CODES,
  SUPPORTED_KEYCODES,
  communityKeymapFit,
  importCommunityKeymap,
  importDefaultKeymap,
  isValidKeyboardIdShape,
  socdCapabilitiesFor,
  type SupportedCatalogKeyboard,
} from '@qmk-web-app/domain';
import { CatalogNotFoundError, MAX_PAGE_SIZE, type CatalogStore } from '../catalog-store.ts';
import { API_VERSION, sendBadRequest, sendNotFound } from '../errors.ts';

interface VersionParams {
  catalogVersion: string;
}

interface WildcardParams extends VersionParams {
  '*': string;
}

interface DefaultKeymapQuery {
  layout?: string;
  /** A community layout name from the keyboard's `communityLayouts`; absent means QMK's own default. */
  preset?: string;
}

interface ListQuery {
  search?: string;
  includeUnsupported?: string;
  page?: string;
  pageSize?: string;
}

function parsePositiveInt(value: string | undefined, label: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^\d{1,6}$/.test(value)) throw new RangeError(`${label} must be a positive integer`);
  const parsed = Number(value);
  if (parsed < 1) throw new RangeError(`${label} must be at least 1`);
  return parsed;
}

/**
 * Resolves the catalog version segment. `latest` is accepted as a convenience for the
 * UI, but the response always names the concrete version it resolved to, so a client
 * can pin to it — configurations must never be stored against "latest"
 * (claude.md § Source management).
 */
function resolveVersion(store: CatalogStore, requested: string): string {
  if (requested === 'latest') return store.activeVersion;
  return store.getMeta(requested).catalogVersion;
}

export function registerCatalogRoutes(app: FastifyInstance, store: CatalogStore): void {
  // Index: what catalog versions exist and which one is active.
  app.get('/v1/catalog', async () => ({
    apiVersion: API_VERSION,
    activeVersion: store.activeVersion,
    versions: store.versions,
  }));

  app.get<{ Params: VersionParams }>('/v1/catalog/:catalogVersion', async (request, reply) => {
    const version = resolveVersion(store, request.params.catalogVersion);
    // Provenance travels with the data so a client can show exactly which QMK
    // revision it is looking at.
    return reply.send({ apiVersion: API_VERSION, catalog: store.getMeta(version) });
  });

  app.get<{ Params: VersionParams; Querystring: ListQuery }>(
    '/v1/catalog/:catalogVersion/keyboards',
    async (request, reply) => {
      const version = resolveVersion(store, request.params.catalogVersion);

      let page: number | undefined;
      let pageSize: number | undefined;
      try {
        page = parsePositiveInt(request.query.page, 'page');
        pageSize = parsePositiveInt(request.query.pageSize, 'pageSize');
      } catch (error) {
        return sendBadRequest(reply, (error as Error).message);
      }
      if (pageSize !== undefined && pageSize > MAX_PAGE_SIZE) {
        return sendBadRequest(reply, `pageSize must be at most ${MAX_PAGE_SIZE}`);
      }

      const result = store.listKeyboards(version, {
        ...(request.query.search ? { search: request.query.search } : {}),
        includeUnsupported: request.query.includeUnsupported === 'true',
        ...(page !== undefined ? { page } : {}),
        ...(pageSize !== undefined ? { pageSize } : {}),
      });

      return reply.send({ apiVersion: API_VERSION, catalogVersion: version, ...result });
    },
  );

  // Keyboard ids contain slashes (`crkbd/rev1`), so this is a wildcard route.
  app.get<{ Params: WildcardParams }>(
    '/v1/catalog/:catalogVersion/keyboards/*',
    async (request, reply) => {
      const version = resolveVersion(store, request.params.catalogVersion);
      const keyboardId = request.params['*'];

      // Shape check first: a malformed id is a bad request, and must never reach a
      // lookup that could be backed by a path.
      if (!isValidKeyboardIdShape(keyboardId)) {
        return sendBadRequest(reply, 'keyboardId is not a valid keyboard identifier');
      }

      const entry = store.getKeyboard(version, keyboardId);
      if (!entry) {
        return sendNotFound(reply, 'no such keyboard in this catalog version');
      }

      if (!entry.supported) {
        // Unsupported keyboards are surfaced deliberately, with the reason, so the UI
        // can explain the absence instead of showing a dead end. `detail` is operator
        // -facing and is not included.
        return reply.code(409).send({
          apiVersion: API_VERSION,
          error: {
            code: ERROR_CODES.CATALOG_KEYBOARD_UNAVAILABLE,
            message: 'this keyboard is not supported by the active catalog',
          },
          keyboard: {
            keyboardId: entry.keyboardId,
            supported: false,
            unsupportedReason: entry.reason,
          },
        });
      }

      return reply.send({
        apiVersion: API_VERSION,
        catalogVersion: version,
        keyboard: projectKeyboard(entry),
      });
    },
  );

  // The product's supported keycode catalog. Deliberately not the full QMK set
  // (claude.md § Visual keymap editor: "Start with a compact keycode catalog").
  app.get<{ Params: VersionParams }>(
    '/v1/catalog/:catalogVersion/keycodes',
    async (request, reply) => {
      const version = resolveVersion(store, request.params.catalogVersion);
      return reply.send({
        apiVersion: API_VERSION,
        catalogVersion: version,
        keycodeSpecVersion: store.getMeta(version).keycodeSpecVersion,
        keycodes: SUPPORTED_KEYCODES,
      });
    },
  );

  app.get<{ Params: WildcardParams }>(
    '/v1/catalog/:catalogVersion/socd-capabilities/*',
    async (request, reply) => {
      const version = resolveVersion(store, request.params.catalogVersion);
      const keyboardId = request.params['*'];
      if (!isValidKeyboardIdShape(keyboardId)) {
        return sendBadRequest(reply, 'keyboardId is not a valid keyboard identifier');
      }
      if (!store.getSupportedKeyboard(version, keyboardId)) {
        return sendNotFound(reply, 'no such supported keyboard in this catalog version');
      }

      // claude.md rule 9: only what has actually been verified is offered. A keyboard
      // that has not been through the SOCD compile matrix gets an empty policy list
      // and a reason, never an optimistic one (see packages/domain/src/socd.ts).
      const capabilities = socdCapabilitiesFor(version, keyboardId);
      return reply.send({
        apiVersion: API_VERSION,
        catalogVersion: version,
        keyboardId,
        ...capabilities,
        // claude.md rule 10: SOCD behaviour and any tournament rules around it are the
        // user's responsibility. The product states what the firmware does and makes
        // no compliance claim on their behalf.
        compliance:
          'You are responsible for whether SOCD resolution is permitted wherever you use this keyboard. This product makes no compliance claim.',
      });
    },
  );

  // The keyboard's QMK default keymap, interpreted into the product's binding model
  // for one layout — the starting point offered when a user begins a configuration.
  // The response says exactly what came from QMK, what could not be represented, and
  // where the default lives in the pinned tree; the client shows that attribution
  // rather than presenting QMK's choices as the user's own.
  app.get<{ Params: WildcardParams; Querystring: DefaultKeymapQuery }>(
    '/v1/catalog/:catalogVersion/default-keymap/*',
    async (request, reply) => {
      const version = resolveVersion(store, request.params.catalogVersion);
      const keyboardId = request.params['*'];
      if (!isValidKeyboardIdShape(keyboardId)) {
        return sendBadRequest(reply, 'keyboardId is not a valid keyboard identifier');
      }
      const keyboard = store.getSupportedKeyboard(version, keyboardId);
      if (!keyboard) {
        return sendNotFound(reply, 'no such supported keyboard in this catalog version');
      }
      const layoutId = request.query.layout;
      if (typeof layoutId !== 'string' || layoutId === '') {
        return sendBadRequest(reply, 'layout query parameter is required');
      }
      if (!keyboard.layouts.some((l) => l.name === layoutId)) {
        return sendNotFound(reply, 'this keyboard has no such layout in this catalog version');
      }

      const meta = store.getMeta(version);
      const preset = request.query.preset;
      if (preset !== undefined) {
        if (typeof preset !== 'string' || !/^[a-z0-9_]{1,64}$/.test(preset)) {
          return sendBadRequest(reply, 'preset must be a community layout name');
        }
        // Offered when the keyboard declares the layout, or when the arrangement fits
        // this layout by physical key position well enough (same rows, most keys land).
        const declared = keyboard.communityLayouts?.some((c) => c.name === preset) ?? false;
        const keymap = meta.communityKeymaps[preset];
        const layout = keyboard.layouts.find((l) => l.name === layoutId)!;
        if (!keymap || (!declared && communityKeymapFit(layout, keymap) < 0.5)) {
          return sendNotFound(reply, 'this keyboard has no such layout preset in this catalog version');
        }
      }

      const result =
        preset === undefined
          ? importDefaultKeymap({ keyboard, layoutId, keycodeAliases: meta.keycodeAliases })
          : importCommunityKeymap({
              keyboard,
              layoutId,
              name: preset,
              communityKeymaps: meta.communityKeymaps,
              keycodeAliases: meta.keycodeAliases,
            });
      return reply.send({
        apiVersion: API_VERSION,
        catalogVersion: version,
        keyboardId,
        layoutId,
        ...(preset === undefined ? {} : { preset }),
        ...result,
      });
    },
  );

  app.setErrorHandler((error, _request, reply: FastifyReply) => {
    if (error instanceof CatalogNotFoundError) {
      return sendNotFound(reply, error.message);
    }
    app.log.error({ err: error }, 'unhandled API error');
    // Never leak an internal message to the client.
    return reply.code(500).send({
      apiVersion: API_VERSION,
      error: { code: 'INTERNAL_ERROR', message: 'internal error' },
    });
  });
}

/** Full detail for one keyboard: everything the renderer needs, nothing internal. */
function projectKeyboard(kb: SupportedCatalogKeyboard) {
  return {
    keyboardId: kb.keyboardId,
    supported: true as const,
    displayName: kb.displayName,
    manufacturer: kb.manufacturer,
    url: kb.url,
    processor: kb.processor,
    bootloader: kb.bootloader,
    platform: kb.platform,
    features: kb.features,
    layouts: kb.layouts.map((layout) => ({
      name: layout.name,
      positionCount: layout.positions.length,
      positions: layout.positions,
    })),
    // Standard arrangements QMK ships a keymap for and this keyboard supports (v3 catalogs).
    communityLayouts: kb.communityLayouts ?? [],
    provenance: {
      keyboardFolder: kb.provenance.keyboardFolder,
      qmkCommit: kb.provenance.qmkCommit,
      parseWarnings: kb.provenance.parseWarnings,
    },
  };
}
