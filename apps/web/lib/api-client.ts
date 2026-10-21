'use client';

export type ApiResult =
  | { kind: 'response'; response: Response }
  | { kind: 'auth-expired' }
  | { kind: 'network-error' }
  | { kind: 'mutation-not-retried'; response: Response };

type RefreshResult = 'refreshed' | 'auth-expired' | 'network-error';

// This module is browser-only. A pending rotation is shared by requests in one tab.
let refreshInFlight: Promise<RefreshResult> | null = null;
let refreshGeneration = 0;

function apiOrigin(): string {
  if (typeof window === 'undefined') {
    throw new Error('apiRequest must be called in the browser');
  }

  const origin = process.env.NEXT_PUBLIC_API_ORIGIN
    ?? (process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : undefined);
  if (!origin) throw new Error('NEXT_PUBLIC_API_ORIGIN is required');
  return origin;
}

async function refreshSession(origin: string): Promise<RefreshResult> {
  try {
    const response = await fetch(new URL('/auth/refresh', origin), {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) return 'auth-expired';
    refreshGeneration += 1;
    return 'refreshed';
  } catch {
    return 'network-error';
  }
}

function sharedRefresh(origin: string): Promise<RefreshResult> {
  if (refreshInFlight) return refreshInFlight;

  const pending = refreshSession(origin);
  refreshInFlight = pending;
  void pending.then(() => {
    if (refreshInFlight === pending) refreshInFlight = null;
  });
  return pending;
}

/** Make a browser request to an API-relative path, refreshing once after a 401. */
export async function apiRequest(path: string, init: RequestInit = {}): Promise<ApiResult> {
  const origin = apiOrigin();
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('apiRequest requires an API-relative path');
  }

  const url = new URL(path, origin);
  if (url.origin !== new URL(origin).origin) {
    throw new Error('apiRequest path must stay on the configured API origin');
  }

  const request = new Request(url, { ...init, credentials: 'include' });
  const replayable = (request.method === 'GET' || request.method === 'HEAD') && request.body === null;
  const retryRequest = replayable ? request.clone() : null;
  const generationAtStart = refreshGeneration;

  let response: Response;
  try {
    response = await fetch(request);
  } catch {
    return { kind: 'network-error' };
  }

  if (response.status !== 401 || url.pathname === '/auth/refresh' || url.pathname === '/auth/login') {
    return { kind: 'response', response };
  }

  // A concurrent request may return its stale 401 after another request has refreshed.
  if (generationAtStart === refreshGeneration) {
    const refresh = await sharedRefresh(origin);
    if (refresh !== 'refreshed') return { kind: refresh };
  }

  if (!retryRequest) return { kind: 'mutation-not-retried', response };

  try {
    const retryResponse = await fetch(retryRequest);
    return retryResponse.status === 401
      ? { kind: 'auth-expired' }
      : { kind: 'response', response: retryResponse };
  } catch {
    return { kind: 'network-error' };
  }
}