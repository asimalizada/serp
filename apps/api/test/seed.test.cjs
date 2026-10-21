const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compare } = require('bcryptjs');
const { DEMO_SITES, provisionDemoClients, crawlDemoClients } = require('../dist/seed/demo.js');
const { normalizeDomain } = require('../dist/crawler/http/url-safety.js');
const { deterministicPosition, snapshotDates, generateRankSnapshots } = require('../dist/seed/ranks.js');

const passwords = { SEED_USER_A_PASSWORD: 'test-password-A-123', SEED_USER_B_PASSWORD: 'test-password-B-123' };

test('demo provisioning normalizes identities, hashes passwords, and reuses records', async () => {
  const users = new Map();
  const clients = new Map();
  const prisma = {
    user: { upsert: async ({ where, create }) => {
      if (!users.has(where.email)) users.set(where.email, { id: `user-${users.size + 1}`, ...create });
      return users.get(where.email);
    } },
    client: { upsert: async ({ where, create }) => {
      const key = `${where.userId_normalizedDomain.userId}:${where.userId_normalizedDomain.normalizedDomain}`;
      if (!clients.has(key)) clients.set(key, { id: `client-${clients.size + 1}`, ...create });
      return clients.get(key);
    } },
  };
  const first = await provisionDemoClients(prisma, passwords);
  const hashes = [...users.values()].map(({ passwordHash }) => passwordHash);
  const second = await provisionDemoClients(prisma, passwords);
  assert.deepEqual(second, first);
  assert.equal(users.size, 2);
  assert.equal(clients.size, 2);
  assert.deepEqual([...users.keys()], DEMO_SITES.map(({ email }) => email));
  assert.deepEqual([...users.values()].map(({ passwordHash }) => passwordHash), hashes);
  assert.ok(await compare(passwords.SEED_USER_A_PASSWORD, hashes[0]));
  assert.equal(normalizeDomain('  https://WWW.Semrush.COM/path  '), 'semrush.com');
});

test('seed crawl skips complete clients and retries only missing URLs after partial failure', async () => {
  const completed = new Map([['client-a', Array.from({ length: 15 }, (_, i) => `https://example.com/blog/article-${i}`)],
    ['client-b', ['https://example.org/blog/one']]]);
  const calls = [];
  const prisma = {
    client: { findUniqueOrThrow: async ({ where }) => ({ websiteUrl: where.id === 'client-a' ? 'https://example.com' : 'https://example.org', archivedAt: null }) },
    crawlRun: { findFirst: async () => null },
    page: { findMany: async ({ where }) => completed.get(where.clientId).map((url) => ({ url })) },
  };
  const crawler = { crawlClient: async (clientId, skip) => {
    calls.push({ clientId, skip: [...skip] });
    completed.get(clientId).push('https://example.org/blog/two');
    return { runId: 'new-run', selected: 1, processed: 1, failed: 0, discovered: 2, sitemapUrl: null, errors: [] };
  } };
  const first = await crawlDemoClients(prisma, crawler, ['client-a', 'client-b']);
  assert.equal(first[0].skipped, true);
  assert.deepEqual(calls, [{ clientId: 'client-b', skip: ['https://example.org/blog/one'] }]);
  assert.equal(first[1].summary.processed, 1);
  assert.deepEqual(completed.get('client-b'), ['https://example.org/blog/one', 'https://example.org/blog/two']);
});

test('seed does not crawl or restore archived clients', async () => {
  const prisma = {
    client: { findUniqueOrThrow: async () => ({ websiteUrl: 'https://example.com', archivedAt: new Date() }) },
    page: { findMany: async () => [] },
    crawlRun: { findFirst: async () => assert.fail('archived clients must not be checked for active jobs') },
  };
  const crawler = { crawlClient: async () => assert.fail('archived clients must not be crawled') };
  const result = await crawlDemoClients(prisma, crawler, ['archived-client']);
  assert.deepEqual(result, [{ clientId: 'archived-client', skipped: true, priorSuccessfulPages: 0 }]);
});

test('rank dates, positions, and UTC timestamps are deterministic and bounded', () => {
  const now = new Date('2026-10-20T23:59:59Z');
  assert.deepEqual(snapshotDates(now, 200), { firstDay: Math.floor(now.getTime() / 86400000) - 364,
    lastDay: Math.floor(now.getTime() / 86400000), days: 365 });
  assert.equal(snapshotDates(now, 1).days, 50000);
  const id = 'ae06498c-3e56-4bf2-9cab-43bc225d4d46';
  const values = Array.from({ length: 365 }, (_, i) => deterministicPosition(id, new Date(Date.UTC(2025, 0, i + 1))));
  assert.deepEqual(values, Array.from({ length: 365 }, (_, i) => deterministicPosition(id, new Date(Date.UTC(2025, 0, i + 1)))));
  assert.ok(values.every((value) => value >= 1 && value <= 100));
  assert.ok(values.slice(1).every((value, i) => Math.abs(value - values[i]) <= 5));
});

test('rank generation inserts missing days, preserves existing snapshots, and includes new relationships on rerun', async () => {
  const ids = Array.from({ length: 200 }, (_, i) => `pair-${String(i).padStart(3, '0')}`);
  const snapshots = new Map();
  const prisma = {
    pageKeyword: {
      count: async () => ids.length,
      findMany: async ({ where, take }) => ids.filter((id) => !where || id > where.id.gt).slice(0, take).map((id) => ({ id })),
    },
    rankSnapshot: {
      count: async () => snapshots.size,
      findMany: async ({ where }) => [...snapshots.values()].filter(({ pageKeywordId, snapshotDate }) =>
        where.pageKeywordId.in.includes(pageKeywordId) && snapshotDate >= where.snapshotDate.gte && snapshotDate <= where.snapshotDate.lte)
        .map(({ pageKeywordId, snapshotDate }) => ({ pageKeywordId, snapshotDate })),
      createMany: async ({ data, skipDuplicates }) => {
        assert.equal(skipDuplicates, true);
        assert.ok(data.length <= 1000);
        let count = 0;
        for (const record of data) {
          assert.equal(record.snapshotAt.toISOString().slice(0, 10), record.snapshotDate.toISOString().slice(0, 10));
          assert.equal(record.snapshotAt.getUTCHours(), 12);
          assert.ok(record.position >= 1 && record.position <= 100);
          const key = `${record.pageKeywordId}:${record.snapshotDate.toISOString()}`;
          if (!snapshots.has(key)) { snapshots.set(key, record); count++; }
        }
        return { count };
      },
    },
  };
  const now = new Date('2026-10-20T11:00:00Z');
  const first = await generateRankSnapshots(prisma, now);
  assert.equal(first.inserted, 73000);
  assert.equal(first.days, 365);
  const preserved = snapshots.get(`pair-000:${new Date('2025-10-21T00:00:00Z').toISOString()}`);
  const second = await generateRankSnapshots(prisma, now);
  assert.equal(second.inserted, 0);
  assert.strictEqual(snapshots.get(`pair-000:${new Date('2025-10-21T00:00:00Z').toISOString()}`), preserved);
  ids.push('pair-200');
  const third = await generateRankSnapshots(prisma, now);
  assert.equal(third.inserted, 365);
  assert.equal(third.total, 73365);
});