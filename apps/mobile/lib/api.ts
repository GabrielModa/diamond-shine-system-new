import type { Session } from './types';

let unauthorizedHandler: (() => void | Promise<void>) | null = null;

export function registerUnauthorizedHandler(handler: (() => void | Promise<void>) | null) {
  unauthorizedHandler = handler;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: unknown) {
    super(message);
  }
}

export function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/$/, '');
}

export async function apiFetch<T>(session: Pick<Session, 'accessToken' | 'baseUrl'>, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${normalizeBaseUrl(session.baseUrl)}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string; code?: string; details?: unknown } | null;
  if (!response.ok || payload?.ok === false) {
    if (response.status === 401 && unauthorizedHandler) void unauthorizedHandler();
    throw new ApiError(payload?.error ?? 'Unable to reach Diamond Shine.', response.status, payload?.code, payload?.details);
  }
  return (payload?.data ?? payload) as T;
}
