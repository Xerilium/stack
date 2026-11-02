import { LifecycleError } from '../core/lifecycle';
import { TriageBlocked, TriageDenied } from '../core/triage';
import { ConflictError, NotFoundError, PathError, StorageError } from '../core/storage';
import { InboxFull } from '../core/inbox';

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Every code the API can return; the OpenAPI error enum is generated from this. */
export const ERROR_CODES = [
  'bad_request', 'unauthorized', 'forbidden', 'not_found', 'method_not_allowed', 'conflict',
  'payload_too_large', 'unsupported_media_type', 'invalid', 'internal',
] as const;

export interface Issue { field: string; message: string }

export const STATUS: Record<ErrorCode, number> = {
  bad_request: 400, unauthorized: 401, forbidden: 403, not_found: 404, method_not_allowed: 405, conflict: 409,
  payload_too_large: 413, unsupported_media_type: 415, invalid: 422, internal: 500,
};

/** @req FR:api/errors.codes */
export class ApiError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly details?: Issue[], readonly headers: Record<string, string> = {}) {
    super(message);
    this.status = STATUS[code];
  }
}

/** @req FR:api/errors.validation */
export const invalid = (issues: Issue[]) => new ApiError('invalid', 'Validation failed', issues);

/** @req FR:api/errors.map */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof NotFoundError) return new ApiError('not_found', 'Not found');
  if (e instanceof InboxFull) return new ApiError('conflict', e.message);
  if (e instanceof ConflictError) return new ApiError('conflict', 'Conflict');
  if (e instanceof PathError) return new ApiError('bad_request', 'Invalid path');
  // These two carry fixed text written in the core, never row content.
  if (e instanceof TriageDenied) return new ApiError('forbidden', e.message);
  if (e instanceof TriageBlocked) return new ApiError('conflict', e.message);
  // Core messages can quote file content or user input, so clients only get fixed text.
  if (e instanceof LifecycleError) return /not found/i.test(e.message) ? new ApiError('not_found', 'Not found') : new ApiError('invalid', 'Request cannot be applied');
  return new ApiError('internal', 'Internal error');
}

/**
 * The one route that relays a storage message: a flush failure names the path or says why the push failed, which the
 * owner needs to act (live-deploy FR:sync.flush.error). The message comes from Stack's own code and git, never from row
 * content; urls (remote addresses) are scrubbed anyway. Everything else keeps the fixed-text rule of `toApiError`.
 * @req FR:live-deploy/sync.flush.error
 */
export function flushError(e: unknown): ApiError {
  const words = (m: string) => m.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>');
  if (e instanceof ConflictError) return new ApiError('conflict', words(e.message));
  if (e instanceof StorageError) return new ApiError('internal', words(e.message));
  return toApiError(e);
}

/** @req FR:api/errors.shape @req FR:api/compact.cache */
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function errorResponse(e: ApiError): Response {
  return json(e.status, { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }, e.headers);
}
