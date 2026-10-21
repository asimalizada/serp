const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CrawlWorker } = require('../dist/crawler/workers/crawl-worker.js');
const { CrawlRunNotPendingError } = require('../dist/crawler/persistence/prisma-crawl.store.js');
const { ClientsService } = require('../dist/clients/clients.service.js');
const { ClientsRepository } = require('../dist/clients/repositories/clients.repository.js');
const { DuplicateClientError } = require('../dist/clients/errors/duplicate-client.error.js');
const { createClientSchema, clientListQuerySchema } = require('@serp/shared');
const { describeCrawlError } = require('../dist/clients/crawl-error.js');
const { ZodValidationPipe } = require('../dist/common/pipes/zod-validation.pipe.js');

test('startup preserves running crawl history and processes only pending work', async () => {
  const runs = [
    { id: 'running', clientId: 'client', status: 1 },
    { id: 'pending', clientId: 'client', status: 0 },
  ];
  const calls = [];
  const prisma = {
    crawlRun: {
      count: async () => 1,
      findFirst: async () => {
        const pending = runs.find((run) => run.status === 0);
        return pending && { ...pending, client: { websiteUrl: 'https://example.com' } };
      },
    },
    page: { findMany: async () => [{ url: 'https://example.com/blog/already-done' }] },
  };
  const crawler = {
    crawlClient: async (clientId, skip, runId) => {
      calls.push({ clientId, skip: [...skip], runId });
      runs.find((run) => run.id === runId).status = 2;
    },
  };
  const worker = new CrawlWorker(prisma, crawler);
  worker.schedule = () => {};
  await worker.onApplicationBootstrap();
  assert.equal(runs[0].status, 1);
  await worker.processQueue();
  assert.deepEqual(calls, [{ clientId: 'client', skip: [], runId: 'pending' }]);
  assert.equal(runs[1].status, 2);
  await worker.beforeApplicationShutdown();
});

test('handles exception before claiming by transitioning 0 -> 1 -> 3', async () => {
  const run = { id: 'run-pre-claim', clientId: 'client', status: 0, error: null };
  const transitions = [];
  const prisma = {
    crawlRun: {
      findFirst: async () => run.status === 0 ? { ...run, client: { websiteUrl: 'https://example.com' } } : null,
      findUnique: async () => ({ status: run.status }),
      updateMany: async ({ where, data }) => {
        if (where.status !== run.status) return { count: 0 };
        transitions.push(`${run.status}->${data.status}`);
        run.status = data.status;
        if (data.error) run.error = data.error;
        return { count: 1 };
      },
    },
  };
  const crawler = { crawlClient: async () => { throw new Error('Failure before claiming the run'); } };
  const worker = new CrawlWorker(prisma, crawler);
  await worker.processQueue();
  assert.deepEqual(transitions, ['0->1', '1->3']);
  assert.equal(run.status, 3);
  assert.match(run.error, /Failure before claiming the run/);
});

test('handles exception after claiming by transitioning 1 -> 3 without leaving run in running state', async () => {
  const run = { id: 'run-post-claim', clientId: 'client', status: 0, error: null };
  const transitions = [];
  const prisma = {
    crawlRun: {
      findFirst: async () => run.status === 0 ? { ...run, client: { websiteUrl: 'https://example.com' } } : null,
      findUnique: async () => ({ status: run.status }),
      updateMany: async ({ where, data }) => {
        if (where.status !== run.status) return { count: 0 };
        transitions.push(`${run.status}->${data.status}`);
        run.status = data.status;
        if (data.error) run.error = data.error;
        return { count: 1 };
      },
    },
    page: { findMany: async () => [] },
  };
  const crawler = {
    crawlClient: async (_clientId, _skip, runId) => {
      // Simulates startRun succeeding inside crawlClient, followed by unexpected crash
      transitions.push('claim:0->1');
      run.status = 1;
      throw new Error('Crawler crashed unexpectedly after starting');
    },
  };
  const worker = new CrawlWorker(prisma, crawler);
  await worker.processQueue();
  assert.deepEqual(transitions, ['claim:0->1', '1->3']);
  assert.equal(run.status, 3);
  assert.match(run.error, /Crawler crashed unexpectedly after starting/);
});

test('handles CrawlRunNotPendingError without modifying the run', async () => {
  const run = { id: 'run-claimed-elsewhere', clientId: 'client', status: 1 };
  let updateManyCalled = false;
  const prisma = {
    crawlRun: {
      findFirst: async () => ({ ...run, client: { websiteUrl: 'https://example.com' } }),
      findUnique: async () => ({ status: run.status }),
      updateMany: async () => {
        updateManyCalled = true;
        return { count: 1 };
      },
    },
    page: { findMany: async () => [] },
  };
  let firstCall = true;
  prisma.crawlRun.findFirst = async () => {
    if (firstCall) {
      firstCall = false;
      return { ...run, client: { websiteUrl: 'https://example.com' } };
    }
    return null;
  };
  const crawler = {
    crawlClient: async () => {
      throw new CrawlRunNotPendingError(run.id);
    },
  };
  const worker = new CrawlWorker(prisma, crawler);
  await worker.processQueue();
  assert.equal(updateManyCalled, false, 'Should not modify a run claimed by another worker');
  assert.equal(run.status, 1, 'Status remains unchanged');
});

test('repeated schedule() calls do not spawn concurrent worker loops', async () => {
  let activeLoops = 0;
  let maxConcurrentLoops = 0;
  let processCount = 0;
  const prisma = {
    crawlRun: {
      findFirst: async () => {
        if (processCount >= 3) return null;
        processCount++;
        return { id: `run-${processCount}`, clientId: 'client', client: { websiteUrl: 'https://example.com' } };
      },
    },
    page: { findMany: async () => [] },
  };
  const crawler = {
    crawlClient: async () => {
      activeLoops++;
      maxConcurrentLoops = Math.max(maxConcurrentLoops, activeLoops);
      await new Promise((resolve) => setTimeout(resolve, 15));
      activeLoops--;
    },
  };
  const worker = new CrawlWorker(prisma, crawler);
  // Call schedule rapidly multiple times
  worker.schedule();
  worker.schedule();
  worker.schedule();
  // Wait for setImmediate queue processing
  await new Promise((resolve) => setTimeout(resolve, 80));
  await worker.beforeApplicationShutdown();
  assert.equal(maxConcurrentLoops, 1, 'Should never run more than one loop concurrently');
  assert.equal(processCount, 3);
});

test('scheduling request received while finishing queue is not lost', async () => {
  let loopCount = 0;
  const runs = [
    { id: 'run-1', clientId: 'client', status: 0 },
  ];
  const processed = [];
  const prisma = {
    crawlRun: {
      findFirst: async () => {
        loopCount++;
        const item = runs.find((r) => r.status === 0);
        return item ? { ...item, client: { websiteUrl: 'https://example.com' } } : null;
      },
    },
    page: { findMany: async () => [] },
  };
  const crawler = {
    crawlClient: async (_clientId, _skip, runId) => {
      processed.push(runId);
      const r = runs.find((item) => item.id === runId);
      if (r) r.status = 2;
      // While run-1 is completing, a new job arrives
      if (runId === 'run-1') {
        runs.push({ id: 'run-2', clientId: 'client', status: 0 });
        worker.schedule();
      }
    },
  };
  const worker = new CrawlWorker(prisma, crawler);
  await worker.processQueue();
  // Allow any rescheduled setImmediate to run
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(processed, ['run-1', 'run-2']);
  await worker.beforeApplicationShutdown();
});

test('scheduling during shutdown is ignored', async () => {
  let findFirstCalls = 0;
  const prisma = {
    crawlRun: { findFirst: async () => { findFirstCalls++; return null; } },
  };
  const crawler = { crawlClient: async () => {} };
  const worker = new CrawlWorker(prisma, crawler);
  await worker.beforeApplicationShutdown();
  worker.schedule();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(findFirstCalls, 0, 'No work should be scheduled after shutdown');
});

test('ClientsService.create validates URL, persists through ClientsRepository, and schedules worker', async () => {
  const calls = [];
  const repo = {
    createWithInitialRun: async (data) => {
      calls.push({ type: 'repo.create', data });
      return {
        client: { id: 'client-1', ...data, createdAt: new Date() },
        crawlRun: { id: 'run-1', status: 0 },
      };
    },
  };
  const worker = {
    schedule: () => {
      calls.push({ type: 'worker.schedule' });
    },
  };
  const http = {
    validateDestination: async (url) => {
      calls.push({ type: 'http.validate', url });
      return 'https://example.com/blog/';
    },
  };

  const service = new ClientsService(repo, worker, http);
  const result = await service.create('user-1', { websiteUrl: 'https://example.com/blog/', name: '  My Blog  ' });

  assert.equal(result.client.id, 'client-1');
  assert.equal(result.client.normalizedDomain, 'example.com');
  assert.equal(result.client.name, 'My Blog');
  assert.equal(result.crawlRun.status, 0);
  assert.deepEqual(calls.map((c) => c.type), ['http.validate', 'repo.create', 'worker.schedule']);
});

test('ClientsService.create throws BadRequestException on invalid URL without calling repository or worker', async () => {
  let repoCalled = false;
  let workerScheduled = false;
  const repo = {
    createWithInitialRun: async () => {
      repoCalled = true;
    },
  };
  const worker = {
    schedule: () => {
      workerScheduled = true;
    },
  };
  const http = {
    validateDestination: async () => {
      throw new Error('Unsafe destination: 127.0.0.1');
    },
  };

  const service = new ClientsService(repo, worker, http);
  await assert.rejects(
    service.create('user-1', { websiteUrl: 'http://127.0.0.1' }),
    { name: 'BadRequestException', message: 'Unsafe destination: 127.0.0.1' }
  );
  assert.equal(repoCalled, false);
  assert.equal(workerScheduled, false);
});

test('ClientsService.create maps DuplicateClientError from repository to ConflictException without scheduling worker', async () => {
  let workerScheduled = false;
  const repo = {
    createWithInitialRun: async () => {
      throw new DuplicateClientError('Website already exists for this user');
    },
  };
  const worker = {
    schedule: () => {
      workerScheduled = true;
    },
  };
  const http = {
    validateDestination: async (url) => url,
  };

  const service = new ClientsService(repo, worker, http);
  await assert.rejects(
    service.create('user-1', { websiteUrl: 'https://example.com' }),
    { name: 'ConflictException', message: 'Website already exists for this user' }
  );
  assert.equal(workerScheduled, false);
});

test('ClientsService.list formats client summaries returned by ClientsRepository', async () => {
  const dummyClients = [
    {
      id: 'client-1',
      name: 'Client 1',
      websiteUrl: 'https://example.com',
      normalizedDomain: 'example.com',
      createdAt: new Date(),
      pageCount: 15,
      latestCrawl: { id: 'run-1', status: 2, error: null, processedPages: 15, failedPages: 0,
        createdAt: new Date(), startedAt: new Date(), finishedAt: new Date() },
    },
  ];
  const repo = {
    listWithSummary: async (userId) => {
      assert.equal(userId, 'user-1');
      return dummyClients;
    },
  };
  const service = new ClientsService(repo, {}, {});
  const res = await service.list('user-1');
  assert.deepEqual(res, { clients: dummyClients });
});

test('ClientsService.crawlStatus enforces tenant ownership and returns crawl status', async () => {
  const repo = {
    existsForUser: async (clientId, userId) => clientId === 'client-1' && userId === 'user-1',
    findLatestCrawlStatus: async (clientId) => ({
      id: 'run-1',
      status: 2,
      sitemapUrl: 'https://example.com/sitemap.xml',
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: new Date(),
      processedPages: 12,
      failedPages: 1,
      pageFailures: [],
    }),
  };
  const service = new ClientsService(repo, {}, {});

  // Non-owner query throws NotFoundException
  await assert.rejects(
    service.crawlStatus('user-other', 'client-1'),
    { name: 'NotFoundException', message: 'Client not found' }
  );
  await assert.rejects(
    service.crawlStatus('user-1', 'client-unknown'),
    { name: 'NotFoundException', message: 'Client not found' }
  );

  // Owner query succeeds
  const status = await service.crawlStatus('user-1', 'client-1');
  assert.equal(status.clientId, 'client-1');
  assert.equal(status.crawlRun.processedPages, 12);
  assert.equal(status.crawlRun.failedPages, 1);
});

test('client list query defaults to active and accepts only an explicit archived view', () => {
  assert.deepEqual(clientListQuerySchema.parse({}), { status: 'active' });
  assert.deepEqual(clientListQuerySchema.parse({ status: 'archived' }), { status: 'archived' });
  assert.equal(clientListQuerySchema.safeParse({ status: 'all' }).success, false);
});

test('ClientsService archives idempotently, rejects active crawls, and schedules recrawls once', async () => {
  let scheduled = 0;
  let archiveResult = { kind: 'changed', archivedAt: new Date('2026-10-21T00:00:00Z') };
  let recrawlResult = { kind: 'created', crawlRun: { id: 'run-1', status: 0 } };
  const repo = {
    setArchived: async () => archiveResult,
    queueRecrawl: async () => recrawlResult,
  };
  const service = new ClientsService(repo, { schedule: () => { scheduled++; } }, {});
  assert.equal((await service.setArchived('u1', 'c1', true)).changed, true);
  archiveResult = { kind: 'unchanged', archivedAt: archiveResult.archivedAt };
  assert.equal((await service.setArchived('u1', 'c1', true)).changed, false);
  archiveResult = { kind: 'active-crawl' };
  await assert.rejects(service.setArchived('u1', 'c1', true), { name: 'ConflictException' });
  archiveResult = { kind: 'not-found' };
  await assert.rejects(service.setArchived('u1', 'c1', true), { name: 'NotFoundException' });

  assert.equal((await service.recrawl('u1', 'c1')).crawlRun.status, 0);
  assert.equal(scheduled, 1);
  recrawlResult = { kind: 'active-crawl' };
  await assert.rejects(service.recrawl('u1', 'c1'), { name: 'ConflictException' });
  recrawlResult = { kind: 'archived' };
  await assert.rejects(service.recrawl('u1', 'c1'), { name: 'ConflictException' });
  recrawlResult = { kind: 'not-found' };
  await assert.rejects(service.recrawl('u1', 'c1'), { name: 'NotFoundException' });
  assert.equal(scheduled, 1);
});

test('crawl failure descriptions reveal known facts without echoing untrusted text', () => {
  assert.equal(describeCrawlError('No qualifying blog posts found in accessible sitemaps'),
    'No qualifying blog articles were found in accessible sitemaps.');
  assert.equal(describeCrawlError('HTTP 404'), 'The website returned HTTP 404.');
  assert.equal(describeCrawlError('secret=private-key stack trace'),
    'The crawl could not be completed. Review the page failure count or try again.');
});

test('ClientsRepository.createWithInitialRun translates Prisma P2002 to DuplicateClientError', async () => {
  const p2002Error = new Error('Unique constraint failed');
  p2002Error.code = 'P2002';
  const prisma = {
    $transaction: async () => {
      throw p2002Error;
    },
  };
  const repo = new ClientsRepository(prisma);
  await assert.rejects(
    repo.createWithInitialRun({
      userId: 'user-1',
      websiteUrl: 'https://example.com',
      normalizedDomain: 'example.com',
      name: 'Example',
    }),
    DuplicateClientError
  );
});

test('createClientSchema accepts valid client creation input with and without optional name', () => {
  const withoutName = createClientSchema.safeParse({ websiteUrl: 'https://example.com' });
  assert.equal(withoutName.success, true);
  assert.equal(withoutName.data.websiteUrl, 'https://example.com');
  assert.equal(withoutName.data.name, undefined);

  const withName = createClientSchema.safeParse({ websiteUrl: 'https://example.com/blog', name: 'My Website' });
  assert.equal(withName.success, true);
  assert.equal(withName.data.websiteUrl, 'https://example.com/blog');
  assert.equal(withName.data.name, 'My Website');
});

test('createClientSchema rejects missing required URL with structured validation error', () => {
  const result = createClientSchema.safeParse({ name: 'Website without URL' });
  assert.equal(result.success, false);
  const issue = result.error.issues.find((i) => i.path.includes('websiteUrl'));
  assert.ok(issue);
  assert.equal(issue.code, 'invalid_type');
});

test('createClientSchema rejects invalid URL format', () => {
  const result = createClientSchema.safeParse({ websiteUrl: 'not-a-valid-url' });
  assert.equal(result.success, false);
  const issue = result.error.issues.find((i) => i.path.includes('websiteUrl'));
  assert.ok(issue);
  assert.equal(issue.code, 'invalid_format');
});

test('createClientSchema accepts optional client name, empty string, and whitespace-only name', async () => {
  const emptyName = createClientSchema.safeParse({ websiteUrl: 'https://example.com', name: '' });
  assert.equal(emptyName.success, true);
  assert.equal(emptyName.data.name, '');

  const wsName = createClientSchema.safeParse({ websiteUrl: 'https://example.com', name: '   ' });
  assert.equal(wsName.success, true);
  assert.equal(wsName.data.name, '   ');

  // Verify that ClientsService trims and falls back to normalized domain
  let savedName = null;
  const repo = {
    createWithInitialRun: async (data) => {
      savedName = data.name;
      return { client: { id: 'c1', name: data.name }, crawlRun: { id: 'r1', status: 0 } };
    },
  };
  const worker = { schedule: () => {} };
  const http = { validateDestination: async (url) => url };
  const service = new ClientsService(repo, worker, http);

  await service.create('u1', emptyName.data);
  assert.equal(savedName, 'example.com');

  await service.create('u1', wsName.data);
  assert.equal(savedName, 'example.com');
});

test('createClientSchema rejects extra request properties in strict mode', () => {
  const result = createClientSchema.safeParse({
    websiteUrl: 'https://example.com',
    extraProp: 'not-allowed',
  });
  assert.equal(result.success, false);
  const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys');
  assert.ok(issue);
  assert.ok(issue.keys.includes('extraProp'));
});

test('ZodValidationPipe validates request data and throws BadRequestException with structured errors', async () => {
  const pipe = new ZodValidationPipe(createClientSchema);

  // Valid body passes
  const parsed = await pipe.transform({ websiteUrl: 'https://valid.example.com', name: 'Valid' });
  assert.deepEqual(parsed, { websiteUrl: 'https://valid.example.com', name: 'Valid' });

  // Invalid body throws BadRequestException with structured errors
  try {
    await pipe.transform({ websiteUrl: 'bad-url' });
    assert.fail('Expected pipe.transform to throw BadRequestException');
  } catch (err) {
    assert.equal(err.name, 'BadRequestException');
    const response = err.getResponse();
    assert.ok(Array.isArray(response.message));
    assert.ok(response.message.some((m) => m.includes('websiteUrl')));
    assert.ok(Array.isArray(response.errors));
    assert.equal(response.errors[0].field, 'websiteUrl');
    assert.equal(response.errors[0].code, 'invalid_format');
    // Ensure no stack traces or internal implementation details leaked
    assert.equal(response.stack, undefined);
    assert.equal(response.errors[0].stack, undefined);
  }

  // Extra properties throw BadRequestException with field error
  try {
    await pipe.transform({ websiteUrl: 'https://example.com', maliciousField: true });
    assert.fail('Expected pipe.transform to throw BadRequestException on extra properties');
  } catch (err) {
    assert.equal(err.name, 'BadRequestException');
    const response = err.getResponse();
    assert.ok(response.errors.some((e) => e.field === 'maliciousField' && e.code === 'unrecognized_keys'));
  }
});

test('Type inference and runtime schema compatibility from @serp/shared', () => {
  const rootImport = require('@serp/shared');
  const subpathImport = require('@serp/shared/schemas/client.schema');

  assert.equal(typeof rootImport.createClientSchema, 'object');
  assert.equal(typeof rootImport.createClientSchema.safeParse, 'function');
  assert.equal(typeof subpathImport.createClientSchema, 'object');
  assert.equal(rootImport.createClientSchema, subpathImport.createClientSchema);
});