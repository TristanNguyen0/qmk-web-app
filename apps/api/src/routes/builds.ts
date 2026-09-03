/**
 * Build request, status, log, and artifact download routes.
 *
 * claude.md § API/interface expectations and § Error handling, applied here:
 *  - build creation is idempotent on a client-supplied key;
 *  - every read is authorized by ownership, and another owner's build is reported as
 *    missing rather than forbidden, so ids cannot be probed;
 *  - a download is served by the API from storage, never as a storage key or a
 *    redirect a client could reuse or share;
 *  - a compile failure is never presented as a firmware that can be flashed.
 */
import type { FastifyInstance } from 'fastify';
import { assertValidKey, type ArtifactStore } from '@qmk-web-app/artifact-store';
import { DomainError, ERROR_CODES } from '@qmk-web-app/domain';
import type { CatalogStore } from '../catalog-store.ts';
import type { ConfigurationRepository } from '../configurations/types.ts';
import { API_VERSION, sendBadRequest, sendDomainError, sendNotFound } from '../errors.ts';
import {
  assertWithinQuota,
  prepareBuild,
  IDEMPOTENCY_KEY_RE,
  type BuildEnvironment,
} from '../builds/service.ts';
import type { BuildAdmissionCap, BuildRepository } from '@qmk-web-app/build-queue';

/**
 * The three admission-rejection strings a caller can see. Exported so tests can
 * compare against these rather than hard-coding prose, and so a future call site
 * reuses the exact wording rather than drifting from it.
 *
 * `globalCapacityMessage` deliberately says nothing about the caller's own build
 * count or any personal quota — the global cap is not the caller's doing, and telling
 * them otherwise would misattribute the rejection (claude.md § Build isolation and
 * security).
 */
export function globalCapacityMessage(): string {
  return 'the build queue is full; try again shortly';
}

export function ownerConcurrencyMessage(observed: number): string {
  return `you already have ${observed} builds queued or running; wait for one to finish or cancel it`;
}

export function ownerHourlyMessage(): string {
  return 'you have reached the hourly build limit; try again later';
}

function admissionRejectionMessage(cap: BuildAdmissionCap, observed: number): string {
  switch (cap) {
    case 'global_active':
      return globalCapacityMessage();
    case 'owner_active':
      return ownerConcurrencyMessage(observed);
    case 'owner_hourly':
      return ownerHourlyMessage();
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PAGE_SIZE = 100;

/**
 * Firmware filenames are produced by the generator from validated catalog data, so
 * they are already constrained — but this one crosses into a response header, where a
 * stray quote or newline would be a header injection. Checked at the boundary.
 */
const SAFE_FILENAME_RE = /^[A-Za-z0-9._-]{1,120}$/;

export interface BuildRoutesOptions {
  store: CatalogStore;
  configurations: ConfigurationRepository;
  builds: BuildRepository;
  artifacts: ArtifactStore;
  environment: BuildEnvironment;
}

interface IdParams {
  id: string;
}

export function registerBuildRoutes(app: FastifyInstance, options: BuildRoutesOptions): void {
  const { store, configurations, builds, artifacts } = options;

  app.post<{ Params: IdParams }>(
    '/v1/configurations/:id/builds',
    async (request, reply) => {
      if (!UUID_RE.test(request.params.id)) {
        return sendBadRequest(reply, 'id must be a UUID');
      }

      const idempotencyKey = request.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
        // Required rather than optional: without it a retried request — a refreshed
        // page, a flaky connection — silently starts a second compile.
        return sendBadRequest(
          reply,
          'an Idempotency-Key header of 8-128 characters from [A-Za-z0-9._:-] is required',
        );
      }

      const configuration = await configurations.get(request.params.id, request.ownerId);
      if (!configuration) return sendNotFound(reply, 'no such configuration');

      try {
        await assertWithinQuota(builds, request.ownerId);

        const record = prepareBuild(store, {
          configuration,
          ownerId: request.ownerId,
          idempotencyKey,
          environment: options.environment,
        });

        const result = await builds.create(record);
        if (result.outcome === 'rejected') {
          throw new DomainError(
            ERROR_CODES.BUILD_QUEUE_LIMITED,
            admissionRejectionMessage(result.cap, result.observed),
          );
        }

        const summary = await builds.summarize(result.build, request.ownerId);

        // 200 on a replay makes the retry visible to the client rather than looking
        // like a second build was accepted.
        return reply
          .code(result.outcome === 'created' ? 201 : 200)
          .header('location', `/v1/builds/${result.build.id}`)
          .send({ apiVersion: API_VERSION, build: summary });
      } catch (error) {
        if (error instanceof DomainError) return sendDomainError(reply, error);
        throw error;
      }
    },
  );

  app.get<{ Params: IdParams; Querystring: { page?: string; pageSize?: string } }>(
    '/v1/configurations/:id/builds',
    async (request, reply) => {
      if (!UUID_RE.test(request.params.id)) {
        return sendBadRequest(reply, 'id must be a UUID');
      }
      const page = Number(request.query.page ?? '1');
      const pageSize = Number(request.query.pageSize ?? '20');
      if (!Number.isInteger(page) || page < 1) {
        return sendBadRequest(reply, 'page must be a positive integer');
      }
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        return sendBadRequest(reply, `pageSize must be between 1 and ${MAX_PAGE_SIZE}`);
      }

      const result = await builds.listForConfiguration(request.params.id, request.ownerId, {
        page,
        pageSize,
      });
      return reply.send({ apiVersion: API_VERSION, ...result });
    },
  );

  app.get<{ Params: IdParams }>('/v1/builds/:id', async (request, reply) => {
    const build = await requireBuild(request.params.id, request.ownerId);
    if (!build) return sendNotFound(reply, 'no such build');
    return reply.send({
      apiVersion: API_VERSION,
      build: await builds.summarize(build, request.ownerId),
    });
  });

  app.post<{ Params: IdParams }>('/v1/builds/:id/cancel', async (request, reply) => {
    if (!UUID_RE.test(request.params.id)) {
      return sendBadRequest(reply, 'id must be a UUID');
    }
    const outcome = await builds.requestCancellation(request.params.id, request.ownerId);
    if (!outcome) return sendNotFound(reply, 'no such build');

    const build = await builds.get(request.params.id, request.ownerId);
    return reply.code(outcome === 'requested' ? 202 : 200).send({
      apiVersion: API_VERSION,
      outcome,
      build: build ? await builds.summarize(build, request.ownerId) : null,
    });
  });

  /**
   * The sanitized build log. claude.md § Error handling: raw compiler output stays
   * available "only to the owner/authorized support role", already redacted and capped
   * by the worker before it was ever stored.
   */
  app.get<{ Params: IdParams }>('/v1/builds/:id/log', async (request, reply) => {
    const build = await requireBuild(request.params.id, request.ownerId);
    if (!build) return sendNotFound(reply, 'no such build');

    if (!build.logReference) {
      return sendNotFound(reply, 'this build has no log, or its log has been deleted');
    }

    assertValidKey(build.logReference);
    const contents = await artifacts.get(build.logReference);
    if (!contents) {
      return sendNotFound(reply, 'this build has no log, or its log has been deleted');
    }

    return reply
      .header('content-type', 'text/plain; charset=utf-8')
      // The log is text, and a browser must never be talked into rendering it as HTML.
      .header('content-disposition', `attachment; filename="build-${build.id}.log"`)
      .send(contents);
  });

  app.get<{ Params: IdParams }>('/v1/builds/:id/artifact', async (request, reply) => {
    const build = await requireBuild(request.params.id, request.ownerId);
    if (!build) return sendNotFound(reply, 'no such build');

    // A build that did not succeed has nothing to download. Saying so explicitly is
    // the § Error handling requirement not to present a failure as flashable firmware.
    if (build.status !== 'succeeded') {
      return sendDomainError(
        reply,
        new DomainError(
          ERROR_CODES.ARTIFACT_MISSING,
          build.status === 'expired'
            ? 'this build’s firmware has expired; rebuild to get a fresh one'
            : `this build is ${build.status} and has no firmware to download`,
        ),
      );
    }

    const artifact = await builds.getArtifact(build.id, request.ownerId);
    if (!artifact) {
      return sendDomainError(
        reply,
        new DomainError(ERROR_CODES.ARTIFACT_MISSING, 'this build has no stored firmware'),
      );
    }

    if (Date.parse(artifact.expiresAt) <= Date.now()) {
      return sendDomainError(
        reply,
        new DomainError(
          ERROR_CODES.ARTIFACT_EXPIRED,
          'this build’s firmware has expired; rebuild to get a fresh one',
        ),
      );
    }

    if (!SAFE_FILENAME_RE.test(artifact.originalFilename)) {
      // Unreachable via the generator, and a 500 rather than a sanitised guess: an
      // unexpected filename means something upstream is not what we think it is.
      request.log.error({ buildId: build.id }, 'stored artifact filename failed validation');
      return reply.code(500).send({
        apiVersion: API_VERSION,
        error: { code: 'INTERNAL_ERROR', message: 'the stored firmware could not be served' },
      });
    }

    assertValidKey(artifact.storageKey);
    const contents = await artifacts.get(artifact.storageKey);
    if (!contents) {
      // The row exists but the blob does not — reaped mid-request, or a storage fault.
      return sendDomainError(
        reply,
        new DomainError(ERROR_CODES.ARTIFACT_MISSING, 'this build’s firmware is no longer stored'),
      );
    }

    return reply
      .header('content-type', artifact.contentType)
      .header('content-length', String(contents.byteLength))
      .header('content-disposition', `attachment; filename="${artifact.originalFilename}"`)
      // Lets a user verify the download against what the build recorded.
      .header('x-artifact-sha256', artifact.sha256)
      .send(contents);
  });

  /** Null for a malformed id, an unknown id, or another owner's build — all 404. */
  async function requireBuild(id: string, ownerId: string) {
    if (!UUID_RE.test(id)) return null;
    return builds.get(id, ownerId);
  }
}
