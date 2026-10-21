const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execSync } = require('node:child_process');

const fs = require('node:fs');
const envPath = [
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(process.cwd(), '.env'),
].find((p) => fs.existsSync(p));
if (envPath) require('dotenv').config({ path: envPath, quiet: true });

const originalDbUrl = process.env.DATABASE_URL;
if (!originalDbUrl) {
  test('worker integration tests', { skip: 'DATABASE_URL not available' }, () => { });
  return;
}

const { PrismaClient } = require('../dist/generated/prisma/client.js');
const { PrismaPg } = require('@prisma/adapter-pg');
const { CrawlWorker } = require('../dist/crawler/workers/crawl-worker.js');
const { PrismaCrawlStore } = require('../dist/crawler/persistence/prisma-crawl.store.js');
const { ClientsRepository } = require('../dist/clients/repositories/clients.repository.js');
const { DuplicateClientError } = require('../dist/clients/errors/duplicate-client.error.js');
const { PagesRepository } = require('../dist/pages/repositories/pages.repository.js');
const { AuthRepository } = require('../dist/auth/repositories/auth.repository.js');
const { PostgresThrottlerStorage } = require('../dist/auth/throttling/postgres-throttler.storage.js');
const { AuthStateCleanupService } = require('../dist/auth/auth-state-cleanup.service.js');
const { UsersRepository } = require('../dist/users/repositories/users.repository.js');

const testDbName = `serp_test_worker_${Date.now()}`;
const testDbUrl = originalDbUrl.replace(/\/serp(\?.*)?$/, `/${testDbName}$1`);

let adminPrisma;
let testPrisma;
let testUser;
let testClient;
let auxiliaryClientNumber = 0;

async function auxiliaryClient() {
  const number = ++auxiliaryClientNumber;
  return testPrisma.client.create({ data: {
    userId: testUser.id, name: `Auxiliary ${number}`,
    websiteUrl: `https://aux-${number}.example.com`, normalizedDomain: `aux-${number}.example.com`,
  } });
}

before(async () => {
  adminPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: originalDbUrl }) });
  await adminPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
  await adminPrisma.$executeRawUnsafe(`CREATE DATABASE "${testDbName}"`);

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: testDbUrl },
    stdio: 'pipe',
  });

  testPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDbUrl }) });
  testUser = await testPrisma.user.create({
    data: { email: 'worker-test@example.com', passwordHash: 'hash', timezone: 'UTC' },
  });
  testClient = await testPrisma.client.create({
    data: {
      userId: testUser.id,
      name: 'Integration Test Client',
      websiteUrl: 'https://example.com',
      normalizedDomain: 'example.com',
    },
  });
});

after(async () => {
  if (testPrisma) await testPrisma.$disconnect();
  if (adminPrisma) {
    try {
      await adminPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    } catch {
      // Ignore cleanup error if already dropped
    }
    await adminPrisma.$disconnect();
  }
});

test('PostgreSQL triggers enforce state transitions: 0 -> 1 -> (2 or 3) and forbid illegal/terminal updates', async () => {
  const run1 = await testPrisma.crawlRun.create({ data: { clientId: testClient.id, status: 0 } });

  // Direct 0 -> 3 must be rejected by PostgreSQL trigger
  await assert.rejects(
    testPrisma.crawlRun.update({ where: { id: run1.id }, data: { status: 3 } }),
    /Invalid crawl run status transition/
  );

  // Direct 0 -> 2 must be rejected by PostgreSQL trigger
  await assert.rejects(
    testPrisma.crawlRun.update({ where: { id: run1.id }, data: { status: 2 } }),
    /Invalid crawl run status transition/
  );

  // Valid 0 -> 1 must succeed
  await testPrisma.crawlRun.update({ where: { id: run1.id }, data: { status: 1 } });

  // Valid 1 -> 2 must succeed
  await testPrisma.crawlRun.update({ where: { id: run1.id }, data: { status: 2 } });

  // Terminal run cannot be modified
  await assert.rejects(
    testPrisma.crawlRun.update({ where: { id: run1.id }, data: { status: 3 } }),
    /A completed or failed crawl run cannot be changed/
  );

  // Test 0 -> 1 -> 3
  const run2 = await testPrisma.crawlRun.create({ data: { clientId: testClient.id, status: 0 } });
  await testPrisma.crawlRun.update({ where: { id: run2.id }, data: { status: 1 } });
  await testPrisma.crawlRun.update({ where: { id: run2.id }, data: { status: 3 } });

  await assert.rejects(
    testPrisma.crawlRun.update({ where: { id: run2.id }, data: { status: 1 } }),
    /A completed or failed crawl run cannot be changed/
  );
});

test('successful crawl completion updates run status to 2 with timing timestamps', async () => {
  const run = await testPrisma.crawlRun.create({ data: { clientId: testClient.id, status: 0 } });
  const store = new PrismaCrawlStore(testPrisma);
  const crawler = {
    crawlClient: async (clientId, skip, runId) => {
      await store.startRun(runId);
      await store.finishRun(runId, 2, 'https://example.com/sitemap.xml', null);
    },
  };
  const worker = new CrawlWorker(testPrisma, crawler);
  await worker.processQueue();

  const finished = await testPrisma.crawlRun.findUnique({ where: { id: run.id } });
  assert.equal(finished.status, 2);
  assert.ok(finished.startedAt instanceof Date);
  assert.ok(finished.finishedAt instanceof Date);
  assert.equal(finished.sitemapUrl, 'https://example.com/sitemap.xml');
  assert.equal(finished.error, null);
});

test('exception before claiming transitions 0 -> 1 -> 3 with error recorded', async () => {
  const run = await testPrisma.crawlRun.create({ data: { clientId: testClient.id, status: 0 } });
  const crawler = { crawlClient: async () => { throw new Error('Pre-claim failure: database transient error'); } };
  const worker = new CrawlWorker(testPrisma, crawler);
  await worker.processQueue();

  const failed = await testPrisma.crawlRun.findUnique({ where: { id: run.id } });
  assert.equal(failed.status, 3);
  assert.ok(failed.startedAt instanceof Date);
  assert.ok(failed.finishedAt instanceof Date);
  assert.match(failed.error, /Pre-claim failure: database transient error/);
});

test('exception after claiming transitions 1 -> 3 without leaving run in running state', async () => {
  const run = await testPrisma.crawlRun.create({ data: { clientId: testClient.id, status: 0 } });
  const store = new PrismaCrawlStore(testPrisma);
  const crawler = {
    crawlClient: async (clientId, skip, runId) => {
      await store.startRun(runId);
      // Simulates unexpected process error or network failure after claiming
      throw new Error('Fatal socket failure during crawl execution');
    },
  };
  const worker = new CrawlWorker(testPrisma, crawler);
  await worker.processQueue();

  const failed = await testPrisma.crawlRun.findUnique({ where: { id: run.id } });
  assert.equal(failed.status, 3);
  assert.ok(failed.startedAt instanceof Date);
  assert.ok(failed.finishedAt instanceof Date);
  assert.match(failed.error, /Fatal socket failure during crawl execution/);
});

test('concurrent workers process distinct pending runs without duplicate claims', async () => {
  const runIds = [];
  for (let i = 0; i < 5; i++) {
    const client = await auxiliaryClient();
    const run = await testPrisma.crawlRun.create({ data: { clientId: client.id, status: 0 } });
    runIds.push(run.id);
  }
  const store = new PrismaCrawlStore(testPrisma);
  const processedByWorker = new Map();

  const createWorkerInstance = (workerName) => {
    const crawler = {
      crawlClient: async (clientId, skip, runId) => {
        await store.startRun(runId);
        // Small delay to simulate work and allow concurrent workers to compete
        await new Promise((resolve) => setTimeout(resolve, 20));
        processedByWorker.set(runId, workerName);
        await store.finishRun(runId, 2, null, null);
      },
    };
    return new CrawlWorker(testPrisma, crawler);
  };

  const workerA = createWorkerInstance('WorkerA');
  const workerB = createWorkerInstance('WorkerB');
  const workerC = createWorkerInstance('WorkerC');

  await Promise.all([
    workerA.processQueue(),
    workerB.processQueue(),
    workerC.processQueue(),
  ]);

  const allFinished = await testPrisma.crawlRun.findMany({ where: { id: { in: runIds } } });
  assert.equal(allFinished.length, 5);
  for (const r of allFinished) {
    assert.equal(r.status, 2, `Run ${r.id} must be completed`);
  }
  assert.equal(processedByWorker.size, 5, 'All 5 runs must be processed by workers');
});

test('application restart preserves running jobs untouched while processing pending work', async () => {
  const abandonedClient = await auxiliaryClient();
  const existingRunning = await testPrisma.crawlRun.create({ data: { clientId: abandonedClient.id, status: 1 } });
  const pendingRun = await testPrisma.crawlRun.create({ data: { clientId: testClient.id, status: 0 } });

  const store = new PrismaCrawlStore(testPrisma);
  const processedRuns = [];
  const crawler = {
    crawlClient: async (clientId, skip, runId) => {
      await store.startRun(runId);
      processedRuns.push(runId);
      await store.finishRun(runId, 2, null, null);
    },
  };

  const worker = new CrawlWorker(testPrisma, crawler);
  await worker.onApplicationBootstrap();
  // Allow setImmediate loop to execute
  await new Promise((resolve) => setTimeout(resolve, 50));
  await worker.beforeApplicationShutdown();

  const checkRunning = await testPrisma.crawlRun.findUnique({ where: { id: existingRunning.id } });
  assert.equal(checkRunning.status, 1, 'Running job from before restart must remain untouched');

  const checkPending = await testPrisma.crawlRun.findUnique({ where: { id: pendingRun.id } });
  assert.equal(checkPending.status, 2, 'Pending job must be processed to completion');
  assert.deepEqual(processedRuns, [pendingRun.id]);
});

test('PrismaCrawlStore handles concurrent page persistence and deduplication on real PostgreSQL', async () => {
  const store = new PrismaCrawlStore(testPrisma);
  await store.ensureIssueTypes();

  const clientA = await auxiliaryClient();
  const clientB = await auxiliaryClient();
  const runA = await testPrisma.crawlRun.create({ data: { clientId: clientA.id, status: 1 } });
  const runB = await testPrisma.crawlRun.create({ data: { clientId: clientB.id, status: 1 } });

  const crypto = require('node:crypto');
  const hashA = crypto.createHash('sha256').update('content-a').digest('hex');
  const hashB = crypto.createHash('sha256').update('content-b').digest('hex');

  const analysisA = {
    content: {
      title: 'Guide A',
      metaDescription: 'Description A',
      h1: 'Header A',
      wordCount: 400,
      missingImageAltCount: 0,
      contentHash: hashA,
    },
    httpStatusCode: 200,
    keywords: [
      { phrase: 'shared concurrency keyword', relevanceScore: 0.9 },
      { phrase: 'unique keyword a', relevanceScore: 0.8 },
    ],
    issues: [{ issueTypeId: 6, code: 'THIN_CONTENT', severity: 1, details: 'Thin content' }],
  };

  const analysisB = {
    content: {
      title: 'Guide B',
      metaDescription: 'Description B',
      h1: 'Header B',
      wordCount: 500,
      missingImageAltCount: 1,
      contentHash: hashB,
    },
    httpStatusCode: 200,
    keywords: [
      { phrase: 'shared concurrency keyword', relevanceScore: 0.85 },
      { phrase: 'unique keyword b', relevanceScore: 0.75 },
    ],
    issues: [{ issueTypeId: 4, code: 'MISSING_IMAGE_ALT', severity: 1, details: 'Missing alt' }],
  };

  // Run both saves concurrently
  await Promise.all([
    store.savePage(clientA.id, runA.id, 'https://example.com/blog/page-a', 1, analysisA),
    store.savePage(clientB.id, runB.id, 'https://example.com/blog/page-b', 1, analysisB),
  ]);

  // Verify that shared keyword was created exactly once
  const sharedKws = await testPrisma.keyword.findMany({
    where: { phrase: 'shared concurrency keyword' },
  });
  assert.equal(sharedKws.length, 1);

  // Verify page crawls were both persisted in terminal status 2
  const crawlsA = await testPrisma.pageCrawl.findMany({ where: { crawlRunId: runA.id } });
  const crawlsB = await testPrisma.pageCrawl.findMany({ where: { crawlRunId: runB.id } });
  assert.equal(crawlsA.length, 1);
  assert.equal(crawlsB.length, 1);
  assert.equal(crawlsA[0].status, 2);
  assert.equal(crawlsB[0].status, 2);
  await Promise.all([
    store.finishRun(runA.id, 2, null, null),
    store.finishRun(runB.id, 2, null, null),
  ]);
});

test('ClientsRepository creates client and crawl run atomically on real database', async () => {
  const repo = new ClientsRepository(testPrisma);
  const result = await repo.createWithInitialRun({
    userId: testUser.id,
    websiteUrl: 'https://atomictest.example.com',
    normalizedDomain: 'atomictest.example.com',
    name: 'Atomic Test',
  });

  assert.ok(result.client.id);
  assert.equal(result.client.normalizedDomain, 'atomictest.example.com');
  assert.ok(result.crawlRun.id);
  assert.equal(result.crawlRun.status, 0);

  // Verify atomic creation in PostgreSQL
  const dbClient = await testPrisma.client.findUnique({ where: { id: result.client.id } });
  const dbRun = await testPrisma.crawlRun.findUnique({ where: { id: result.crawlRun.id } });
  assert.equal(dbClient.id, result.client.id);
  assert.equal(dbRun.clientId, result.client.id);
  assert.equal(dbRun.status, 0);
});

test('ClientsRepository translates database P2002 duplicate domain collision to DuplicateClientError', async () => {
  const repo = new ClientsRepository(testPrisma);
  await assert.rejects(
    repo.createWithInitialRun({
      userId: testUser.id,
      websiteUrl: 'https://atomictest.example.com/another-path',
      normalizedDomain: 'atomictest.example.com',
      name: 'Duplicate Domain Test',
    }),
    DuplicateClientError
  );
});

test('ClientsRepository enforces tenant isolation in existsForUser and listWithSummary', async () => {
  const repo = new ClientsRepository(testPrisma);
  const otherUser = await testPrisma.user.create({
    data: { email: 'other-user@example.com', passwordHash: 'hash', timezone: 'UTC' },
  });

  // existsForUser checks
  assert.equal(await repo.existsForUser(testClient.id, testUser.id), true);
  assert.equal(await repo.existsForUser(testClient.id, otherUser.id), false);

  // listWithSummary checks
  const testUserClients = await repo.listWithSummary(testUser.id);
  const otherUserClients = await repo.listWithSummary(otherUser.id);

  assert.ok(testUserClients.some((c) => c.id === testClient.id));
  assert.equal(otherUserClients.length, 0);
});

test('archive preserves history, hides pages, and serializes concurrent recrawl requests', async () => {
  const repo = new ClientsRepository(testPrisma);
  const pagesRepo = new PagesRepository(testPrisma);
  const client = await auxiliaryClient();
  const page = await testPrisma.page.create({ data: {
    clientId: client.id, url: `${client.websiteUrl}/blog/historical-page`,
  } });
  const keyword = await testPrisma.keyword.create({ data: { phrase: `archive test keyword ${auxiliaryClientNumber}` } });
  const relation = await testPrisma.pageKeyword.create({ data: { pageId: page.id, keywordId: keyword.id } });
  const snapshot = await testPrisma.rankSnapshot.create({ data: {
    pageKeywordId: relation.id, snapshotDate: new Date('2026-10-20T00:00:00Z'),
    snapshotAt: new Date('2026-10-20T12:00:00Z'), position: 12,
  } });

  const foreignUserId = '00000000-0000-4000-8000-000000000001';
  assert.equal((await repo.setArchived(foreignUserId, client.id, true)).kind, 'not-found');
  assert.equal((await repo.queueRecrawl(foreignUserId, client.id)).kind, 'not-found');
  assert.equal((await repo.setArchived(testUser.id, client.id, true)).kind, 'changed');
  assert.equal((await repo.setArchived(testUser.id, client.id, true)).kind, 'unchanged');
  assert.equal((await repo.listWithSummary(testUser.id)).some((item) => item.id === client.id), false);
  assert.equal((await repo.listWithSummary(testUser.id, 'archived')).some((item) => item.id === client.id), true);
  assert.equal(await pagesRepo.pageExistsForTenant(testUser.id, page.id), false);
  assert.equal(await pagesRepo.findPageById(testUser.id, page.id), null);
  assert.deepEqual(await pagesRepo.findRankSnapshotsForTenant(testUser.id, page.id, relation.id,
    new Date('2026-10-20T00:00:00Z'), new Date('2026-10-21T00:00:00Z')), []);
  assert.equal((await repo.queueRecrawl(testUser.id, client.id)).kind, 'archived');
  const crawlStore = new PrismaCrawlStore(testPrisma);
  assert.equal(await crawlStore.getClient(client.id), null);
  await assert.rejects(crawlStore.createRun(client.id), /Client is archived or unavailable/);
  assert.equal((await testPrisma.rankSnapshot.findUnique({ where: { id: snapshot.id } })).position, 12);

  assert.equal((await repo.setArchived(testUser.id, client.id, false)).kind, 'changed');
  assert.equal((await repo.setArchived(testUser.id, client.id, false)).kind, 'unchanged');
  assert.equal(await pagesRepo.pageExistsForTenant(testUser.id, page.id), true);
  assert.equal((await pagesRepo.findRankSnapshotsForTenant(testUser.id, page.id, relation.id,
    new Date('2026-10-20T00:00:00Z'), new Date('2026-10-21T00:00:00Z'))).length, 1);
  assert.equal((await repo.listWithSummary(testUser.id)).some((item) => item.id === client.id), true);

  const results = await Promise.all([
    repo.queueRecrawl(testUser.id, client.id), repo.queueRecrawl(testUser.id, client.id),
  ]);
  assert.deepEqual(results.map((result) => result.kind).sort(), ['active-crawl', 'created']);
  assert.equal((await repo.setArchived(testUser.id, client.id, true)).kind, 'active-crawl');
  const runId = results.find((result) => result.kind === 'created').crawlRun.id;
  await testPrisma.crawlRun.update({ where: { id: runId }, data: { status: 1, startedAt: new Date() } });
  assert.equal((await repo.setArchived(testUser.id, client.id, true)).kind, 'active-crawl');
  await testPrisma.crawlRun.update({ where: { id: runId }, data: { status: 2, finishedAt: new Date() } });
  assert.equal((await repo.setArchived(testUser.id, client.id, true)).kind, 'changed');
  assert.equal((await testPrisma.page.findUnique({ where: { id: page.id } })).id, page.id);
  assert.equal((await testPrisma.rankSnapshot.findUnique({ where: { id: snapshot.id } })).position, 12);
});

test('ClientsRepository.findLatestCrawlStatus returns latest run with processed and failed counts', async () => {
  const repo = new ClientsRepository(testPrisma);
  const run = await testPrisma.crawlRun.create({
    data: { clientId: testClient.id, status: 1 },
  });

  const page1 = await testPrisma.page.create({
    data: { clientId: testClient.id, url: 'https://example.com/blog/page-1' },
  });
  const page2 = await testPrisma.page.create({
    data: { clientId: testClient.id, url: 'https://example.com/blog/page-2' },
  });

  await testPrisma.pageCrawl.create({
    data: { crawlRunId: run.id, pageId: page1.id, clientId: testClient.id, status: 2 },
  });
  await testPrisma.pageCrawl.create({
    data: { crawlRunId: run.id, pageId: page2.id, clientId: testClient.id, status: 3, error: 'HTTP 404' },
  });

  const status = await repo.findLatestCrawlStatus(testClient.id);
  assert.equal(status.id, run.id);
  assert.equal(status.processedPages, 1);
  assert.equal(status.failedPages, 1);
});

test('PagesRepository executes tenant-isolated queries and projections on real database', async () => {
  const pagesRepo = new PagesRepository(testPrisma);
  const otherUser = await testPrisma.user.create({
    data: { email: 'pages-other-user@example.com', passwordHash: 'hash', timezone: 'UTC' },
  });
  const otherClient = await testPrisma.client.create({
    data: { userId: otherUser.id, websiteUrl: 'https://other.com', normalizedDomain: 'other.com', name: 'Other' },
  });

  const page = await testPrisma.page.create({
    data: { clientId: testClient.id, url: 'https://example.com/products/widget' },
  });
  const otherPage = await testPrisma.page.create({
    data: { clientId: otherClient.id, url: 'https://other.com/secret' },
  });

  const kw = await testPrisma.keyword.create({ data: { phrase: 'super widget keyword' } });
  const pk = await testPrisma.pageKeyword.create({ data: { pageId: page.id, keywordId: kw.id } });

  const run = await testPrisma.crawlRun.create({ data: { clientId: testClient.id, status: 2 } });
  const pageCrawl = await testPrisma.pageCrawl.create({
    data: {
      crawlRunId: run.id,
      pageId: page.id,
      clientId: testClient.id,
      status: 0,
      title: 'Widget Page',
      metaDescription: 'Buy widget',
      h1: 'Widget Store',
      wordCount: 500,
      contentHash: 'a'.repeat(64),
    },
  });

  await testPrisma.pageCrawlKeyword.create({
    data: { pageCrawlId: pageCrawl.id, pageId: page.id, keywordId: kw.id, relevanceScore: 0.95 },
  });

  await testPrisma.pageCrawl.update({
    where: { id: pageCrawl.id },
    data: { status: 2, processedAt: new Date() },
  });

  await testPrisma.rankSnapshot.create({
    data: {
      pageKeywordId: pk.id,
      snapshotDate: new Date('2026-10-20T00:00:00Z'),
      snapshotAt: new Date('2026-10-20T12:00:00Z'),
      position: 3,
    },
  });

  // 1. pageExistsForTenant
  assert.equal(await pagesRepo.pageExistsForTenant(testUser.id, page.id), true);
  assert.equal(await pagesRepo.pageExistsForTenant(otherUser.id, page.id), false);
  assert.equal(await pagesRepo.pageExistsForTenant(testUser.id, otherPage.id), false);

  // 2. findPageById with relational projections
  const foundPage = await pagesRepo.findPageById(testUser.id, page.id);
  assert.ok(foundPage);
  assert.equal(foundPage.url, 'https://example.com/products/widget');
  assert.equal(foundPage.pageCrawls.length, 1);
  assert.equal(foundPage.pageCrawls[0].title, 'Widget Page');
  assert.equal(foundPage.pageCrawls[0].pageCrawlKeywords[0].keyword.phrase, 'super widget keyword');
  assert.equal(foundPage.pageCrawls[0].pageCrawlKeywords[0].pageKeyword.rankSnapshots[0].position, 3);

  // Cross-user findPageById returns null
  assert.equal(await pagesRepo.findPageById(otherUser.id, page.id), null);
  assert.equal(await pagesRepo.findPageById(testUser.id, otherPage.id), null);

  // 3. findPaginatedPages with keyword search and tenant isolation
  const paginated = await pagesRepo.findPaginatedPages(testUser.id, {
    keyword: 'widget',
    page: 1,
    pageSize: 10,
  });
  assert.ok(paginated.total >= 1);
  assert.ok(paginated.pages.some((p) => p.id === page.id));

  const otherPaginated = await pagesRepo.findPaginatedPages(otherUser.id, {
    keyword: 'widget',
    page: 1,
    pageSize: 10,
  });
  assert.equal(otherPaginated.total, 0);

  // 4. findPageKeywordForTenant
  const rel = await pagesRepo.findPageKeywordForTenant(testUser.id, page.id, pk.id);
  assert.ok(rel);
  assert.equal(rel.keyword.phrase, 'super widget keyword');
  assert.equal(await pagesRepo.findPageKeywordForTenant(otherUser.id, page.id, pk.id), null);

  // 5. findRankSnapshotsForTenant
  const snapshots = await pagesRepo.findRankSnapshotsForTenant(
    testUser.id,
    page.id,
    pk.id,
    new Date('2026-10-20T00:00:00Z'),
    new Date('2026-10-21T00:00:00Z'),
  );
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].position, 3);

  // Cross-tenant snapshot query yields nothing even if pageKeywordId is provided
  const crossSnapshots = await pagesRepo.findRankSnapshotsForTenant(
    otherUser.id,
    page.id,
    pk.id,
    new Date('2026-10-20T00:00:00Z'),
    new Date('2026-10-21T00:00:00Z'),
  );
  assert.equal(crossSnapshots.length, 0);
});

test('AuthRepository executes user lookup, refresh token lifecycle, atomic rotation, and concurrency safety on real PostgreSQL', async () => {
  const repo = new AuthRepository(testPrisma);

  // 1. findUserByNormalizedEmail
  const user = await repo.findUserByNormalizedEmail(testUser.email);
  assert.ok(user);
  assert.equal(user.id, testUser.id);
  assert.equal(user.email, testUser.email);
  assert.equal(user.passwordHash, testUser.passwordHash);

  // Nonexistent email returns null
  assert.equal(await repo.findUserByNormalizedEmail('nonexistent-email@example.com'), null);

  // 2. createRefreshToken
  const tokenHash1 = `rt-hash-1-${Date.now()}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await repo.createRefreshToken({
    tokenHash: tokenHash1,
    userId: testUser.id,
    expiresAt,
  });

  const storedToken = await testPrisma.refreshToken.findUnique({ where: { tokenHash: tokenHash1 } });
  assert.ok(storedToken);
  assert.equal(storedToken.userId, testUser.id);

  // 3. rotateRefreshToken atomically
  const tokenHash2 = `rt-hash-2-${Date.now()}`;
  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const rotated = await repo.rotateRefreshToken(tokenHash1, tokenHash2, newExpiresAt);
  assert.ok(rotated);
  assert.equal(rotated.id, testUser.id);
  assert.equal(rotated.email, testUser.email);

  // Old token must be deleted immediately
  assert.equal(await testPrisma.refreshToken.findUnique({ where: { tokenHash: tokenHash1 } }), null);
  // New token must exist
  assert.ok(await testPrisma.refreshToken.findUnique({ where: { tokenHash: tokenHash2 } }));

  // 4. Replay rejection: rotating already rotated token must return null
  const replayAttempt = await repo.rotateRefreshToken(tokenHash1, `rt-replay-${Date.now()}`, newExpiresAt);
  assert.equal(replayAttempt, null, 'Replay attempt must be rejected');

  // 5. Concurrent refresh attempts on real PostgreSQL: only one must succeed
  const concurrentOldToken = `rt-concurrent-${Date.now()}`;
  await repo.createRefreshToken({
    tokenHash: concurrentOldToken,
    userId: testUser.id,
    expiresAt,
  });

  const [attemptA, attemptB] = await Promise.all([
    repo.rotateRefreshToken(concurrentOldToken, `rt-winner-a-${Date.now()}`, newExpiresAt),
    repo.rotateRefreshToken(concurrentOldToken, `rt-winner-b-${Date.now()}`, newExpiresAt),
  ]);

  const winners = [attemptA, attemptB].filter(Boolean);
  assert.equal(winners.length, 1, 'Exactly one concurrent refresh attempt must succeed');
  const losers = [attemptA, attemptB].filter((r) => r === null);
  assert.equal(losers.length, 1, 'The other concurrent refresh attempt must return null');

  // 6. revokeRefreshToken (logout)
  await repo.revokeRefreshToken(tokenHash2);
  assert.equal(await testPrisma.refreshToken.findUnique({ where: { tokenHash: tokenHash2 } }), null);

  // 7. deleteExpiredRefreshTokens
  const expiredHash = `expired-rt-${Date.now()}`;
  await repo.createRefreshToken({
    tokenHash: expiredHash,
    userId: testUser.id,
    expiresAt: new Date(Date.now() - 10_000),
  });
  const activeHash = `active-rt-${Date.now()}`;
  await repo.createRefreshToken({
    tokenHash: activeHash,
    userId: testUser.id,
    expiresAt: new Date(Date.now() + 60_000),
  });

  const deletedCount = await repo.deleteExpiredRefreshTokens();
  assert.ok(deletedCount >= 1);
  const dbExpired = await testPrisma.refreshToken.findUnique({ where: { tokenHash: expiredHash } });
  const dbActive = await testPrisma.refreshToken.findUnique({ where: { tokenHash: activeHash } });
  assert.equal(dbExpired, null, 'Expired refresh token must be deleted');
  assert.ok(dbActive, 'Active refresh token must be preserved');
});

test('PostgresThrottlerStorage manages atomic hits, limits, and cleanup on real PostgreSQL', async () => {
  const storage = new PostgresThrottlerStorage(testPrisma);
  const key = `test-ip-${Date.now()}`;

  // First hit
  const first = await storage.increment(key, 60_000, 2, 0, 'ip');
  assert.equal(first.totalHits, 1);
  assert.equal(first.isBlocked, false);
  assert.ok(first.timeToExpire > 0);

  // Second hit
  const second = await storage.increment(key, 60_000, 2, 0, 'ip');
  assert.equal(second.totalHits, 2);
  assert.equal(second.isBlocked, false);

  // Third hit (exceeds limit 2) with blockDuration of 120,000ms
  const third = await storage.increment(key, 60_000, 2, 120_000, 'ip');
  assert.equal(third.totalHits, 3);
  assert.equal(third.isBlocked, true);
  assert.ok(third.timeToBlockExpire >= 118 && third.timeToBlockExpire <= 120, `Expected ~120s, got ${third.timeToBlockExpire}`);
  assert.equal(third.timeToExpire, third.timeToBlockExpire);

  // 4. Test atomic concurrent increments on real PostgreSQL
  const concurrentKey = `test-concurrent-throttle-${Date.now()}`;
  const concurrentHits = await Promise.all(
    Array.from({ length: 5 }, () => storage.increment(concurrentKey, 60_000, 10, 0, 'ip'))
  );
  const totalHitNumbers = concurrentHits.map((h) => h.totalHits).sort((a, b) => a - b);
  assert.deepEqual(totalHitNumbers, [1, 2, 3, 4, 5], 'Concurrent increments must be atomic and unique');

  // 5. Test expired window reset behavior: expired throttle resets hits to 1
  const resetKey = `test-reset-${Date.now()}`;
  await testPrisma.authThrottle.create({
    data: {
      key: resetKey,
      hits: 10,
      expiresAt: new Date(Date.now() - 5000),
    },
  });
  const afterExpired = await storage.increment(resetKey, 60_000, 5, 0, 'ip');
  assert.equal(afterExpired.totalHits, 1, 'Expired window must reset hits to 1');
  assert.equal(afterExpired.isBlocked, false);
  assert.ok(afterExpired.timeToExpire > 50);

  // 6. Test long key hashing: keys exceeding 64 chars are safely hashed with SHA-256
  const longKey = 'a'.repeat(128);
  const longKeyRecord = await storage.increment(longKey, 60_000, 5, 0, 'ip');
  assert.equal(longKeyRecord.totalHits, 1);
  const expectedHash = require('node:crypto').createHash('sha256').update(longKey).digest('hex');
  const dbHashed = await testPrisma.authThrottle.findUnique({ where: { key: expectedHash } });
  assert.ok(dbHashed, 'Key exceeding 64 characters must be hashed with SHA-256');

  // 7. Test deleteExpiredThrottles
  const expiredKey = `expired-throttle-${Date.now()}`;
  await testPrisma.authThrottle.create({
    data: {
      key: expiredKey,
      hits: 5,
      expiresAt: new Date(Date.now() - 5000),
    },
  });
  const deletedCount = await storage.deleteExpiredThrottles();
  assert.ok(deletedCount >= 1);
  const checkExpired = await testPrisma.authThrottle.findUnique({ where: { key: expiredKey } });
  assert.equal(checkExpired, null, 'Expired throttle must be deleted');
  const checkActive = await testPrisma.authThrottle.findUnique({ where: { key } });
  assert.ok(checkActive, 'Active throttle must be preserved');
});

test('AuthStateCleanupService coordinates expired refresh tokens and throttles cleanup on real PostgreSQL', async () => {
  const authRepo = new AuthRepository(testPrisma);
  const throttlerStorage = new PostgresThrottlerStorage(testPrisma);
  const cleanupService = new AuthStateCleanupService(authRepo, throttlerStorage);

  const expiredTokenHash = `cleanup-svc-token-${Date.now()}`;
  await authRepo.createRefreshToken({
    tokenHash: expiredTokenHash,
    userId: testUser.id,
    expiresAt: new Date(Date.now() - 10_000),
  });

  const expiredThrottleKey = `cleanup-svc-throttle-${Date.now()}`;
  await testPrisma.authThrottle.create({
    data: {
      key: expiredThrottleKey,
      hits: 1,
      expiresAt: new Date(Date.now() - 10_000),
    },
  });

  const result = await cleanupService.cleanupExpiredState();
  assert.ok(result.refreshTokens >= 1);
  assert.ok(result.throttles >= 1);

  assert.equal(await testPrisma.refreshToken.findUnique({ where: { tokenHash: expiredTokenHash } }), null);
  assert.equal(await testPrisma.authThrottle.findUnique({ where: { key: expiredThrottleKey } }), null);
});

test('UsersRepository executes profile retrieval and scoped timezone updates on real PostgreSQL', async () => {
  const usersRepo = new UsersRepository(testPrisma);

  // 1. findById returns user profile and omits passwordHash
  const profile = await usersRepo.findById(testUser.id);
  assert.ok(profile);
  assert.equal(profile.id, testUser.id);
  assert.equal(profile.email, testUser.email);
  assert.equal(profile.passwordHash, undefined, 'passwordHash must never be exposed');

  // Nonexistent user returns null
  assert.equal(await usersRepo.findById('00000000-0000-0000-0000-000000000000'), null);

  // 2. updateTimezone updates the user row in PostgreSQL
  const updated = await usersRepo.updateTimezone(testUser.id, 'Pacific/Auckland');
  assert.equal(updated.id, testUser.id);
  assert.equal(updated.timezone, 'Pacific/Auckland');

  const checkDb = await testPrisma.user.findUnique({ where: { id: testUser.id } });
  assert.equal(checkDb.timezone, 'Pacific/Auckland');

  // Revert back
  await usersRepo.updateTimezone(testUser.id, 'UTC');
});