import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import { ApiError, toApiError } from '../src/api/client';

function axiosErr(status?: number, data?: unknown) {
  const config = { headers: new AxiosHeaders() };
  const response = status === undefined ? undefined : { status, statusText: '', data, headers: {}, config };
  return new AxiosError('boom', 'ERR', config, undefined, response);
}

describe('toApiError', () => {
  it('uses the backend { error: { code, message } } body', () => {
    const e = toApiError(axiosErr(409, { error: { code: 'COLLECTION_IN_PROGRESS', message: 'A collection is already running' } }));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(409);
    expect(e.code).toBe('COLLECTION_IN_PROGRESS');
    expect(e.message).toBe('A collection is already running');
  });
  it('explains a network failure (backend not running)', () => {
    const e = toApiError(axiosErr());
    expect(e.code).toBe('NETWORK');
    expect(e.message).toMatch(/port 4000/);
  });
  it('falls back to the HTTP status when the body has no error object', () => {
    expect(toApiError(axiosErr(502, '<html>')).message).toBe('Request failed (HTTP 502)');
  });
  it('wraps non-Axios errors', () => {
    expect(toApiError(new Error('x')).message).toBe('x');
  });
});
