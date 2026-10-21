import { z } from 'zod';
import type { ApiResult } from './api-client';

export type ClientView = 'active' | 'archived';
export type ClientAction = 'archive' | 'unarchive' | 'recrawl';

const crawlSchema = z.object({
  id: z.uuid(), status: z.number().int().min(0).max(3),
  error: z.string().nullable(), processedPages: z.number().int().nonnegative(),
  failedPages: z.number().int().nonnegative(),
  createdAt: z.string(), startedAt: z.string().nullable(), finishedAt: z.string().nullable(),
});

const clientSchema = z.object({
  id: z.uuid(), name: z.string(), websiteUrl: z.url(),
  archivedAt: z.string().nullable(), pageCount: z.number().int().nonnegative(),
  latestCrawl: crawlSchema.nullable(),
});

const clientsSchema = z.object({ clients: z.array(clientSchema) });
const statusSchema = z.object({
  clientId: z.uuid(),
  crawlRun: crawlSchema.extend({
    pageFailures: z.array(z.object({
      url: z.string(), httpStatusCode: z.number().int().nullable(), reason: z.string().nullable(),
    })),
  }).nullable(),
});

export type ManagedClient = z.infer<typeof clientSchema>;
export type ClientFailureDetails = z.infer<typeof statusSchema>;
export type LoadClientsResult =
  | { kind: 'success'; clients: ManagedClient[] }
  | { kind: 'auth-expired' }
  | { kind: 'unavailable' };
export type ClientActionResult =
  | { kind: 'success' }
  | { kind: 'conflict' | 'not-found' | 'auth-expired' | 'resubmit-required' | 'unavailable' };

export async function loadManagedClients(
  request: (path: string) => Promise<ApiResult>, view: ClientView,
): Promise<LoadClientsResult> {
  try {
    const result = await request(view === 'active' ? '/clients' : '/clients?status=archived');
    if (result.kind === 'auth-expired') return { kind: 'auth-expired' };
    if (result.kind !== 'response') return { kind: 'unavailable' };
    if (result.response.status === 401) return { kind: 'auth-expired' };
    if (!result.response.ok) return { kind: 'unavailable' };
    const parsed = clientsSchema.safeParse(await result.response.json());
    return parsed.success ? { kind: 'success', clients: parsed.data.clients } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

export async function changeClient(
  request: (path: string, init: RequestInit) => Promise<ApiResult>,
  id: string, action: ClientAction,
): Promise<ClientActionResult> {
  const method = action === 'recrawl' ? 'POST' : 'PATCH';
  try {
    const result = await request(`/clients/${id}/${action}`, { method });
    if (result.kind === 'auth-expired') return { kind: 'auth-expired' };
    if (result.kind === 'mutation-not-retried') return { kind: 'resubmit-required' };
    if (result.kind !== 'response') return { kind: 'unavailable' };
    if (result.response.status === 401) return { kind: 'auth-expired' };
    if (result.response.status === 404) return { kind: 'not-found' };
    if (result.response.status === 409) return { kind: 'conflict' };
    if (result.response.status !== (action === 'recrawl' ? 202 : 200)) return { kind: 'unavailable' };
    return { kind: 'success' };
  } catch {
    return { kind: 'unavailable' };
  }
}

export async function loadClientFailureDetails(
  request: (path: string) => Promise<ApiResult>, id: string,
): Promise<{ kind: 'success'; data: ClientFailureDetails } | { kind: 'auth-expired' | 'unavailable' }> {
  try {
    const result = await request(`/clients/${id}/crawl-status`);
    if (result.kind === 'auth-expired') return { kind: 'auth-expired' };
    if (result.kind !== 'response') return { kind: 'unavailable' };
    if (result.response.status === 401) return { kind: 'auth-expired' };
    if (!result.response.ok) return { kind: 'unavailable' };
    const parsed = statusSchema.safeParse(await result.response.json());
    return parsed.success && parsed.data.clientId === id
      ? { kind: 'success', data: parsed.data } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}