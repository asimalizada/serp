import type { ApiResult } from './api-client';

export type AuthUser = { id: string; email: string; timezone: string };

export type SessionCheck =
  | { kind: 'authenticated'; user: AuthUser }
  | { kind: 'unauthenticated' }
  | { kind: 'unavailable'; reason: 'network' | 'server' };

function isAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Record<string, unknown>;
  return typeof user.id === 'string' && user.id.length > 0
    && typeof user.email === 'string' && user.email.length > 0
    && typeof user.timezone === 'string' && user.timezone.length > 0;
}

export async function resolveSession(result: ApiResult): Promise<SessionCheck> {
  if (result.kind === 'auth-expired') return { kind: 'unauthenticated' };
  if (result.kind === 'network-error') return { kind: 'unavailable', reason: 'network' };
  if (result.kind !== 'response') return { kind: 'unavailable', reason: 'server' };
  if (result.response.status === 401) return { kind: 'unauthenticated' };
  if (!result.response.ok) return { kind: 'unavailable', reason: 'server' };

  try {
    const body: unknown = await result.response.json();
    if (body && typeof body === 'object' && 'user' in body && isAuthUser(body.user)) {
      return { kind: 'authenticated', user: body.user };
    }
  } catch {
    // An unexpected response shape is an API error, not proof of logout.
  }
  return { kind: 'unavailable', reason: 'server' };
}