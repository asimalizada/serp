import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { apiRequest } from '../lib/api-client.ts';
import { createClient, loadCrawlStatus, validateClientName, validateClientWebsiteUrl } from '../lib/client-creation.ts';

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

const clientId = 'b18be606-6426-4e23-953f-353294400349';
const crawlRunId = 'fa033e94-99ad-4d17-ae46-3decb68b6518';
const created = {
  client: {
    id: clientId,
    userId: 'e4b18e18-fde2-4c03-bd07-dae9e1b17251',
    name: 'Example Client',
    websiteUrl: 'https://example.com/',
    normalizedDomain: 'example.com',
    createdAt: '2026-10-21T08:00:00.000Z',
  },
  crawlRun: { id: crawlRunId, status: 0 },
};

test('validates supported URL syntax without changing the submitted value', () => {
  assert.equal(validateClientWebsiteUrl('https://example.com/path?ref=One'), null);
  assert.match(validateClientWebsiteUrl('not a url'), /valid website URL/);
  assert.match(validateClientWebsiteUrl('ftp://example.com'), /HTTP or HTTPS/);
  assert.match(validateClientWebsiteUrl('https://user:pass@example.com'), /without credentials/);
  assert.match(validateClientWebsiteUrl('https://example.com:8080'), /custom port/);
});

test('requires a nonblank client name within the shared 255-character limit', () => {
  assert.equal(validateClientName('Example Client'), null);
  assert.equal(validateClientName('A'.repeat(255)), null);
  assert.match(validateClientName(''), /Enter a client name/);
  assert.match(validateClientName('   '), /Enter a client name/);
  assert.match(validateClientName('A'.repeat(256)), /at most 255 characters/);
});

test('creates a client once with cookies and the exact URL, then accepts actual crawl status', async () => {
  const calls = [];
  globalThis.fetch = async (request) => {
    const url = new URL(request.url);
    calls.push({ path: url.pathname, method: request.method, credentials: request.credentials,
      body: request.method === 'POST' ? await request.text() : null });
    if (url.pathname === '/clients') return Response.json(created, { status: 202 });
    return Response.json({
      clientId, crawlRun: { id: crawlRunId, status: 1, error: null,
        sitemapUrl: null, createdAt: '2026-10-21T08:00:00.000Z',
        startedAt: '2026-10-21T08:01:00.000Z', finishedAt: null,
        processedPages: 3, failedPages: 1 },
    });
  };
  const websiteUrl = 'https://example.com/Case?ref=One';
  const name = '  Example Client  ';
  const result = await createClient(apiRequest, websiteUrl, name);
  assert.equal(result.kind, 'success');
  assert.equal(result.data.client.name, 'Example Client');
  assert.equal(result.data.client.websiteUrl, 'https://example.com/');
  assert.deepEqual(await loadCrawlStatus(apiRequest, clientId), {
    kind: 'success', data: { clientId, crawlRun: { id: crawlRunId, status: 1, error: null,
      processedPages: 3, failedPages: 1 } },
  });
  assert.deepEqual(calls, [
    { path: '/clients', method: 'POST', credentials: 'include', body: JSON.stringify({ name: name.trim(), websiteUrl }) },
    { path: `/clients/${clientId}/crawl-status`, method: 'GET', credentials: 'include', body: null },
  ]);
});

test('handles duplicate, invalid and expired client creation responses', async () => {
  globalThis.fetch = async () => new Response(null, { status: 409 });
  assert.deepEqual(await createClient(apiRequest, 'https://example.com', 'Example'), { kind: 'duplicate' });
  globalThis.fetch = async () => new Response(null, { status: 400 });
  assert.deepEqual(await createClient(apiRequest, 'https://example.com', 'Example'), { kind: 'validation-error' });
  globalThis.fetch = async () => new Response(null, { status: 401 });
  assert.deepEqual(await createClient(async () => ({ kind: 'auth-expired' }), 'https://example.com', 'Example'), { kind: 'auth-expired' });
});

test('never retries a POST after a 401 refresh and asks for explicit resubmission', async () => {
  const calls = [];
  globalThis.fetch = async (request) => {
    const url = new URL(request instanceof Request ? request.url : request);
    calls.push(`${request instanceof Request ? request.method : 'POST'} ${url.pathname}`);
    return url.pathname === '/auth/refresh'
      ? new Response(null, { status: 200 })
      : new Response(null, { status: 401 });
  };
  assert.deepEqual(await createClient(apiRequest, 'https://example.com', 'Example'), { kind: 'resubmit-required' });
  assert.deepEqual(calls, ['POST /clients', 'POST /auth/refresh']);
});

test('treats network failure and unconfirmed server outcomes as uncertain', async () => {
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.deepEqual(await createClient(apiRequest, 'https://example.com', 'Example'), { kind: 'uncertain' });
  globalThis.fetch = async () => new Response(null, { status: 503 });
  assert.deepEqual(await createClient(apiRequest, 'https://example.com', 'Example'), { kind: 'uncertain' });
  globalThis.fetch = async () => Response.json({ client: { id: 'bad' } }, { status: 202 });
  assert.deepEqual(await createClient(apiRequest, 'https://example.com', 'Example'), { kind: 'invalid-response' });
});

test('reports unavailable crawl status without inventing progress', async () => {
  globalThis.fetch = async () => new Response(null, { status: 503 });
  assert.deepEqual(await loadCrawlStatus(apiRequest, clientId), { kind: 'unavailable' });
  globalThis.fetch = async () => Response.json({ clientId: 'wrong', crawlRun: null });
  assert.deepEqual(await loadCrawlStatus(apiRequest, clientId), { kind: 'unavailable' });
});
