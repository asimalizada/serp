import { z } from 'zod';
import type { PageListQueryOutput } from '@serp/shared';
import type { ApiResult } from './api-client';

export type PagesQuery = Pick<PageListQueryOutput, 'page' | 'search' | 'clientId'>;

export function pagesPath(query: PagesQuery): string {
  const params = new URLSearchParams({ page: String(query.page) });
  if (query.search) params.set('search', query.search);
  if (query.clientId) params.set('clientId', query.clientId);
  return `/pages?${params.toString()}`;
}

const pageListRowSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  url: z.url(),
  current: z.object({ title: z.string().nullable() }).nullable(),
  keywords: z.array(z.object({
    phrase: z.string(),
    relevanceScore: z.number().min(0).max(1),
  })),
  issueCount: z.number().int().nonnegative(),
  latestRank: z.object({ position: z.number().int().min(1).max(100) }).nullable(),
});

const pagesResponseSchema = z.object({
  items: z.array(pageListRowSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

const clientsResponseSchema = z.object({
  clients: z.array(z.object({
    id: z.uuid(),
    name: z.string(),
    websiteUrl: z.url(),
    normalizedDomain: z.string(),
  })),
});

export type PageListRow = z.infer<typeof pageListRowSchema>;
export type PagesResponse = z.infer<typeof pagesResponseSchema>;
export type ClientSummary = z.infer<typeof clientsResponseSchema>['clients'][number];

export type PagesResult =
  | { kind: 'success'; data: PagesResponse }
  | { kind: 'auth-expired' }
  | { kind: 'network-error' }
  | { kind: 'server-error' }
  | { kind: 'invalid-response' };

export type ClientsResult =
  | { kind: 'success'; clients: ClientSummary[] }
  | { kind: 'auth-expired' }
  | { kind: 'network-error' }
  | { kind: 'server-error' }
  | { kind: 'invalid-response' };

export async function loadPages(
  request: (path: string) => Promise<ApiResult>,
  query: PagesQuery = { page: 1 },
): Promise<PagesResult> {
  try {
    const result = await request(pagesPath(query));
    if (result.kind === 'auth-expired' || result.kind === 'network-error' || result.kind === 'server-error') {
      return { kind: result.kind };
    }
    if (result.kind !== 'response') return { kind: 'server-error' };
    if (result.response.status === 401) return { kind: 'auth-expired' };
    if (!result.response.ok) return { kind: 'server-error' };

    const parsed = pagesResponseSchema.safeParse(await result.response.json());
    if (!parsed.success || parsed.data.pagination.page !== query.page) return { kind: 'invalid-response' };
    return { kind: 'success', data: parsed.data };
  } catch {
    return { kind: 'invalid-response' };
  }
}

export async function loadClients(request: (path: string) => Promise<ApiResult>): Promise<ClientsResult> {
  try {
    const result = await request('/clients');
    if (result.kind === 'auth-expired' || result.kind === 'network-error' || result.kind === 'server-error') {
      return { kind: result.kind };
    }
    if (result.kind !== 'response') return { kind: 'server-error' };
    if (result.response.status === 401) return { kind: 'auth-expired' };
    if (!result.response.ok) return { kind: 'server-error' };

    const parsed = clientsResponseSchema.safeParse(await result.response.json());
    return parsed.success ? { kind: 'success', clients: parsed.data.clients } : { kind: 'invalid-response' };
  } catch {
    return { kind: 'invalid-response' };
  }
}