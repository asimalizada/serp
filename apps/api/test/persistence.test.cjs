const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaCrawlStore } = require('../dist/crawler/persistence/prisma-crawl.store.js');
const { extractPageContent } = require('../dist/crawler/analysis/content.js');

test('persists new page-crawl snapshots while reusing page and keyword identities with batched queries', async () => {
  const pages = new Map();
  const keywords = new Map();
  const pageKeywords = new Map();
  const pageCrawls = [];
  const relevance = [];
  const issues = [];
  const events = [];
  const rankSnapshots = [{ id: 1, position: 5 }];

  const tx = {
    page: {
      upsert: async ({ where }) => {
        const key = `${where.clientId_url.clientId}|${where.clientId_url.url}`;
        if (!pages.has(key)) pages.set(key, { id: `page-${pages.size + 1}` });
        return pages.get(key);
      },
    },
    pageCrawl: {
      create: async ({ data }) => {
        const record = { ...data, id: `crawl-${pageCrawls.length + 1}` };
        pageCrawls.push(record);
        events.push('create-crawl');
        return record;
      },
      update: async ({ where, data }) => {
        const record = pageCrawls.find((item) => item.id === where.id);
        Object.assign(record, data);
        events.push('finish-crawl');
        return record;
      },
    },
    keyword: {
      createMany: async ({ data }) => {
        for (const { phrase } of data) {
          if (!keywords.has(phrase)) keywords.set(phrase, { id: `keyword-${keywords.size + 1}`, phrase });
        }
      },
      findMany: async ({ where }) => {
        const phrases = where.phrase.in;
        return phrases.map((phrase) => keywords.get(phrase)).filter(Boolean);
      },
      findUniqueOrThrow: async ({ where }) => keywords.get(where.phrase),
    },
    pageKeyword: {
      createMany: async ({ data }) => {
        for (const { pageId, keywordId } of data) {
          const key = `${pageId}|${keywordId}`;
          if (!pageKeywords.has(key)) pageKeywords.set(key, { id: `identity-${pageKeywords.size + 1}` });
        }
      },
      upsert: async ({ where }) => {
        const key = `${where.pageId_keywordId.pageId}|${where.pageId_keywordId.keywordId}`;
        if (!pageKeywords.has(key)) pageKeywords.set(key, { id: `identity-${pageKeywords.size + 1}` });
        return pageKeywords.get(key);
      },
    },
    pageCrawlKeyword: {
      createMany: async ({ data }) => {
        relevance.push(...data);
        events.push('save-relevance');
      },
      create: async ({ data }) => {
        relevance.push(data);
        events.push('save-relevance');
      },
    },
    seoIssue: {
      createMany: async ({ data }) => {
        issues.push(...data);
        events.push('save-issue');
      },
      create: async ({ data }) => {
        issues.push(data);
        events.push('save-issue');
      },
    },
  };

  const store = new PrismaCrawlStore({ $transaction: async (callback) => callback(tx) });
  const content = extractPageContent(
    '<title>Keyword Guide</title><article><h1>Keyword Guide</h1><p>Keyword research guide.</p></article>',
  );
  const analysis = {
    content,
    httpStatusCode: 200,
    keywords: [
      { phrase: 'keyword research', relevanceScore: 0.8123 },
      // Duplicate keyword should be deduplicated in-memory
      { phrase: 'keyword research', relevanceScore: 0.8123 },
    ],
    issues: [{ issueTypeId: 6, code: 'THIN_CONTENT', severity: 1, details: 'Thin article.' }],
  };

  await store.savePage('client-1', 'run-1', 'https://example.com/blog/guide', 1, analysis);
  await store.savePage('client-1', 'run-2', 'https://example.com/blog/guide', 1, analysis);

  assert.equal(pages.size, 1);
  assert.equal(keywords.size, 1);
  assert.equal(pageKeywords.size, 1);
  assert.equal(pageCrawls.length, 2);
  assert.deepEqual(pageCrawls.map((item) => item.status), [2, 2]);
  assert.deepEqual(relevance.map((item) => item.pageCrawlId), ['crawl-1', 'crawl-2']);
  assert.deepEqual(issues.map((item) => item.pageCrawlId), ['crawl-1', 'crawl-2']);
  assert.deepEqual(rankSnapshots, [{ id: 1, position: 5 }]);
  assert.deepEqual(events.slice(0, 4), ['create-crawl', 'save-relevance', 'save-issue', 'finish-crawl']);
});

test('retries a rolled-back page transaction after a write conflict (P2034)', async () => {
  let attempts = 0;
  let saved = 0;
  const tx = {
    page: { upsert: async () => ({ id: 'page' }) },
    pageCrawl: {
      create: async () => ({ id: 'crawl' }),
      update: async () => { saved++; },
    },
    keyword: {
      createMany: async () => {},
      findMany: async () => [],
    },
    pageKeyword: { createMany: async () => {} },
    pageCrawlKeyword: { createMany: async () => {} },
    seoIssue: { createMany: async () => {} },
  };

  const store = new PrismaCrawlStore({
    $transaction: async (callback) => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error('write conflict'), { code: 'P2034' });
      return callback(tx);
    },
  });

  const content = extractPageContent('<title>Article</title><article><h1>Article</h1><p>Example text.</p></article>');
  await store.savePage('client', 'run', 'https://example.com/blog/article', 1, {
    content,
    keywords: [],
    issues: [],
    httpStatusCode: 200,
  });

  assert.equal(attempts, 2);
  assert.equal(saved, 1);
});

test('saveFailedPage retries one P2034 and creates one failed crawl', async () => {
  let attempts = 0;
  const saved = [];
  const tx = {
    page: { upsert: async () => ({ id: 'page-1' }) },
    pageCrawl: { create: async ({ data }) => { saved.push(data); } },
  };
  const store = new PrismaCrawlStore({
    $transaction: async (callback) => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error('write conflict'), { code: 'P2034' });
      return callback(tx);
    },
  });

  await store.saveFailedPage('client-1', 'run-1', 'https://example.com/blog/article', 1, 'HTTP 503', 503);

  assert.equal(attempts, 2);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, 3);
  assert.equal(saved[0].pageId, 'page-1');
  assert.equal(saved[0].httpStatusCode, 503);
  assert.equal(saved[0].error, 'HTTP 503');
});

test('saveFailedPage stops after three P2034 attempts', async () => {
  let attempts = 0;
  const conflict = Object.assign(new Error('write conflict'), { code: 'P2034' });
  const store = new PrismaCrawlStore({
    $transaction: async () => {
      attempts++;
      throw conflict;
    },
  });

  await assert.rejects(
    store.saveFailedPage('client-1', 'run-1', 'https://example.com/blog/article', 1, 'HTTP 503'),
    (error) => error === conflict,
  );
  assert.equal(attempts, 3);
});

test('saveFailedPage does not retry non-P2034 transaction errors', async () => {
  let attempts = 0;
  const failure = Object.assign(new Error('unique constraint'), { code: 'P2002' });
  const store = new PrismaCrawlStore({
    $transaction: async () => {
      attempts++;
      throw failure;
    },
  });

  await assert.rejects(
    store.saveFailedPage('client-1', 'run-1', 'https://example.com/blog/article', 1, 'HTTP 503'),
    (error) => error === failure,
  );
  assert.equal(attempts, 1);
});

test('a pending crawl run is claimed exactly once', async () => {
  let status = 0;
  const store = new PrismaCrawlStore({
    crawlRun: {
      updateMany: async ({ where, data }) => {
        if (where.status !== status) return { count: 0 };
        status = data.status;
        return { count: 1 };
      },
    },
  });

  await store.startRun('run');
  assert.equal(status, 1);
  await assert.rejects(store.startRun('run'), /no longer pending/);
});

test('ensureIssueTypes is idempotent and avoids redundant database queries on repeated calls', async () => {
  let queryCount = 0;
  const mockPrisma = {
    seoIssueType: {
      count: async () => {
        queryCount++;
        return 6;
      },
      upsert: async () => {
        queryCount++;
        return { id: 1, code: 'MISSING_TITLE' };
      },
    },
  };

  const store = new PrismaCrawlStore(mockPrisma);
  await store.ensureIssueTypes();
  assert.equal(queryCount, 1);

  // Second invocation within same process should make 0 additional queries
  await store.ensureIssueTypes();
  assert.equal(queryCount, 1);
});

test('finishRun only finalizes running crawls (status = 1)', async () => {
  let updatedWhere;
  let updatedData;
  const mockPrisma = {
    crawlRun: {
      updateMany: async ({ where, data }) => {
        updatedWhere = where;
        updatedData = data;
        return { count: 1 };
      },
    },
  };

  const store = new PrismaCrawlStore(mockPrisma);
  await store.finishRun('run-1', 2, 'https://example.com/sitemap.xml', null);

  assert.equal(updatedWhere.id, 'run-1');
  assert.equal(updatedWhere.status, 1);
  assert.equal(updatedData.status, 2);
  assert.equal(updatedData.sitemapUrl, 'https://example.com/sitemap.xml');
});

test('transaction rolls back and does not retry on non-retryable transaction errors', async () => {
  let attempts = 0;
  const store = new PrismaCrawlStore({
    $transaction: async () => {
      attempts++;
      throw new Error('Fatal database constraint violation');
    },
  });

  const content = extractPageContent('<title>Article</title><article><h1>Article</h1><p>Example text.</p></article>');
  await assert.rejects(
    store.savePage('client', 'run', 'https://example.com/blog/article', 1, {
      content,
      keywords: [],
      issues: [],
      httpStatusCode: 200,
    }),
    /Fatal database constraint violation/
  );

  assert.equal(attempts, 1, 'Non-conflict errors must not trigger retries');
});

test('savePage deduplicates keyword phrases and sorts them alphabetically to prevent deadlocks', async () => {
  let createdKeywords;
  let batchKeywords;
  const tx = {
    page: { upsert: async () => ({ id: 'page-1' }) },
    pageCrawl: {
      create: async () => ({ id: 'crawl-1' }),
      update: async () => {},
    },
    keyword: {
      createMany: async ({ data }) => {
        createdKeywords = data;
      },
      findMany: async ({ where }) => {
        batchKeywords = where.phrase.in;
        return where.phrase.in.map((phrase, i) => ({ id: `kw-${i}`, phrase }));
      },
    },
    pageKeyword: { createMany: async () => {} },
    pageCrawlKeyword: { createMany: async () => {} },
    seoIssue: { createMany: async () => {} },
  };

  const store = new PrismaCrawlStore({
    $transaction: async (cb) => cb(tx),
  });

  const content = extractPageContent('<title>Article</title><article><h1>Article</h1><p>Example text.</p></article>');
  await store.savePage('client-1', 'run-1', 'https://example.com/blog/article', 1, {
    content,
    keywords: [
      { phrase: 'zebra striping', relevanceScore: 0.9 },
      { phrase: 'apple pie', relevanceScore: 0.8 },
      { phrase: 'zebra striping', relevanceScore: 0.95 }, // Duplicate!
      { phrase: 'banana split', relevanceScore: 0.7 },
      { phrase: 'apple pie', relevanceScore: 0.85 }, // Duplicate!
    ],
    issues: [],
    httpStatusCode: 200,
  });

  // Verify deduplication
  assert.equal(createdKeywords.length, 3);
  assert.deepEqual(
    createdKeywords.map((k) => k.phrase),
    ['apple pie', 'banana split', 'zebra striping']
  );
  assert.deepEqual(batchKeywords, ['apple pie', 'banana split', 'zebra striping']);
});