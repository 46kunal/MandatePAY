/**
 * Fetch wrapper for the UI. Calls the real API and nothing else: an error is thrown as ApiClientError so each
 * screen can show what actually went wrong. There is no sample data to fall back to.
 */
import type { ApiError } from '@/contracts/schemas';

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public body: Partial<ApiError>,
  ) {
    super(body.message ?? body.error ?? `HTTP ${status}`);
  }
}

export interface ApiResult<T> {
  data: T;
}

export async function apiFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<ApiResult<T>> {
  const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new ApiClientError(0, { error: 'network_error', message: 'Could not reach the server. Is it running?' });
  }

  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const body = (json && typeof json === 'object' ? json : { error: `http_${res.status}` }) as Partial<ApiError>;
    throw new ApiClientError(res.status, body);
  }
  return { data: json as T };
}
