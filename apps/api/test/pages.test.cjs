const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { PagesService, localDateBounds } = require('../dist/pages/pages.service.js');
const { PagesRepository } = require('../dist/pages/repositories/pages.repository.js');
const {
  mapPageRecordToResponse,
  mapRankSnapshotsToHistory,
  sortPageKeywords,
  selectPrimaryKeyword,
} = require('../dist/pages/mappers/page.mapper.js');
const {
  pageListQuerySchema,
  rankHistoryQuerySchema,
  calendarDateSchema,
} = require('@serp/shared');
const { ZodValidationPipe } = require('../dist/common/pipes/zod-validation.pipe.js');
const { PagesController } = require('../dist/pages/pages.controller.js');
const { ApiExceptionFilter } = require('../dist/api-exception.filter.js');
const { AuthGuard } = require('../dist/auth/guards/auth.guard.js');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');

test('page.mapper sorts keywords by relevance descending and phrase alphabetically', () => {
  const keywords = [
    { id: 'k1', pageKeywordId: 'pk1', phrase: 'zeta keyword', relevanceScore: 0.85, latestRank: null },
    { id: 'k2', pageKeywordId: 'pk2', phrase: 'alpha keyword', relevanceScore: 0.95, latestRank: null },
    { id: 'k3', pageKeywordId: 'pk3', phrase: 'beta keyword', relevanceScore: 0.85, latestRank: null },
  ];

  const sorted = sortPageKeywords(keywords);
  assert.equal(sorted[0].phrase, 'alpha keyword');
  assert.equal(sorted[1].phrase, 'beta keyword');
  assert.equal(sorted[2].phrase, 'zeta keyword');

  const primary = selectPrimaryKeyword(sorted);
  assert.equal(primary.phrase, 'alpha keyword');
});

test('page.mapper handles page without crawls', () => {
  const page = {
    id: 'page-1',
    clientId: 'client-1',
    url: 'https://example.com/empty',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    pageCrawls: [],
  };

  const mapped = mapPageRecordToResponse(page);
  assert.equal(mapped.id, 'page-1');
  assert.equal(mapped.current, null);
  assert.equal(mapped.issueCount, 0);
  assert.deepEqual(mapped.issues, []);
  assert.deepEqual(mapped.keywords, []);
  assert.equal(mapped.primaryKeyword, null);
  assert.equal(mapped.latestRank, null);
});

test('page.mapper correctly maps full crawl with SEO issues, Decimal scores, and latest ranks', () => {
  const page = {
    id: 'page-2',
    clientId: 'client-1',
    url: 'https://example.com/blog',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    pageCrawls: [
      {
        id: 'crawl-1',
        processedAt: new Date('2026-01-02T12:00:00Z'),
        httpStatusCode: 200,
        title: 'Blog Title',
        metaDescription: 'Description',
        h1: 'Header 1',
        wordCount: 1200,
        contentHash: 'hash-abc',
        seoIssues: [
          {
            id: 'issue-1',
            severity: 1,
            details: 'H1 is too short',
            issueType: { id: 10, code: 'H1_SHORT', name: 'H1 Too Short' },
          },
        ],
        pageCrawlKeywords: [
          {
            relevanceScore: { toNumber: () => 0.72 },
            keyword: { id: 'kw-2', phrase: 'keyword b' },
            pageKeyword: {
              id: 'pk-2',
              rankSnapshots: [
                {
                  position: 5,
                  snapshotDate: new Date('2026-01-02T00:00:00Z'),
                  snapshotAt: new Date('2026-01-02T06:00:00Z'),
                },
              ],
            },
          },
          {
            relevanceScore: { toNumber: () => 0.95 },
            keyword: { id: 'kw-1', phrase: 'keyword a' },
            pageKeyword: {
              id: 'pk-1',
              rankSnapshots: [
                {
                  position: 2,
                  snapshotDate: new Date('2026-01-02T00:00:00Z'),
                  snapshotAt: new Date('2026-01-02T06:00:00Z'),
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const mapped = mapPageRecordToResponse(page);
  assert.equal(mapped.id, 'page-2');
  assert.equal(mapped.current.title, 'Blog Title');
  assert.equal(mapped.issueCount, 1);
  assert.equal(mapped.issues[0].code, 'H1_SHORT');
  assert.equal(mapped.issues[0].name, 'H1 Too Short');
  assert.equal(mapped.issues[0].issueTypeId, 10);
  assert.equal(mapped.keywords.length, 2);
  assert.equal(mapped.primaryKeyword.phrase, 'keyword a');
  assert.equal(mapped.primaryKeyword.relevanceScore, 0.95);
  assert.equal(mapped.latestRank.position, 2);
  assert.equal(mapped.latestRank.snapshotDate, '2026-01-02');
});

test('mapRankSnapshotsToHistory converts UTC timestamps to user timezone', () => {
  const snapshots = [
    {
      position: 1,
      snapshotDate: new Date('2026-10-20T00:00:00Z'),
      snapshotAt: new Date('2026-10-20T20:00:00Z'),
    },
  ];

  const history = mapRankSnapshotsToHistory(snapshots, 'Pacific/Auckland');
  assert.equal(history.length, 1);
  assert.equal(history[0].snapshotDate, '2026-10-20');
  // UTC 20:00 on Oct 20 is Oct 21 in Auckland (UTC+13 during DST)
  assert.equal(history[0].date, '2026-10-21');
  assert.equal(history[0].position, 1);
});

test('PagesRepository.findPaginatedPages constructs tenant-scoped queries with search and filters', async () => {
  let capturedWhere;
  let capturedSkip;
  let capturedTake;
  const mockPrisma = {
    page: {
      count: async ({ where }) => {
        capturedWhere = where;
        return 42;
      },
      findMany: async ({ where, skip, take }) => {
        capturedWhere = where;
        capturedSkip = skip;
        capturedTake = take;
        return [];
      },
    },
  };

  const repo = new PagesRepository(mockPrisma);
  const result = await repo.findPaginatedPages('user-tenant-1', {
    clientId: 'client-1',
    url: 'test-path',
    keyword: 'serp',
    page: 2,
    pageSize: 10,
  });

  assert.equal(result.total, 42);
  assert.equal(capturedSkip, 10);
  assert.equal(capturedTake, 10);
  assert.equal(capturedWhere.client.userId, 'user-tenant-1');
  assert.equal(capturedWhere.clientId, 'client-1');
  assert.deepEqual(capturedWhere.url, { contains: 'test-path', mode: 'insensitive' });
  assert.deepEqual(capturedWhere.pageKeywords, {
    some: { keyword: { phrase: { contains: 'serp', mode: 'insensitive' } } },
  });
});

test('PagesRepository.findRankSnapshotsForTenant strictly enforces tenant isolation', async () => {
  let capturedWhere;
  const mockPrisma = {
    rankSnapshot: {
      findMany: async ({ where }) => {
        capturedWhere = where;
        return [];
      },
    },
  };

  const repo = new PagesRepository(mockPrisma);
  await repo.findRankSnapshotsForTenant(
    'user-tenant-1',
    'page-1',
    'pk-1',
    new Date('2026-01-01T00:00:00Z'),
    new Date('2026-01-02T00:00:00Z'),
  );

  assert.equal(capturedWhere.pageKeywordId, 'pk-1');
  assert.equal(capturedWhere.pageKeyword.id, 'pk-1');
  assert.equal(capturedWhere.pageKeyword.pageId, 'page-1');
  assert.equal(capturedWhere.pageKeyword.page.client.userId, 'user-tenant-1');
});

test('PagesService.rankHistory validates date constraints and throws BadRequestException', async () => {
  const repo = {
    pageExistsForTenant: async () => true,
    findPageById: async () => ({ id: 'p1', clientId: 'c1', url: 'https://ex.com', createdAt: new Date(), pageCrawls: [] }),
  };
  const service = new PagesService(repo);

  // Invalid date format/day (2026-02-30)
  await assert.rejects(
    service.rankHistory('u1', 'UTC', 'p1', { from: '2026-02-30' }),
    { name: 'BadRequestException', message: 'Date range must use valid YYYY-MM-DD dates spanning at most 366 days' },
  );

  // from > to
  await assert.rejects(
    service.rankHistory('u1', 'UTC', 'p1', { from: '2026-05-10', to: '2026-05-01' }),
    { name: 'BadRequestException', message: 'Date range must use valid YYYY-MM-DD dates spanning at most 366 days' },
  );

  // Span > 365 days
  await assert.rejects(
    service.rankHistory('u1', 'UTC', 'p1', { from: '2025-01-01', to: '2026-02-01' }),
    { name: 'BadRequestException', message: 'Date range must use valid YYYY-MM-DD dates spanning at most 366 days' },
  );
});

test('PagesService.rankHistory throws NotFoundException when page does not exist for tenant', async () => {
  const repo = {
    pageExistsForTenant: async () => false,
    findPageById: async () => null,
  };
  const service = new PagesService(repo);

  await assert.rejects(
    service.rankHistory('u1', 'UTC', 'foreign-page', { keywordId: 'k1' }),
    { name: 'NotFoundException', message: 'Page not found' },
  );

  await assert.rejects(
    service.rankHistory('u1', 'UTC', 'foreign-page', {}),
    { name: 'NotFoundException', message: 'Page not found' },
  );
});

test('PagesService.rankHistory throws NotFoundException when keyword does not belong to page/tenant', async () => {
  const repo = {
    pageExistsForTenant: async () => true,
    findPageKeywordForTenant: async () => null,
  };
  const service = new PagesService(repo);

  await assert.rejects(
    service.rankHistory('u1', 'UTC', 'p1', { keywordId: 'foreign-keyword' }),
    { name: 'NotFoundException', message: 'Keyword not found for this page' },
  );
});

test('PagesService.rankHistory returns empty history when page has no keywords and no keywordId provided', async () => {
  const repo = {
    findPageById: async () => ({
      id: 'p1',
      clientId: 'c1',
      url: 'https://ex.com',
      createdAt: new Date(),
      pageCrawls: [],
    }),
  };
  const service = new PagesService(repo);
  const result = await service.rankHistory('u1', 'UTC', 'p1', { from: '2026-01-01', to: '2026-01-05' });

  assert.equal(result.pageId, 'p1');
  assert.equal(result.pageKeywordId, null);
  assert.equal(result.keyword, null);
  assert.deepEqual(result.history, []);
  assert.equal(result.latestPosition, null);
});

test('pageListQuerySchema defaults pagination when page and pageSize are omitted', () => {
  const result = pageListQuerySchema.safeParse({});
  assert.equal(result.success, true);
  assert.equal(result.data.page, 1);
  assert.equal(result.data.pageSize, 20);
});

test('pageListQuerySchema accepts valid page and pageSize values (string and numeric)', () => {
  const stringQuery = pageListQuerySchema.safeParse({ page: '3', pageSize: '50' });
  assert.equal(stringQuery.success, true);
  assert.equal(stringQuery.data.page, 3);
  assert.equal(stringQuery.data.pageSize, 50);

  const numericQuery = pageListQuerySchema.safeParse({ page: 5, pageSize: 100 });
  assert.equal(numericQuery.success, true);
  assert.equal(numericQuery.data.page, 5);
  assert.equal(numericQuery.data.pageSize, 100);
});

test('pageListQuerySchema rejects invalid, negative, fractional, and zero numbers', () => {
  assert.equal(pageListQuerySchema.safeParse({ page: 0 }).success, false);
  assert.equal(pageListQuerySchema.safeParse({ page: '0' }).success, false);
  assert.equal(pageListQuerySchema.safeParse({ page: '-1' }).success, false);
  assert.equal(pageListQuerySchema.safeParse({ page: '1.5' }).success, false);
  assert.equal(pageListQuerySchema.safeParse({ page: 'abc' }).success, false);
  assert.equal(pageListQuerySchema.safeParse({ pageSize: 0 }).success, false);
  assert.equal(pageListQuerySchema.safeParse({ pageSize: '101' }).success, false);
  assert.equal(pageListQuerySchema.safeParse({ pageSize: '-5' }).success, false);
  assert.equal(pageListQuerySchema.safeParse({ pageSize: '20.5' }).success, false);
});

test('pageListQuerySchema rejects empty query parameters and malformed UUIDs without permissive coercion', () => {
  assert.equal(pageListQuerySchema.safeParse({ page: '' }).success, false);
  assert.equal(pageListQuerySchema.safeParse({ pageSize: '' }).success, false);
  assert.equal(pageListQuerySchema.safeParse({ clientId: '' }).success, false);
  assert.equal(pageListQuerySchema.safeParse({ clientId: 'not-a-valid-uuid' }).success, false);
});

test('pageListQuerySchema accepts search and filter parameters within limits', () => {
  const result = pageListQuerySchema.safeParse({
    clientId: '123e4567-e89b-12d3-a456-426614174000',
    url: '/products/widget',
    keyword: 'best widget',
    search: 'widget',
  });
  assert.equal(result.success, true);
  assert.equal(result.data.clientId, '123e4567-e89b-12d3-a456-426614174000');
  assert.equal(result.data.url, '/products/widget');
  assert.equal(result.data.keyword, 'best widget');
  assert.equal(result.data.search, 'widget');

  // Exceeding 200 characters fails
  assert.equal(pageListQuerySchema.safeParse({ url: 'a'.repeat(201) }).success, false);
  assert.equal(pageListQuerySchema.safeParse({ keyword: 'a'.repeat(201) }).success, false);
  assert.equal(pageListQuerySchema.safeParse({ search: 'a'.repeat(201) }).success, false);
});

test('pageListQuerySchema rejects unknown query properties in strict mode', () => {
  const result = pageListQuerySchema.safeParse({ page: 1, extraParam: 'forbidden' });
  assert.equal(result.success, false);
  const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys');
  assert.ok(issue);
  assert.ok(issue.keys.includes('extraParam'));
});

test('rankHistoryQuerySchema validates ISO calendar dates and rejects impossible dates (e.g. 2026-02-30)', () => {
  assert.equal(rankHistoryQuerySchema.safeParse({ from: '2026-02-28', to: '2026-03-01' }).success, true);
  assert.equal(rankHistoryQuerySchema.safeParse({ from: '2026-10-21' }).success, true);

  // Impossible calendar dates
  assert.equal(rankHistoryQuerySchema.safeParse({ from: '2026-02-30' }).success, false);
  assert.equal(rankHistoryQuerySchema.safeParse({ to: '2026-04-31' }).success, false);
  assert.equal(rankHistoryQuerySchema.safeParse({ from: '2026-02-29' }).success, false); // 2026 is not leap year
  assert.equal(rankHistoryQuerySchema.safeParse({ from: 'invalid-date' }).success, false);
  assert.equal(rankHistoryQuerySchema.safeParse({ from: '2026-1-1' }).success, false);
});

test('rankHistoryQuerySchema accepts valid optional keyword UUID and rejects unknown properties', () => {
  assert.equal(rankHistoryQuerySchema.safeParse({}).success, true);
  assert.equal(
    rankHistoryQuerySchema.safeParse({ keywordId: '123e4567-e89b-12d3-a456-426614174000' }).success,
    true,
  );
  assert.equal(rankHistoryQuerySchema.safeParse({ keywordId: 'not-a-uuid' }).success, false);
  assert.equal(rankHistoryQuerySchema.safeParse({ keywordId: '' }).success, false);
  assert.equal(rankHistoryQuerySchema.safeParse({ unknownQuery: 'bad' }).success, false);
});

test('ZodValidationPipe validates page query parameters and returns structured errors on failure', async () => {
  const pipe = new ZodValidationPipe(pageListQuerySchema);

  // Valid query transforms strings to numbers
  const transformed = await pipe.transform({ page: '2', pageSize: '15' });
  assert.deepEqual(transformed, { page: 2, pageSize: 15 });

  // Invalid query throws BadRequestException with structured error payload
  try {
    await pipe.transform({ page: '-1', pageSize: '101' });
    assert.fail('Expected pipe.transform to throw BadRequestException');
  } catch (err) {
    assert.equal(err.name, 'BadRequestException');
    const response = err.getResponse();
    assert.ok(Array.isArray(response.message));
    assert.ok(Array.isArray(response.errors));
    assert.ok(response.errors.some((e) => e.field === 'page'));
    assert.ok(response.errors.some((e) => e.field === 'pageSize'));
    assert.equal(response.stack, undefined);
  }
});

test('PagesController HTTP request pipeline integration with global ValidationPipe and ApiExceptionFilter', async () => {
  class TestModule { }
  Module({
    controllers: [PagesController],
    providers: [
      {
        provide: PagesService,
        useValue: {
          list: async (userId, query) => ({
            items: [],
            pagination: { page: query.page, pageSize: query.pageSize, total: 0, totalPages: 0 },
          }),
          rankHistory: async (userId, tz, id, query) => ({
            pageId: id,
            from: query.from ?? null,
            to: query.to ?? null,
            history: [],
          }),
          detail: async (userId, id) => ({ id }),
        },
      },
      AuthGuard,
    ],
  })(TestModule);

  const app = await NestFactory.create(TestModule, { logger: false });
  app.use((req, res, next) => {
    req.user = { id: 'u1', email: 'test@example.com', timezone: 'UTC' };
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0);
  const port = app.getHttpServer().address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Valid pagination query with string parameters
    const validRes = await fetch(`${baseUrl}/pages?page=2&pageSize=10`);
    assert.equal(validRes.status, 200);
    const validData = await validRes.json();
    assert.equal(validData.pagination.page, 2);
    assert.equal(validData.pagination.pageSize, 10);

    // 2. Default pagination when query is omitted
    const defaultRes = await fetch(`${baseUrl}/pages`);
    assert.equal(defaultRes.status, 200);
    const defaultData = await defaultRes.json();
    assert.equal(defaultData.pagination.page, 1);
    assert.equal(defaultData.pagination.pageSize, 20);

    // 3. Invalid pagination values return 400 with structured validation messages
    const invalidRes = await fetch(`${baseUrl}/pages?page=0&pageSize=101`);
    assert.equal(invalidRes.status, 400);
    const invalidData = await invalidRes.json();
    assert.equal(invalidData.error, 'Bad Request');
    assert.ok(Array.isArray(invalidData.message));
    assert.ok(invalidData.message.some((m) => m.includes('page')));

    // 4. Unknown query properties return 400
    const unknownRes = await fetch(`${baseUrl}/pages?unknownParam=value`);
    assert.equal(unknownRes.status, 400);

    // 5. Impossible calendar date 2026-02-30 returns 400
    const badDateRes = await fetch(
      `${baseUrl}/pages/123e4567-e89b-12d3-a456-426614174000/rank-history?from=2026-02-30`,
    );
    assert.equal(badDateRes.status, 400);
    const badDateData = await badDateRes.json();
    assert.equal(badDateData.error, 'Bad Request');

    // 6. Valid date range returns 200
    const goodDateRes = await fetch(
      `${baseUrl}/pages/123e4567-e89b-12d3-a456-426614174000/rank-history?from=2026-01-01&to=2026-01-10`,
    );
    assert.equal(goodDateRes.status, 200);
  } finally {
    await app.close();
  }
});