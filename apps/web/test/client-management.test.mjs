import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  changeClient, loadClientFailureDetails, loadManagedClients,
} from '../lib/client-management.ts';

const clientId = 'b18be606-6426-4e23-953f-353294400349';
const runId = 'fa033e94-99ad-4d17-ae46-3decb68b6518';
const client = {
  id: clientId, name: 'Example', websiteUrl: 'https://example.com/',
  archivedAt: null, pageCount: 15,
  latestCrawl: {
    id: runId, status: 3, error: 'The website returned HTTP 404.',
    processedPages: 12, failedPages: 3,
    createdAt: '2026-10-21T08:00:00.000Z',
    startedAt: '2026-10-21T08:01:00.000Z',
    finishedAt: '2026-10-21T08:03:00.000Z',
  },
};

test('active and archived views use distinct server-side client queries', async () => {
  const paths = [];
  const request = async (path) => {
    paths.push(path);
    return { kind: 'response', response: Response.json({ clients: [client] }) };
  };
  assert.equal((await loadManagedClients(request, 'active')).kind, 'success');
  assert.equal((await loadManagedClients(request, 'archived')).kind, 'success');
  assert.deepEqual(paths, ['/clients', '/clients?status=archived']);
});

test('client list rejects invalid payloads and preserves authentication errors', async () => {
  assert.deepEqual(await loadManagedClients(async () => ({
    kind: 'response', response: Response.json({ clients: [{ id: 'bad' }] }),
  }), 'active'), { kind: 'unavailable' });
  assert.deepEqual(await loadManagedClients(async () => ({ kind: 'auth-expired' }), 'active'),
    { kind: 'auth-expired' });
});

test('archive, restore, and recrawl use their real HTTP methods without automatic replay', async () => {
  const calls = [];
  const request = async (path, init) => {
    calls.push([path, init.method]);
    return { kind: 'response', response: new Response(null, { status: init.method === 'POST' ? 202 : 200 }) };
  };
  assert.deepEqual(await changeClient(request, clientId, 'archive'), { kind: 'success' });
  assert.deepEqual(await changeClient(request, clientId, 'unarchive'), { kind: 'success' });
  assert.deepEqual(await changeClient(request, clientId, 'recrawl'), { kind: 'success' });
  assert.deepEqual(calls, [
    [`/clients/${clientId}/archive`, 'PATCH'],
    [`/clients/${clientId}/unarchive`, 'PATCH'],
    [`/clients/${clientId}/recrawl`, 'POST'],
  ]);
  assert.deepEqual(await changeClient(async () => ({ kind: 'mutation-not-retried' }), clientId, 'recrawl'),
    { kind: 'resubmit-required' });
});

test('client actions distinguish conflicts, foreign IDs, and uncertain failures', async () => {
  for (const [status, kind] of [[409, 'conflict'], [404, 'not-found'], [401, 'auth-expired']]) {
    assert.deepEqual(await changeClient(async () => ({
      kind: 'response', response: new Response(null, { status }),
    }), clientId, 'archive'), { kind });
  }
  assert.deepEqual(await changeClient(async () => ({ kind: 'network-error' }), clientId, 'archive'),
    { kind: 'unavailable' });
});

test('failure details come only from the authenticated crawl-status response', async () => {
  const result = await loadClientFailureDetails(async (path) => {
    assert.equal(path, `/clients/${clientId}/crawl-status`);
    return { kind: 'response', response: Response.json({
      clientId,
      crawlRun: { ...client.latestCrawl, pageFailures: [{
        url: 'https://example.com/blog/failed', httpStatusCode: 404,
        reason: 'The website returned HTTP 404.',
      }] },
    }) };
  }, clientId);
  assert.equal(result.kind, 'success');
  assert.equal(result.data.crawlRun.pageFailures[0].httpStatusCode, 404);
});