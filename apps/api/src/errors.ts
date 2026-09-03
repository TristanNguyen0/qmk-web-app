/**
 * HTTP error mapping.
 *
 * claude.md § Error handling: stable, user-safe codes with no internal detail.
 * Every response body has the same shape so clients can handle errors uniformly.
 */
import type { FastifyReply } from 'fastify';
import { DomainError, ERROR_CODES, type ErrorCode, type FieldError } from '@qmk-web-app/domain';

export const API_VERSION = 1;

export interface ApiErrorBody {
  apiVersion: number;
  error: {
    // RATE_LIMITED is transport-level, not a domain ErrorCode: a session-issuance
    // refusal is not a build-queue condition, and reusing BUILD_QUEUE_LIMITED would
    // make that code a lie (see 05-05-PLAN.md planner_notes).
    code: ErrorCode | 'BAD_REQUEST' | 'NOT_FOUND' | 'INTERNAL_ERROR' | 'RATE_LIMITED';
    message: string;
    fieldErrors?: readonly FieldError[];
  };
}

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  [ERROR_CODES.CATALOG_KEYBOARD_UNAVAILABLE]: 404,
  [ERROR_CODES.CATALOG_LAYOUT_UNAVAILABLE]: 404,
  [ERROR_CODES.CONFIG_INVALID]: 422,
  [ERROR_CODES.CONFIG_CONFLICT]: 409,
  [ERROR_CODES.CAPABILITY_UNAVAILABLE]: 409,
  [ERROR_CODES.BUILD_QUEUE_LIMITED]: 429,
  [ERROR_CODES.ARTIFACT_MISSING]: 404,
  [ERROR_CODES.ARTIFACT_EXPIRED]: 410,
  [ERROR_CODES.ARTIFACT_UNAUTHORIZED]: 403,
};

export function sendDomainError(reply: FastifyReply, error: DomainError): FastifyReply {
  const status = STATUS_BY_CODE[error.code] ?? 400;
  const body: ApiErrorBody = {
    apiVersion: API_VERSION,
    error: {
      code: error.code,
      message: error.message,
      ...(error.fieldErrors.length > 0 ? { fieldErrors: error.fieldErrors } : {}),
    },
  };
  return reply.code(status).send(body);
}

export function sendNotFound(reply: FastifyReply, message: string): FastifyReply {
  const body: ApiErrorBody = {
    apiVersion: API_VERSION,
    error: { code: 'NOT_FOUND', message },
  };
  return reply.code(404).send(body);
}

export function sendBadRequest(
  reply: FastifyReply,
  message: string,
  fieldErrors?: readonly FieldError[],
): FastifyReply {
  const body: ApiErrorBody = {
    apiVersion: API_VERSION,
    error: { code: 'BAD_REQUEST', message, ...(fieldErrors ? { fieldErrors } : {}) },
  };
  return reply.code(400).send(body);
}

/**
 * A session-issuance refusal (D-12). Distinct from `sendBadRequest` and every domain
 * error: this is a transport-level condition, not something the client's request
 * shape or the domain model has an opinion about.
 */
export function sendRateLimited(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
  const body: ApiErrorBody = {
    apiVersion: API_VERSION,
    error: {
      code: 'RATE_LIMITED',
      message: 'too many session requests from this address; try again shortly',
    },
  };
  return reply.code(429).header('retry-after', String(retryAfterSeconds)).send(body);
}

export { DomainError };
