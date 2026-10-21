const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gzipSync } = require('node:zlib');
const { SitemapService } = require('../dist/crawler/sitemaps/sitemap.service.js');
const { selectBlogUrls } = require('../dist/crawler/blog-url.js');
const { extractPageContent } = require('../dist/crawler/analysis/content.js');
const { extractKeywords } = require('../dist/crawler/analysis/keywords.js');
const { detectSeoIssues } = require('../dist/crawler/analysis/seo-issues.js');
const { SafeHttpClient } = require('../dist/crawler/http/safe-http.client.js');
const { CrawlService } = require('../dist/crawler/crawl-service.js');

const fixture = (name) => readFileSync(join(__dirname, 'fixtures', name));
const result = (url, body, status = 200) => ({ url, body: Buffer.isBuffer(body) ? body : Buffer.from(body), status, contentType: 'text/xml' });

test('discovers nested and gzip sitemaps in listed order, deduplicating URLs', async () => {
  const responses = new Map([
    ['https://example.com/robots.txt', result('https://example.com/robots.txt', 'Sitemap: https://example.com/index.xml')],
    ['https://example.com/index.xml', result('https://example.com/index.xml', fixture('sitemap-index.xml'))],
    ['https://example.com/sitemap-a.xml', result('https://example.com/sitemap-a.xml', fixture('sitemap-a.xml'))],
    ['https://example.com/sitemap-b.xml.gz', result('https://example.com/sitemap-b.xml.gz', gzipSync(fixture('sitemap-b.xml')))],
  ]);
  const service = new SitemapService({ get: async (url) => responses.get(url) ?? result(url, '', 404) });
  const discovery = await service.discover('https://example.com');
  assert.deepEqual(discovery.urls, [
    'https://example.com/blog/first-article',
    'https://example.com/category/news',
    'https://example.com/blog/second-article',
  ]);
  assert.equal(discovery.sitemapUrl, 'https://example.com/index.xml');
  assert.deepEqual(selectBlogUrls(discovery.urls, 'https://example.com'), [
    'https://example.com/blog/first-article', 'https://example.com/blog/second-article',
  ]);
  assert.deepEqual(selectBlogUrls(['https://example.com/company/stories/case-study',
    'https://example.com/blog/first-article'], 'https://example.com'), ['https://example.com/blog/first-article']);
});

test('skips malformed sitemaps and selects only the first 15 article URLs', async () => {
  const urls = Array.from({ length: 20 }, (_, index) => `https://example.com/blog/article-${index + 1}`);
  assert.equal(selectBlogUrls(urls, 'https://example.com').length, 15);
  assert.equal(selectBlogUrls(urls, 'https://example.com')[14], urls[14]);
  const service = new SitemapService({ get: async (url) => url.endsWith('robots.txt')
    ? result(url, 'Sitemap: https://example.com/bad.xml')
    : result(url, '<urlset><url><loc>broken') });
  const discovery = await service.discover('https://example.com');
  assert.deepEqual(discovery.urls, []);
  assert.ok(discovery.errors.length);
});

test('extracts article content, stable hash, keywords, and initial SEO issues', () => {
  const html = fixture('article.html').toString('utf8');
  const content = extractPageContent(html);
  assert.equal(content.title, 'Search Engine Optimization Guide');
  assert.equal(content.h1, 'Search Engine Optimization Guide');
  assert.equal(content.missingImageAltCount, 1);
  assert.ok(!content.text.includes('Navigation text'));
  assert.ok(!content.text.includes('Related links'));
  assert.equal(content.contentHash, extractPageContent(html.replace(/\s+/g, ' ')).contentHash);
  const keywords = extractKeywords(content);
  assert.ok(keywords.some((item) => item.phrase === 'search engine optimization'));
  assert.ok(keywords.every((item) => item.relevanceScore > 0 && item.relevanceScore <= 1));
  assert.ok(keywords.every((item) => !item.phrase.includes(' the ')));
  const issues = detectSeoIssues(content);
  assert.deepEqual(issues.map((item) => item.code).sort(), ['MISSING_IMAGE_ALT', 'THIN_CONTENT']);
  assert.equal(issues.find((item) => item.code === 'THIN_CONTENT').severity, 1);
});

test('detects missing title, meta, H1, and multiple H1 correctly', () => {
  const empty = extractPageContent('<html><body><article><p>Hello world.</p></article></body></html>');
  assert.deepEqual(detectSeoIssues(empty).map((item) => item.code), [
    'MISSING_TITLE', 'MISSING_META_DESCRIPTION', 'MISSING_H1', 'THIN_CONTENT',
  ]);
  const multiple = extractPageContent('<title>Good</title><meta name="description" content="Good"><article><h1>One</h1><h1>Two</h1></article>');
  assert.ok(detectSeoIssues(multiple).some((item) => item.code === 'MULTIPLE_H1'));
});

test('blocks private destinations, mixed DNS answers, and unsafe redirects', async () => {
  let requests = 0;
  const transport = async (url) => {
    requests++;
    return { status: 302, contentType: 'text/plain', body: Buffer.alloc(0), location: 'http://127.0.0.1/admin' };
  };
  const resolver = async (host) => [{ address: host === '127.0.0.1' ? host : '93.184.215.14', family: 4 }];
  const client = new SafeHttpClient(resolver, transport);
  await assert.rejects(client.get('http://127.0.0.1/', 100), /Unsafe destination/);
  assert.equal(requests, 0);
  await assert.rejects(client.get('https://example.com/', 100), /HTTPS downgrade/);
  assert.equal(requests, 1);
  await assert.rejects(client.get('http://example.com/', 100), /Unsafe destination/);
  assert.equal(requests, 2);
  const mixed = new SafeHttpClient(async () => [
    { address: '93.184.215.14', family: 4 }, { address: '10.0.0.1', family: 4 },
  ], transport);
  await assert.rejects(mixed.get('http://example.com/', 100), /Unsafe destination/);
  assert.equal(requests, 2);
});

test('records page failures and appends new crawl history on repeated runs', async () => {
  const history = [];
  const runs = [];
  const store = {
    getClient: async () => ({ id: 'client', websiteUrl: 'https://example.com' }),
    createRun: async () => { const id = `run-${runs.length + 1}`; runs.push({ id, status: 0 }); return id; },
    startRun: async (id) => { runs.find((run) => run.id === id).status = 1; },
    finishRun: async (id, status) => { runs.find((run) => run.id === id).status = status; },
    ensureIssueTypes: async () => {},
    savePage: async (_client, runId, url, order, analysis) => history.push({ runId, url, order, status: 2, hash: analysis.content.contentHash }),
    saveFailedPage: async (_client, runId, url, order) => history.push({ runId, url, order, status: 3 }),
  };
  const urls = ['https://example.com/blog/first', 'https://example.com/blog/second'];
  const sitemaps = { discover: async () => ({ urls, sitemapUrl: 'https://example.com/sitemap.xml', errors: [] }) };
  const http = { get: async (url) => url.endsWith('/second')
    ? result(url, '', 503)
    : { ...result(url, fixture('article.html')), contentType: 'text/html' } };
  const crawler = new CrawlService(store, http, sitemaps);
  const first = await crawler.crawlClient('client');
  const second = await crawler.crawlClient('client');
  assert.equal(first.processed, 1);
  assert.equal(first.failed, 1);
  assert.equal(second.processed, 1);
  assert.equal(history.length, 4);
  assert.deepEqual(history.map((item) => item.runId), ['run-1', 'run-1', 'run-2', 'run-2']);
  assert.deepEqual(runs.map((run) => run.status), [2, 2]);
  assert.equal(history[0].hash, history[2].hash);
});

test('recovery skips successful URLs and retains original sitemap order', async () => {
  const saved = [];
  const store = {
    getClient: async () => ({ id: 'client', websiteUrl: 'https://example.com' }),
    createRun: async () => 'recovery-run',
    startRun: async () => {}, finishRun: async () => {}, ensureIssueTypes: async () => {},
    savePage: async (_client, _run, url, order) => saved.push({ url, order }),
    saveFailedPage: async () => assert.fail('unexpected failure'),
  };
  const urls = ['https://example.com/blog/first', 'https://example.com/blog/second'];
  const crawler = new CrawlService(store, {
    get: async (url) => ({ ...result(url, fixture('article.html')), contentType: 'text/html' }),
  }, { discover: async () => ({ urls, sitemapUrl: null, errors: [] }) });
  const summary = await crawler.crawlClient('client', new Set([urls[0]]));
  assert.equal(summary.selected, 1);
  assert.deepEqual(saved, [{ url: urls[1], order: 2 }]);
});

test('a page whose failure cannot be persisted does not complete the crawl run', async () => {
  let finalStatus;
  const store = {
    getClient: async () => ({ id: 'client', websiteUrl: 'https://example.com' }),
    createRun: async () => 'run', startRun: async () => {},
    finishRun: async (_id, status) => { finalStatus = status; },
    ensureIssueTypes: async () => {},
    savePage: async (_client, _run, url) => {
      if (url.endsWith('second')) throw new Error('database write failed');
    },
    saveFailedPage: async () => { throw new Error('failure write failed'); },
  };
  const urls = ['https://example.com/blog/first', 'https://example.com/blog/second'];
  const crawler = new CrawlService(store, { get: async (url) => ({ ...result(url, fixture('article.html')),
    contentType: 'text/html' }) }, { discover: async () => ({ urls, sitemapUrl: null, errors: [] }) });
  const summary = await crawler.crawlClient('client');
  assert.equal(summary.processed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(finalStatus, 3);
  assert.ok(summary.errors.some((error) => error.includes('failure write failed')));
});

test('aborted crawl run via AbortSignal stops execution and finalizes run with failure status 3', async () => {
  let finalStatus;
  let finishedError;
  const store = {
    getClient: async () => ({ id: 'client', websiteUrl: 'https://example.com' }),
    createRun: async () => 'run-aborted',
    startRun: async () => {},
    finishRun: async (_id, status, _sitemap, error) => {
      finalStatus = status;
      finishedError = error;
    },
    ensureIssueTypes: async () => {},
    savePage: async () => {},
    saveFailedPage: async () => {},
  };
  const urls = ['https://example.com/blog/first', 'https://example.com/blog/second'];
  const sitemaps = {
    discover: async (url, signal) => {
      if (signal?.aborted) throw new Error('Crawl aborted: application is shutting down');
      return { urls, sitemapUrl: 'https://example.com/sitemap.xml', errors: [] };
    },
  };
  const http = {
    get: async () => {
      throw new Error('should not be called when aborted');
    },
  };
  const crawler = new CrawlService(store, http, sitemaps);
  const ac = new AbortController();
  ac.abort();

  const summary = await crawler.crawlClient('client', new Set(), 'run-aborted', ac.signal);
  assert.equal(finalStatus, 3);
  assert.match(finishedError, /Crawl aborted: application is shutting down/);
  assert.equal(summary.processed, 0);
});