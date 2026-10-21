import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { apiRequest } from '../lib/api-client.ts';

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

function pathOf(input) {
  return new URL(input instanceof Request ? input.url : input.toString()).pathname;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('refreshes a 401 and retries a GET once with its headers and cookies', async () => {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const path = pathOf(input);
    calls.push({
      path,
      credentials: input instanceof Request ? input.credentials : init.credentials,
      header: input instanceof Request ? input.headers.get('x-serp-test') : null,
    });
    return new Response(null, { status: calls.length === 1 ? 401 : 200 });
  };

  const result = await apiRequest('/pages', { headers: { 'X-Serp-Test': 'retained' } });
  assert.equal(result.kind, 'response');
  assert.equal(result.response.status, 200);
  assert.deepEqual(calls.map((call) => call.path), ['/pages', '/auth/refresh', '/pages']);
  assert.ok(calls.every((call) => call.credentials === 'include'));
  assert.equal(calls[0].header, 'retained');
  assert.equal(calls[2].header, 'retained');
});

test('returns auth-expired when refresh is rejected, without retrying', async () => {
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(pathOf(input));
    return new Response(null, { status: 401 });
  };

  assert.deepEqual(await apiRequest('/pages'), { kind: 'auth-expired' });
  assert.deepEqual(calls, ['/pages', '/auth/refresh']);
});

test('concurrent 401s share one refresh rotation', async () => {
  const releaseRefresh = deferred();
  let refreshCalls = 0;
  const attempts = new Map();
  globalThis.fetch = async (input) => {
    const path = pathOf(input);
    if (path === '/auth/refresh') {
      refreshCalls += 1;
      await releaseRefresh.promise;
      return new Response(null, { status: 200 });
    }
    const attempt = (attempts.get(path) ?? 0) + 1;
    attempts.set(path, attempt);
    return new Response(null, { status: attempt === 1 ? 401 : 200 });
  };

  const first = apiRequest('/pages');
  const second = apiRequest('/clients');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshCalls, 1);
  releaseRefresh.resolve();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((result) => result.kind), ['response', 'response']);
  assert.equal(refreshCalls, 1);
  assert.equal(attempts.get('/pages'), 2);
  assert.equal(attempts.get('/clients'), 2);
});

test('a late stale 401 uses the completed refresh without rotating again', async () => {
  const releaseLateResponse = deferred();
  let refreshCalls = 0;
  let lateAttempts = 0;
  globalThis.fetch = async (input) => {
    const path = pathOf(input);
    if (path === '/auth/refresh') {
      refreshCalls += 1;
      return new Response(null, { status: 200 });
    }
    if (path === '/clients') {
      lateAttempts += 1;
      if (lateAttempts === 1) {
        await releaseLateResponse.promise;
        return new Response(null, { status: 401 });
      }
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 401 });
  };

  const late = apiRequest('/clients');
  assert.equal((await apiRequest('/pages')).kind, 'auth-expired');
  // The /pages retry above returned 401 after one successful refresh.
  releaseLateResponse.resolve();
  assert.equal((await late).kind, 'response');
  assert.equal(refreshCalls, 1);
});

test('a 401 on the single retry ends the flow', async () => {
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(pathOf(input));
    return new Response(null, { status: pathOf(input) === '/auth/refresh' ? 200 : 401 });
  };

  assert.deepEqual(await apiRequest('/pages'), { kind: 'auth-expired' });
  assert.deepEqual(calls, ['/pages', '/auth/refresh', '/pages']);
});

test('refreshes after a mutation 401 but never resends its body', async () => {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({
      path: pathOf(input),
      method: input instanceof Request ? input.method : init.method,
      body: input instanceof Request ? await input.text() : null,
    });
    return new Response(null, { status: calls.length === 1 ? 401 : 200 });
  };

  const result = await apiRequest('/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Example' }),
  });
  assert.equal(result.kind, 'mutation-not-retried');
  assert.deepEqual(calls.map((call) => call.path), ['/clients', '/auth/refresh']);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body, '{"name":"Example"}');
});

test('reports initial, refresh, and retry network failures', async () => {
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.deepEqual(await apiRequest('/pages'), { kind: 'network-error' });

  globalThis.fetch = async (input) => {
    if (pathOf(input) === '/auth/refresh') throw new TypeError('offline');
    return new Response(null, { status: 401 });
  };
  assert.deepEqual(await apiRequest('/pages'), { kind: 'network-error' });

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 3) throw new TypeError('offline');
    return new Response(null, { status: calls === 1 ? 401 : 200 });
  };
  assert.deepEqual(await apiRequest('/pages'), { kind: 'network-error' });
  assert.equal(calls, 3);
});

test('returns other HTTP responses unchanged without refreshing', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 503 });
  };

  const result = await apiRequest('/pages');
  assert.equal(result.kind, 'response');
  assert.equal(result.response.status, 503);
  assert.equal(calls, 1);
});
