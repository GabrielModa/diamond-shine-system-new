import type { Session } from './types';

let unauthorizedHandler: (() => void | Promise<void>) | null = null;

export function registerUnauthorizedHandler(handler: (() => void | Promise<void>) | null) {
  unauthorizedHandler = handler;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isNetworkApiError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 0;
}

export function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/$/, '');
}

type ApiPayload<T> = { ok?: boolean; data?: T; error?: string; code?: string; details?: unknown };

async function requestJson<T>(session: Pick<Session, 'accessToken' | 'baseUrl'>, path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeoutMs = init?.body instanceof FormData ? 45_000 : 15_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(`${normalizeBaseUrl(session.baseUrl)}${path}`, {
        ...init,
        signal: init?.signal ?? controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
          ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...init?.headers,
        },
      });
    } catch (cause) {
      const message = cause instanceof Error && cause.name === 'AbortError'
        ? 'The company server did not respond in time.'
        : 'The company server is unreachable.';
      throw new ApiError(message, 0, 'NETWORK_UNREACHABLE', cause);
    }
    const payload = await response.json().catch(() => null) as ApiPayload<T> | null;
    if (response.status === 401 && unauthorizedHandler) void unauthorizedHandler();
    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

export async function apiFetch<T>(session: Pick<Session, 'accessToken' | 'baseUrl'>, path: string, init?: RequestInit): Promise<T> {
  const { response, payload } = await requestJson<T>(session, path, init);
  if (!response.ok || payload?.ok === false) {
    throw new ApiError(payload?.error ?? 'Unable to reach Diamond Shine.', response.status, payload?.code, payload?.details);
  }
  return (payload?.data ?? payload) as T;
}

export async function apiFetchSyncBatch<T>(session: Pick<Session, 'accessToken' | 'baseUrl'>, path: string, init?: RequestInit): Promise<T> {
  const { response, payload } = await requestJson<T>(session, path, init);
  // /api/sync intentionally returns 207 + ok:false when only part of a batch conflicts.
  // The mobile queue must inspect every result and preserve successful operations.
  if (response.status === 207 && payload) return payload as T;
  if (!response.ok || payload?.ok === false) {
    throw new ApiError(payload?.error ?? 'Unable to synchronize saved changes.', response.status, payload?.code, payload?.details);
  }
  return (payload?.data ?? payload) as T;
}

export async function canReachCompanyServer(baseUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/health/live`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
