import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { apiRequest } from '../lib/api-client.ts';
import { loadClients, loadPages, pagesPath } from '../lib/pages-data.ts';

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

const item = {
  id: '2f838019-6624-47c3-b9e2-7a8b3d1781da',
  clientId: '536b84f6-220b-4fd7-a590-1230208748e1',
  url: 'https://example.com/blog/article',
  current: { title: 'Actual article title', metaDescription: 'Unused detail' },
  keywords: [{ phrase: 'article topic', relevanceScore: 0.8765 }],
  issueCount: 2,
  latestRank: { position: 7, snapshotDate: '2026-01-01' },
};

function response(items) {
  return { items, pagination: { page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0 } };
}

test('loads the default first page with cookies and validates consumed fields', async () => {
  const calls = [];
  globalThis.fetch = async (request) => {
    const url = new URL(request.url);
    calls.push({ path: url.pathname + url.search, credentials: request.credentials, method: request.method });
    return Response.json(response([item]));
  };

  const result = await loadPages(apiRequest);
  assert.equal(result.kind, 'success');
  assert.equal(result.data.items[0].current.title, 'Actual article title');
  assert.equal(result.data.items[0].latestRank.position, 7);
  assert.equal(result.data.items[0].keywords[0].phrase, 'article topic');
  assert.deepEqual(calls, [{ path: '/pages?page=1', credentials: 'include', method: 'GET' }]);
});

test('uses backend search, clientId, and page query parameters together', async () => {
  const clientId = '536b84f6-220b-4fd7-a590-1230208748e1';
  const query = { search: 'seo guide', clientId, page: 2 };
  assert.equal(
    pagesPath(query),
    `/pages?page=2&search=seo+guide&clientId=${clientId}`,
  );

  let requestedUrl = '';
  globalThis.fetch = async (request) => {
    requestedUrl = request.url;
    return Response.json({
      items: [item],
      pagination: { page: 2, pageSize: 20, total: 21, totalPages: 2 },
    });
  };
  const result = await loadPages(apiRequest, query);
  assert.equal(result.kind, 'success');
  assert.equal(result.data.pagination.page, 2);
  assert.equal(new URL(requestedUrl).searchParams.get('search'), 'seo guide');
  assert.equal(new URL(requestedUrl).searchParams.get('clientId'), clientId);
  assert.equal(new URL(requestedUrl).searchParams.get('page'), '2');
});

test('accepts an empty list and missing current analysis or rank', async () => {
  globalThis.fetch = async () => Response.json(response([]));
  const empty = await loadPages(apiRequest);
  assert.equal(empty.kind, 'success');
  assert.deepEqual(empty.data.items, []);

  globalThis.fetch = async () => Response.json(response([{ ...item, current: null, keywords: [], issueCount: 0, latestRank: null }]));
  const missing = await loadPages(apiRequest);
  assert.equal(missing.kind, 'success');
  assert.equal(missing.data.items[0].current, null);
  assert.equal(missing.data.items[0].latestRank, null);
});

test('keeps network and server errors distinct from expired authentication', async () => {
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.deepEqual(await loadPages(apiRequest), { kind: 'network-error' });

  globalThis.fetch = async () => new Response(null, { status: 503 });
  assert.deepEqual(await loadPages(apiRequest), { kind: 'server-error' });

  globalThis.fetch = async () => new Response(null, { status: 401 });
  assert.deepEqual(await loadPages(apiRequest), { kind: 'auth-expired' });
});

test('refreshes an expired access token and loads pages once', async () => {
  const calls = [];
  globalThis.fetch = async (request) => {
    const path = new URL(request instanceof Request ? request.url : request).pathname;
    calls.push(path);
    if (path === '/auth/refresh') return new Response(null, { status: 200 });
    return calls.filter((call) => call === '/pages').length === 1
      ? new Response(null, { status: 401 })
      : Response.json(response([item]));
  };

  assert.equal((await loadPages(apiRequest)).kind, 'success');
  assert.deepEqual(calls, ['/pages', '/auth/refresh', '/pages']);
});

test('rejects invalid response shapes without showing fabricated rows', async () => {
  globalThis.fetch = async () => Response.json(response([{ ...item, issueCount: '2' }]));
  assert.deepEqual(await loadPages(apiRequest), { kind: 'invalid-response' });

  globalThis.fetch = async () => new Response('not JSON', { status: 200 });
  assert.deepEqual(await loadPages(apiRequest), { kind: 'invalid-response' });

  globalThis.fetch = async () => Response.json({
    items: [item], pagination: { page: 2, pageSize: 20, total: 21, totalPages: 2 },
  });
  assert.deepEqual(await loadPages(apiRequest, { page: 1 }), { kind: 'invalid-response' });
});

test('loads owned client identities for the selector and table', async () => {
  const client = {
    id: '536b84f6-220b-4fd7-a590-1230208748e1',
    name: 'Example',
    websiteUrl: 'https://example.com',
    normalizedDomain: 'example.com',
  };
  const calls = [];
  globalThis.fetch = async (request) => {
    calls.push({ path: new URL(request.url).pathname, credentials: request.credentials });
    return Response.json({ clients: [client] });
  };
  assert.deepEqual(await loadClients(apiRequest), { kind: 'success', clients: [client] });
  assert.deepEqual(calls, [{ path: '/clients', credentials: 'include' }]);
});

test('reports client lookup failures without inventing client names', async () => {
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.deepEqual(await loadClients(apiRequest), { kind: 'network-error' });

  globalThis.fetch = async () => Response.json({ clients: [{ id: 'bad', name: 'Wrong' }] });
  assert.deepEqual(await loadClients(apiRequest), { kind: 'invalid-response' });
});