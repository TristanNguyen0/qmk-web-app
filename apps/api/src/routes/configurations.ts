/**
 * Configuration read/write routes.
 *
 * claude.md § API/interface expectations, applied here:
 *  - Server-side validation on every write, regardless of client validation.
 *  - Optimistic concurrency via ETag / `If-Match` on updates.
 *  - Every read and write authorized by ownership.
 *  - Versioned payloads.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { DomainError, ERROR_CODES } from '@qmk-web-app/domain';
import type { CatalogStore } from '../catalog-store.ts';
import { API_VERSION, sendBadRequest, sendDomainError, sendNotFound } from '../errors.ts';
import { createRecord, nextDocument } from '../configurations/service.ts';
import {
  RevisionConflictError,
  summarize,
  type ConfigurationInput,
  type ConfigurationRecord,
  type ConfigurationRepository,
} from '../configurations/types.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PAGE_SIZE = 100;

interface IdParams {
  id: string;
}

/** ETag is the revision. Quoted per RFC 9110. */
function etagFor(record: ConfigurationRecord): string {
  return `"${record.revision}"`;
}

/**
 * Reads the expected revision from `If-Match`. Required on updates: without it a
 * client would blindly overwrite whatever is stored, which is precisely the silent
 * overwrite claude.md requires us to prevent.
 */
function parseIfMatch(header: string | undefined): number | null {
  if (!header) return null;
  const match = /^"?(\d{1,9})"?$/.exec(header.trim());
  return match ? Number(match[1]) : null;
}

function projectRecord(record: ConfigurationRecord) {
  return {
    id: record.id,
    name: record.name,
    keyboardId: record.keyboardId,
    layoutId: record.layoutId,
    catalogVersion: record.catalogVersion,
    qmkCommit: record.qmkCommit,
    revision: record.revision,
    isDraft: record.isDraft,
    schemaVersion: record.schemaVersion,
    generatorVersion: record.generatorVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    // `ownerId` is deliberately NOT returned: it is a server-side concept, and
    // echoing it invites clients to try to set it.
    layers: record.document.layers,
    macros: record.document.macros,
    socd: record.document.socd,
  };
}

function asInput(body: unknown): ConfigurationInput {
  if (typeof body !== 'object' || body === null) {
    throw new DomainError(ERROR_CODES.CONFIG_INVALID, 'request body must be an object');
  }
  const b = body as Record<string, unknown>;
  // Only these fields are read. Anything else the client sends — `ownerId`,
  // `revision`, `id` — is ignored rather than merged.
  return {
    name: b['name'] as string,
    catalogVersion: b['catalogVersion'] as string,
    qmkCommit: b['qmkCommit'] as string,
    keyboardId: b['keyboardId'] as string,
    layoutId: b['layoutId'] as string,
    layers: b['layers'],
    macros: b['macros'] ?? [],
    socd: b['socd'] ?? null,
  };
}

export function registerConfigurationRoutes(
  app: FastifyInstance,
  store: CatalogStore,
  repository: ConfigurationRepository,
): void {
  app.post('/v1/configurations', async (request, reply) => {
    try {
      const record = createRecord(store, asInput(request.body), request.ownerId);
      const created = await repository.create({ record });
      return reply
        .code(201)
        .header('etag', etagFor(created))
        .header('location', `/v1/configurations/${created.id}`)
        .send({ apiVersion: API_VERSION, configuration: projectRecord(created) });
    } catch (error) {
      if (error instanceof DomainError) return sendDomainError(reply, error);
      throw error;
    }
  });

  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    '/v1/configurations',
    async (request, reply) => {
      const page = Number(request.query.page ?? '1');
      const pageSize = Number(request.query.pageSize ?? '20');
      if (!Number.isInteger(page) || page < 1) {
        return sendBadRequest(reply, 'page must be a positive integer');
      }
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        return sendBadRequest(reply, `pageSize must be between 1 and ${MAX_PAGE_SIZE}`);
      }
      // Scoped to this session's owner id inside the repository.
      const result = await repository.list(request.ownerId, { page, pageSize });
      return reply.send({ apiVersion: API_VERSION, ...result });
    },
  );

  app.get<{ Params: IdParams }>('/v1/configurations/:id', async (request, reply) => {
    if (!UUID_RE.test(request.params.id)) {
      return sendBadRequest(reply, 'id must be a UUID');
    }
    const record = await repository.get(request.params.id, request.ownerId);
    // Another owner's configuration is reported as missing, not forbidden, so the
    // response cannot be used to discover that an id exists.
    if (!record) return sendNotFound(reply, 'no such configuration');

    return reply
      .header('etag', etagFor(record))
      .send({ apiVersion: API_VERSION, configuration: projectRecord(record) });
  });

  app.put<{ Params: IdParams }>('/v1/configurations/:id', async (request, reply) => {
    if (!UUID_RE.test(request.params.id)) {
      return sendBadRequest(reply, 'id must be a UUID');
    }

    const expectedRevision = parseIfMatch(request.headers['if-match']);
    if (expectedRevision === null) {
      return reply.code(428).send({
        apiVersion: API_VERSION,
        error: {
          code: 'BAD_REQUEST',
          message: 'If-Match header with the current revision is required for updates',
        },
      });
    }

    try {
      const input = asInput(request.body);
      const updated = await repository.update({
        id: request.params.id,
        ownerId: request.ownerId,
        expectedRevision,
        // Validation runs inside the update transaction, against the record actually
        // stored — not against whatever the client last read.
        next: (current) => nextDocument(store, current, input, request.ownerId),
      });

      if (!updated) return sendNotFound(reply, 'no such configuration');

      return reply
        .header('etag', etagFor(updated))
        .send({ apiVersion: API_VERSION, configuration: projectRecord(updated) });
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        return reply.code(409).send({
          apiVersion: API_VERSION,
          error: {
            code: ERROR_CODES.CONFIG_CONFLICT,
            message:
              'this configuration was modified by another request; reload it and reapply your change',
          },
          currentRevision: error.currentRevision,
        });
      }
      if (error instanceof DomainError) return sendDomainError(reply, error);
      throw error;
    }
  });

  app.delete<{ Params: IdParams }>('/v1/configurations/:id', async (request, reply: FastifyReply) => {
    if (!UUID_RE.test(request.params.id)) {
      return sendBadRequest(reply, 'id must be a UUID');
    }
    const deleted = await repository.delete(request.params.id, request.ownerId);
    if (!deleted) return sendNotFound(reply, 'no such configuration');
    return reply.code(204).send();
  });

  // Immutable history. A build cites an exact revision, so this is how a client
  // inspects what a given build was produced from.
  app.get<{ Params: IdParams & { revision: string } }>(
    '/v1/configurations/:id/revisions/:revision',
    async (request, reply) => {
      if (!UUID_RE.test(request.params.id)) {
        return sendBadRequest(reply, 'id must be a UUID');
      }
      const revision = Number(request.params.revision);
      if (!Number.isInteger(revision) || revision < 1) {
        return sendBadRequest(reply, 'revision must be a positive integer');
      }
      const stored = await repository.getRevision(request.params.id, request.ownerId, revision);
      if (!stored) return sendNotFound(reply, 'no such configuration revision');
      return reply.send({ apiVersion: API_VERSION, revision, ...stored });
    },
  );
}

export { summarize };
