const { test } = require('node:test');
const assert = require('node:assert/strict');

const origin = process.env.SERP_TEST_API_ORIGIN;
const passwordA = process.env.SEED_USER_A_PASSWORD;
const passwordB = process.env.SEED_USER_B_PASSWORD;

test('authenticated API isolates clients, pages, keywords and rank histories',
  { skip: !origin || !passwordA || !passwordB ? 'Set SERP_TEST_API_ORIGIN and demo passwords to run HTTP integration tests' : false },
  async () => {
    async function request(path, { cookie, method = 'GET', body } = {}) {
      const response = await fetch(`${origin}${path}`, { method, headers: {
        ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { origin } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { response, data: await response.json() };
    }
    const unauth = await request('/clients');
    assert.equal(unauth.response.status, 401);
    const aLogin = await request('/auth/login', { method: 'POST', body: {
      email: '  SEMRUSH.DEMO@SERP.LOCAL  ', password: passwordA,
    } });
    const bLogin = await request('/auth/login', { method: 'POST', body: {
      email: 'yoast.demo@serp.local', password: passwordB,
    } });
    assert.equal(aLogin.response.status, 200, JSON.stringify(aLogin.data));
    assert.equal(bLogin.response.status, 200, JSON.stringify(bLogin.data));
    assert.match(aLogin.response.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(aLogin.response.headers.get('set-cookie'), /SameSite=Lax/i);
    const aCookie = aLogin.response.headers.get('set-cookie').split(';')[0];
    const bCookie = bLogin.response.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/auth/me', { cookie: aCookie })).data.user.email, 'semrush.demo@serp.local');

    const clientsA = (await request('/clients', { cookie: aCookie })).data.clients;
    const clientsB = (await request('/clients', { cookie: bCookie })).data.clients;
    assert.ok(clientsA.length >= 1);
    assert.equal(clientsB.length, 1);
    const clientA = clientsA.find((client) => client.normalizedDomain === 'semrush.com');
    const clientB = clientsB.find((client) => client.normalizedDomain === 'yoast.com');
    assert.ok(clientA && clientB);
    assert.notEqual(clientA.id, clientB.id);
    assert.equal((await request(`/clients/${clientB.id}/crawl-status`, { cookie: aCookie })).response.status, 404);
    assert.equal((await request(`/clients/${clientA.id}/crawl-status`, { cookie: aCookie })).response.status, 200);

    const started = performance.now();
    const listA = await request('/pages?page=1&pageSize=5', { cookie: aCookie });
    assert.equal(listA.response.status, 200, JSON.stringify(listA.data));
    assert.ok(performance.now() - started < 5000, 'pages query should stay responsive with rank history');
    assert.equal(listA.data.pagination.total, 15);
    assert.equal(listA.data.items.length, 5);
    assert.ok(listA.data.items[0].keywords.length);
    assert.ok(listA.data.items[0].primaryKeyword);
    assert.ok(listA.data.items[0].latestRank);
    const listB = await request('/pages?pageSize=1', { cookie: bCookie });
    const pageA = listA.data.items[0];
    const pageB = listB.data.items[0];
    assert.equal((await request(`/pages?clientId=${clientB.id}`, { cookie: aCookie })).data.pagination.total, 0);
    assert.equal((await request(`/pages/${pageB.id}`, { cookie: aCookie })).response.status, 404);
    assert.equal((await request(`/pages/${pageB.id}/rank-history`, { cookie: aCookie })).response.status, 404);
    assert.equal((await request(`/pages/${pageA.id}`, { cookie: bCookie })).response.status, 404);
    assert.equal((await request(`/pages/${pageA.id}/rank-history?keywordId=${pageB.primaryKeyword.pageKeywordId}`, { cookie: aCookie })).response.status, 404);
    assert.equal((await request(`/pages/${pageA.id}/rank-history?keywordId=${pageA.primaryKeyword.pageKeywordId}`, { cookie: bCookie })).response.status, 404);

    const ownDetail = await request(`/pages/${pageA.id}`, { cookie: aCookie });
    assert.equal(ownDetail.response.status, 200);
    assert.equal(ownDetail.data.issueCount, ownDetail.data.issues.length);
    assert.equal((await request('/pages?page=0&pageSize=101', { cookie: aCookie })).response.status, 400);
    assert.equal((await request('/pages?keyword=definitely-not-present', { cookie: aCookie })).data.pagination.total, 0);
    assert.ok((await request(`/pages?url=${encodeURIComponent(new URL(pageA.url).pathname)}`, { cookie: aCookie })).data.pagination.total >= 1);
    assert.equal((await request('/clients', { method: 'POST', cookie: aCookie,
      body: { websiteUrl: 'http://127.0.0.1/' } })).response.status, 400);
    const newSite = 'https://example.org';
    let added = clientsA.find((client) => client.normalizedDomain === 'example.org');
    if (!added) {
      const startedCreate = performance.now();
      const created = await request('/clients', { method: 'POST', cookie: aCookie,
        body: { websiteUrl: newSite, name: 'API test site' } });
      assert.equal(created.response.status, 202, JSON.stringify(created.data));
      assert.ok(performance.now() - startedCreate < 6000);
      assert.equal(created.data.crawlRun.status, 0);
      added = created.data.client;
    }
    assert.equal((await request('/clients', { method: 'POST', cookie: aCookie,
      body: { websiteUrl: newSite } })).response.status, 409);
    assert.equal((await request(`/clients/${added.id}/crawl-status`, { cookie: bCookie })).response.status, 404);
    assert.equal((await request(`/clients/${added.id}/crawl-status`, { cookie: aCookie })).response.status, 200);
    const emptyHistory = await request(`/pages/${pageA.id}/rank-history?from=2030-01-01&to=2030-01-02`, { cookie: aCookie });
    assert.equal(emptyHistory.response.status, 200);
    assert.deepEqual(emptyHistory.data.history, []);
    assert.equal(emptyHistory.data.latestPosition, null);
    assert.equal((await request(`/pages/${pageA.id}/rank-history?from=2026-02-30`, { cookie: aCookie })).response.status, 400);

    const originalTimezone = aLogin.data.user.timezone;
    try {
      const changed = await request('/users/me/timezone', { method: 'PATCH', cookie: aCookie, body: { timezone: 'Pacific/Auckland' } });
      assert.equal(changed.response.status, 200);
      assert.equal(changed.data.user.timezone, 'Pacific/Auckland');
      if (changed.response.headers.get('set-cookie')) {
        aCookie = changed.response.headers.get('set-cookie').split(';')[0];
      }
      const zoneHistory = await request(`/pages/${pageA.id}/rank-history?from=2026-10-21&to=2026-10-21`, { cookie: aCookie });
      assert.equal(zoneHistory.response.status, 200);
      assert.ok(zoneHistory.data.history.some(({ snapshotDate, date }) => snapshotDate === '2026-10-20' && date === '2026-10-21'));
      assert.equal((await request('/users/me/timezone', { method: 'PATCH', cookie: aCookie, body: { timezone: 'Mars/Olympus' } })).response.status, 400);
    } finally {
      const reverted = await request('/users/me/timezone', { method: 'PATCH', cookie: aCookie, body: { timezone: originalTimezone } });
      if (reverted.response.headers.get('set-cookie')) {
        aCookie = reverted.response.headers.get('set-cookie').split(';')[0];
      }
    }
    assert.equal((await fetch(`${origin}/auth/logout`, { method: 'POST', headers: { cookie: aCookie } })).status, 403);
    assert.equal((await fetch(`${origin}/auth/logout`, { method: 'POST',
      headers: { cookie: aCookie, origin: 'https://untrusted.example' } })).status, 403);
    const logout = await request('/auth/logout', { method: 'POST', cookie: aCookie });
    assert.equal(logout.response.status, 200);
    assert.match(logout.response.headers.get('set-cookie'), /Expires=|Max-Age=0/i);
    assert.equal((await request('/auth/me', { cookie: aCookie })).response.status, 401);
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal((await request('/auth/login', { method: 'POST', body: {
        email: 'unknown.demo@serp.local', password: 'incorrect',
      } })).response.status, 401);
    }
    assert.equal((await request('/auth/login', { method: 'POST', body: {
      email: 'unknown.demo@serp.local', password: 'incorrect',
    } })).response.status, 429);
  });
