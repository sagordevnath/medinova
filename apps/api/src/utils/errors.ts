/** Structured API error carrying an i18n key + HTTP status. */
export class ApiError extends Error {
  readonly status: number;
  readonly key: string;
  readonly details?: unknown;

  constructor(status: number, key: string, details?: unknown) {
    super(key);
    this.name = 'ApiError';
    this.status = status;
    this.key = key;
    this.details = details;
  }

  static badRequest(key = 'errors.validation', details?: unknown): ApiError {
    return new ApiError(400, key, details);
  }
  static unauthorized(key = 'errors.unauthorized'): ApiError {
    return new ApiError(401, key);
  }
  static forbidden(key = 'errors.forbidden'): ApiError {
    return new ApiError(403, key);
  }
  static notFound(key = 'errors.notFound'): ApiError {
    return new ApiError(404, key);
  }
  static conflict(key = 'errors.conflict'): ApiError {
    return new ApiError(409, key);
  }
  static upstream(key = 'errors.upstream', details?: unknown): ApiError {
    return new ApiError(502, key, details);
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
