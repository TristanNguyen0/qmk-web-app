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
    code: ErrorCode | 'BAD_REQUEST' | 'NOT_FOUND' | 'INTERNAL_ERROR';
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

export { DomainError };
