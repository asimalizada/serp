import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { apiRequest } from '../lib/api-client.ts';
import { loadPageDetail, loadRankHistory, rankHistoryPath } from '../lib/page-detail-data.ts';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalOrigin = process.env.NEXT_PUBLIC_API_ORIGIN;

before(() => {
  globalThis.window = {};
  process.env.NEXT_PUBLIC_API_ORIGIN = 'http://api.test';
});

after(() => {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
  if (originalOrigin === undefined) delete process.env.NEXT_PUBLIC_API_ORIGIN;
  else process.env.NEXT_PUBLIC_API_ORIGIN = originalOrigin;
});

const pageId = '15e6a4ef-4042-4fc4-bd78-9ed292463e88';
const clientId = '604a0d88-64c7-4b62-925b-8b7716337d0a';
const keywordId = 'e6db0df4-7cda-4023-a9f2-e0b5c807a459';
const pageKeywordId = '63a6ae29-8c60-43a1-b099-2158b273167a';
const keyword = {
  id: keywordId,
  pageKeywordId,
  phrase: 'technical seo',
  relevanceScore: 0.9123,
  latestRank: { position: 7, snapshotDate: '2026-10-21', snapshotAt: '2026-10-21T01:00:00.000Z' },
};
const page = {
  id: pageId,
  clientId,
  url: 'https://example.com/blog/technical-seo',
  current: {
    title: 'Technical SEO guide',
    processedAt: '2026-10-20T10:00:00.000Z',
    httpStatusCode: 200,
    metaDescription: 'A practical guide.',
    h1: 'Technical SEO',
    wordCount: 900,
  },
  issueCount: 1,
  issues: [{
    id: '768ddcd9-a32e-4f4e-bc02-faa49035e65f',
    issueTypeId: 2,
    code: 'MISSING_IMAGE_ALT',
    name: 'Missing image alt',
    severity: 2,
    details: 'One image has no alt text.',
  }],
  keywords: [keyword],
  primaryKeyword: keyword,
};
const history = {
  pageId,
  pageKeywordId,
  keyword: { id: keywordId, phrase: keyword.phrase },
  timezone: 'America/Toronto',
  from: '2026-10-01',
  to: '2026-10-20',
  history: [
    { date: '2026-10-19', snapshotDate: '2026-10-20', snapshotAt: '2026-10-20T01:00:00.000Z', position: 12 },
    { date: '2026-10-20', snapshotDate: '2026-10-21', snapshotAt: '2026-10-21T01:00:00.000Z', position: 7 },
  ],
  latestPosition: 7,
};

function pathOf(input) {
  const url = new URL(input instanceof Request ? input.url : input);
  return url.pathname + url.search;
}

test('maps actual page metadata, keywords, issues and rank fields', async () => {
  const calls = [];
  globalThis.fetch = async (request) => {
    calls.push({ path: pathOf(request), credentials: request.credentials });
    return Response.json(page);
  };
  const result = await loadPageDetail(apiRequest, pageId);
  assert.equal(result.kind, 'success');
  assert.equal(result.data.current.title, page.current.title);
  assert.equal(result.data.keywords[0].pageKeywordId, pageKeywordId);
  assert.equal(result.data.issues[0].severity, 2);
  assert.equal(result.data.primaryKeyword.latestRank.position, 7);
  assert.deepEqual(calls, [{ path: `/pages/${pageId}`, credentials: 'include' }]);
});

test('accepts a page without successful analysis or ranks', async () => {
  globalThis.fetch = async () => Response.json({
    ...page, current: null, issueCount: 0, issues: [], keywords: [], primaryKeyword: null,
  });
  const result = await loadPageDetail(apiRequest, pageId);
  assert.equal(result.kind, 'success');
  assert.equal(result.data.current, null);
  assert.deepEqual(result.data.issues, []);
});

test('distinguishes missing pages, expiry, network failure and invalid data', async () => {
  assert.deepEqual(await loadPageDetail(apiRequest, 'bad-id'), { kind: 'not-found' });
  globalThis.fetch = async () => new Response(null, { status: 404 });
  assert.deepEqual(await loadPageDetail(apiRequest, pageId), { kind: 'not-found' });

  globalThis.fetch = async () => new Response(null, { status: 401 });
  assert.deepEqual(await loadPageDetail(apiRequest, pageId), { kind: 'auth-expired' });

  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.deepEqual(await loadPageDetail(apiRequest, pageId), { kind: 'network-error' });

  globalThis.fetch = async () => Response.json({ ...page, issues: [{ ...page.issues[0], severity: 8 }] });
  assert.deepEqual(await loadPageDetail(apiRequest, pageId), { kind: 'invalid-response' });
});

test('uses page-keyword ID and date range for rank history', async () => {
  const query = { keywordId: pageKeywordId, from: '2026-10-01', to: '2026-10-20' };
  assert.equal(
    rankHistoryPath(pageId, query),
    `/pages/${pageId}/rank-history?keywordId=${pageKeywordId}&from=2026-10-01&to=2026-10-20`,
  );
  const calls = [];
  globalThis.fetch = async (request) => {
    calls.push({ path: pathOf(request), credentials: request.credentials });
    return Response.json(history);
  };
  const result = await loadRankHistory(apiRequest, pageId, query);
  assert.equal(result.kind, 'success');
  assert.equal(result.data.timezone, 'America/Toronto');
  assert.equal(result.data.history[0].date, '2026-10-19');
  assert.equal(result.data.history[0].snapshotDate, '2026-10-20');
  assert.equal(result.data.history[0].snapshotAt, '2026-10-20T01:00:00.000Z');
  assert.equal(result.data.latestPosition, 7);
  assert.deepEqual(calls, [{ path: rankHistoryPath(pageId, query), credentials: 'include' }]);
});

test('accepts empty history and rejects mismatched or malformed history', async () => {
  globalThis.fetch = async () => Response.json({ ...history, history: [], latestPosition: null });
  const empty = await loadRankHistory(apiRequest, pageId, { keywordId: pageKeywordId });
  assert.equal(empty.kind, 'success');
  assert.deepEqual(empty.data.history, []);

  globalThis.fetch = async () => Response.json({ ...history, pageKeywordId: keywordId });
  assert.deepEqual(await loadRankHistory(apiRequest, pageId, { keywordId: pageKeywordId }), { kind: 'invalid-response' });

  globalThis.fetch = async () => Response.json({ ...history, history: [{ ...history.history[0], position: 101 }] });
  assert.deepEqual(await loadRankHistory(apiRequest, pageId, { keywordId: pageKeywordId }), { kind: 'invalid-response' });
});