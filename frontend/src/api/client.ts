/**
 * Axios client for the CloudVM API. In development Vite proxies /api to the backend
 * (vite.config.ts), so no backend URL is hard-coded.
 */
import axios, { AxiosError } from 'axios';

export const api = axios.create({ baseURL: '/api/v1', timeout: 15_000 });

/** Normalized error carrying the backend's { error: { code, message } } shape. */
export class ApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  constructor(message: string, status: number | null, code: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof AxiosError) {
    const body = err.response?.data as { error?: { code?: string; message?: string } } | undefined;
    if (body?.error?.message) return new ApiError(body.error.message, err.response?.status ?? null, body.error.code ?? null);
    if (!err.response) return new ApiError('Cannot reach the CloudVM API – is the backend running on port 4000?', null, 'NETWORK');
    return new ApiError(`Request failed (HTTP ${err.response.status})`, err.response.status, null);
  }
  return new ApiError(err instanceof Error ? err.message : 'Unexpected error', null, null);
}
