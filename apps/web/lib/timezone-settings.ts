import { updateTimezoneSchema } from '@serp/shared';
import { z } from 'zod';
import type { ApiResult } from './api-client';
import type { AuthUser } from './session-response';

const responseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    timezone: z.string().min(1),
  }),
});

export type TimezoneUpdateResult =
  | { kind: 'success'; user: AuthUser }
  | { kind: 'invalid-timezone' }
  | { kind: 'auth-expired' }
  | { kind: 'resubmit-required' }
  | { kind: 'unavailable' }
  | { kind: 'uncertain' };

export function timezoneValidationError(timezone: string): string | null {
  const parsed = updateTimezoneSchema.safeParse({ timezone });
  return parsed.success ? null : parsed.error.issues[0]?.message ?? 'Invalid timezone';
}

export function timezoneDisplayName(timezone: string): string {
  return timezone.split('/').reverse().map((part) => part.replaceAll('_', ' ')).join(' · ');
}

export async function updateTimezone(
  request: (path: string, init: RequestInit) => Promise<ApiResult>,
  timezone: string,
  expectedUserId: string,
): Promise<TimezoneUpdateResult> {
  try {
    const result = await request('/users/me/timezone', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone }),
    });
    if (result.kind === 'auth-expired') return { kind: 'auth-expired' };
    if (result.kind === 'mutation-not-retried') return { kind: 'resubmit-required' };
    if (result.kind === 'server-error') return { kind: 'unavailable' };
    if (result.kind !== 'response') return { kind: 'uncertain' };
    if (result.response.status === 400) return { kind: 'invalid-timezone' };
    if (result.response.status === 401) return { kind: 'auth-expired' };
    if (!result.response.ok) return { kind: 'uncertain' };

    const parsed = responseSchema.safeParse(await result.response.json());
    return parsed.success && parsed.data.user.id === expectedUserId && parsed.data.user.timezone === timezone
      ? { kind: 'success', user: parsed.data.user }
      : { kind: 'uncertain' };
  } catch {
    return { kind: 'uncertain' };
  }
}