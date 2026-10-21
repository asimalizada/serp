import { createClientSchema } from '@serp/shared';
import { z } from 'zod';
import type { ApiResult } from './api-client';

const createdClientSchema = z.object({
  client: z.object({
    id: z.uuid(),
    name: z.string(),
    websiteUrl: z.url(),
    normalizedDomain: z.string(),
  }),
  crawlRun: z.object({ id: z.uuid(), status: z.number().int().min(0).max(3) }),
});

const crawlStatusSchema = z.object({
  clientId: z.uuid(),
  crawlRun: z.object({
    id: z.uuid(),
    status: z.number().int().min(0).max(3),
    error: z.string().nullable(),
    processedPages: z.number().int().nonnegative(),
    failedPages: z.number().int().nonnegative(),
  }).nullable(),
});

export type CreatedClient = z.infer<typeof createdClientSchema>;
export type CrawlStatus = z.infer<typeof crawlStatusSchema>;

export type CreateClientResult =
  | { kind: 'success'; data: CreatedClient }
  | { kind: 'duplicate' }
  | { kind: 'validation-error' }
  | { kind: 'auth-expired' }
  | { kind: 'resubmit-required' }
  | { kind: 'uncertain' }
  | { kind: 'invalid-response' };

export type CrawlStatusResult =
  | { kind: 'success'; data: CrawlStatus }
  | { kind: 'auth-expired' }
  | { kind: 'unavailable' };

export function validateClientWebsiteUrl(value: string): string | null {
  if (!createClientSchema.safeParse({ websiteUrl: value }).success) {
    return 'Enter a valid website URL, including http:// or https://.';
  }
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port))) {
    return 'Use an HTTP or HTTPS URL without credentials or a custom port.';
  }
  return null;
}

export async function createClient(
  request: (path: string, init: RequestInit) => Promise<ApiResult>,
  websiteUrl: string,
): Promise<CreateClientResult> {
  try {
    const result = await request('/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl }),
    });
    if (result.kind === 'auth-expired') return { kind: 'auth-expired' };
    if (result.kind === 'mutation-not-retried') return { kind: 'resubmit-required' };
    if (result.kind !== 'response') return { kind: 'uncertain' };
    if (result.response.status === 409) return { kind: 'duplicate' };
    if (result.response.status === 400) return { kind: 'validation-error' };
    if (result.response.status === 401) return { kind: 'auth-expired' };
    if (result.response.status !== 202) return { kind: 'uncertain' };
    const parsed = createdClientSchema.safeParse(await result.response.json());
    return parsed.success ? { kind: 'success', data: parsed.data } : { kind: 'invalid-response' };
  } catch {
    return { kind: 'uncertain' };
  }
}

export async function loadCrawlStatus(
  request: (path: string) => Promise<ApiResult>,
  clientId: string,
): Promise<CrawlStatusResult> {
  try {
    const result = await request(`/clients/${clientId}/crawl-status`);
    if (result.kind === 'auth-expired') return { kind: 'auth-expired' };
    if (result.kind === 'response' && result.response.status === 401) return { kind: 'auth-expired' };
    if (result.kind !== 'response' || !result.response.ok) return { kind: 'unavailable' };
    const parsed = crawlStatusSchema.safeParse(await result.response.json());
    return parsed.success && parsed.data.clientId === clientId
      ? { kind: 'success', data: parsed.data }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}