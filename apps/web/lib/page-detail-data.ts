import { calendarDateSchema } from '@serp/shared';
import { z } from 'zod';
import type { ApiResult } from './api-client';

const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)));
const rankSchema = z.object({
  position: z.number().int().min(1).max(100),
  snapshotDate: calendarDateSchema,
  snapshotAt: timestampSchema,
});
const keywordSchema = z.object({
  id: z.uuid(),
  pageKeywordId: z.uuid(),
  phrase: z.string(),
  relevanceScore: z.number().min(0).max(1),
  latestRank: rankSchema.nullable(),
});

const pageDetailSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  url: z.url(),
  current: z.object({
    processedAt: timestampSchema.nullable(),
    httpStatusCode: z.number().int().nullable(),
    title: z.string().nullable(),
    metaDescription: z.string().nullable(),
    h1: z.string().nullable(),
    wordCount: z.number().int().nonnegative().nullable(),
  }).nullable(),
  issueCount: z.number().int().nonnegative(),
  issues: z.array(z.object({
    id: z.uuid(),
    issueTypeId: z.number().int(),
    code: z.string(),
    name: z.string(),
    severity: z.number().int().min(1).max(3),
    details: z.string(),
  })),
  keywords: z.array(keywordSchema),
  primaryKeyword: keywordSchema.nullable(),
});

const historySchema = z.object({
  pageId: z.uuid(),
  pageKeywordId: z.uuid().nullable(),
  keyword: z.object({ id: z.uuid(), phrase: z.string() }).nullable(),
  timezone: z.string().min(1),
  from: calendarDateSchema.nullable(),
  to: calendarDateSchema.nullable(),
  history: z.array(z.object({
    date: calendarDateSchema.nullable(),
    snapshotDate: calendarDateSchema,
    snapshotAt: timestampSchema,
    position: z.number().int().min(1).max(100),
  })),
  latestPosition: z.number().int().min(1).max(100).nullable(),
});

export type PageDetail = z.infer<typeof pageDetailSchema>;
export type RankHistory = z.infer<typeof historySchema>;
export type HistoryQuery = { keywordId: string; from?: string; to?: string };

export type DetailResult =
  | { kind: 'success'; data: PageDetail }
  | { kind: 'not-found' }
  | { kind: 'auth-expired' }
  | { kind: 'network-error' }
  | { kind: 'server-error' }
  | { kind: 'invalid-response' };

export type HistoryResult =
  | { kind: 'success'; data: RankHistory }
  | { kind: 'not-found' }
  | { kind: 'auth-expired' }
  | { kind: 'network-error' }
  | { kind: 'server-error' }
  | { kind: 'invalid-response' };

export function rankHistoryPath(pageId: string, query: HistoryQuery): string {
  const params = new URLSearchParams({ keywordId: query.keywordId });
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  return `/pages/${pageId}/rank-history?${params.toString()}`;
}

export async function loadPageDetail(
  request: (path: string) => Promise<ApiResult>,
  pageId: string,
): Promise<DetailResult> {
  if (!z.uuid().safeParse(pageId).success) return { kind: 'not-found' };
  try {
    const result = await request(`/pages/${pageId}`);
    if (result.kind === 'auth-expired' || result.kind === 'network-error' || result.kind === 'server-error') {
      return { kind: result.kind };
    }
    if (result.kind !== 'response') return { kind: 'server-error' };
    if (result.response.status === 404) return { kind: 'not-found' };
    if (result.response.status === 401) return { kind: 'auth-expired' };
    if (!result.response.ok) return { kind: 'server-error' };
    const parsed = pageDetailSchema.safeParse(await result.response.json());
    return parsed.success && parsed.data.id === pageId
      ? { kind: 'success', data: parsed.data }
      : { kind: 'invalid-response' };
  } catch {
    return { kind: 'invalid-response' };
  }
}

export async function loadRankHistory(
  request: (path: string) => Promise<ApiResult>,
  pageId: string,
  query: HistoryQuery,
): Promise<HistoryResult> {
  if (!z.uuid().safeParse(pageId).success || !z.uuid().safeParse(query.keywordId).success) {
    return { kind: 'not-found' };
  }
  try {
    const result = await request(rankHistoryPath(pageId, query));
    if (result.kind === 'auth-expired' || result.kind === 'network-error' || result.kind === 'server-error') {
      return { kind: result.kind };
    }
    if (result.kind !== 'response') return { kind: 'server-error' };
    if (result.response.status === 404) return { kind: 'not-found' };
    if (result.response.status === 401) return { kind: 'auth-expired' };
    if (!result.response.ok) return { kind: 'server-error' };
    const parsed = historySchema.safeParse(await result.response.json());
    return parsed.success && parsed.data.pageId === pageId && parsed.data.pageKeywordId === query.keywordId
      ? { kind: 'success', data: parsed.data }
      : { kind: 'invalid-response' };
  } catch {
    return { kind: 'invalid-response' };
  }
}