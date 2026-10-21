import { z } from 'zod';
import type { ApiResult } from './api-client';

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

export type PageListRow = z.infer<typeof pageListRowSchema>;
export type PagesResponse = z.infer<typeof pagesResponseSchema>;

export type PagesResult =
  | { kind: 'success'; data: PagesResponse }
  | { kind: 'auth-expired' }
  | { kind: 'network-error' }
  | { kind: 'server-error' }
  | { kind: 'invalid-response' };

export async function loadPages(request: (path: string) => Promise<ApiResult>): Promise<PagesResult> {
  try {
    const result = await request('/pages');
    if (result.kind === 'auth-expired' || result.kind === 'network-error' || result.kind === 'server-error') {
      return { kind: result.kind };
    }
    if (result.kind !== 'response') return { kind: 'server-error' };
    if (result.response.status === 401) return { kind: 'auth-expired' };
    if (!result.response.ok) return { kind: 'server-error' };

    const parsed = pagesResponseSchema.safeParse(await result.response.json());
    return parsed.success ? { kind: 'success', data: parsed.data } : { kind: 'invalid-response' };
  } catch {
    return { kind: 'invalid-response' };
  }
}