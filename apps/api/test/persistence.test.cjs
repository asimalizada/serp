const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaCrawlStore } = require('../dist/crawler/persistence.js');
const { extractPageContent } = require('../dist/crawler/content.js');

test('persists new page-crawl snapshots while reusing page and keyword identities', async () => {
  const pages = new Map();
  const keywords = new Map();
  const pageKeywords = new Map();
  const pageCrawls = [];
  const relevance = [];
  const issues = [];
  const events = [];
  const rankSnapshots = [{ id: 1, position: 5 }];
  const tx = {
    page: { upsert: async ({ where }) => {
      const key = `${where.clientId_url.clientId}|${where.clientId_url.url}`;
      if (!pages.has(key)) pages.set(key, { id: `page-${pages.size + 1}` });
      return pages.get(key);
    } },
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
    keyword: { upsert: async ({ where }) => {
      if (!keywords.has(where.phrase)) keywords.set(where.phrase, { id: `keyword-${keywords.size + 1}` });
      return keywords.get(where.phrase);
    } },
    pageKeyword: { upsert: async ({ where }) => {
      const key = `${where.pageId_keywordId.pageId}|${where.pageId_keywordId.keywordId}`;
      if (!pageKeywords.has(key)) pageKeywords.set(key, { id: `identity-${pageKeywords.size + 1}` });
      return pageKeywords.get(key);
    } },
    pageCrawlKeyword: { create: async ({ data }) => { relevance.push(data); events.push('save-relevance'); } },
    seoIssue: { create: async ({ data }) => { issues.push(data); events.push('save-issue'); } },
  };
  const store = new PrismaCrawlStore({ $transaction: async (callback) => callback(tx) });
  const content = extractPageContent('<title>Keyword Guide</title><article><h1>Keyword Guide</h1><p>Keyword research guide.</p></article>');
  const analysis = { content, httpStatusCode: 200,
    keywords: [{ phrase: 'keyword research', relevanceScore: 0.8123 }],
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