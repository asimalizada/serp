const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const { SitemapService } = require('../dist/crawler/sitemaps/sitemap.service.js');
const {
  decompressGzipBounded,
} = require('../dist/crawler/sitemaps/sitemap.parser.js');

const result = (url, body, status = 200, contentType = 'text/xml') => ({
  url,
  status,
  contentType,
  body: Buffer.isBuffer(body) ? body : Buffer.from(body),
});

const makeArticles = (count, prefix = 'post') =>
  Array.from(
    { length: count },
    (_, i) => `<url><loc>https://example.com/blog/${prefix}-${i + 1}</loc></url>`,
  ).join('\n');

test('robots.txt discovery extracts sitemaps in order and stops when 15 articles found', async () => {
  const articlesXml = makeArticles(15, 'custom');
  const responses = new Map([
    [
      'https://example.com/robots.txt',
      result(
        'https://example.com/robots.txt',
        'User-agent: *\nSitemap: https://example.com/custom-sitemap.xml\n',
      ),
    ],
    [
      'https://example.com/custom-sitemap.xml',
      result(
        'https://example.com/custom-sitemap.xml',
        `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          ${articlesXml}
        </urlset>`,
      ),
    ],
  ]);

  const service = new SitemapService({
    get: async (url) => responses.get(url) ?? result(url, '', 404),
  });

  const discovery = await service.discover('https://example.com');
  assert.equal(discovery.urls.length, 15);
  assert.equal(discovery.urls[0], 'https://example.com/blog/custom-1');
  assert.equal(discovery.urls[14], 'https://example.com/blog/custom-15');
  assert.equal(discovery.sitemapUrl, 'https://example.com/custom-sitemap.xml');
  assert.equal(discovery.errors.length, 0);
});

test('standard sitemap fallback succeeds when robots.txt is missing (404)', async () => {
  const articlesXml = makeArticles(15, 'standard');
  const responses = new Map([
    [
      'https://example.com/sitemap.xml',
      result(
        'https://example.com/sitemap.xml',
        `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          ${articlesXml}
        </urlset>`,
      ),
    ],
  ]);

  const service = new SitemapService({
    get: async (url) => {
      if (url.endsWith('/robots.txt')) {
        throw new Error('HTTP 404 Not Found');
      }
      return responses.get(url) ?? result(url, '', 404);
    },
  });

  const discovery = await service.discover('https://example.com');
  assert.equal(discovery.urls.length, 15);
  assert.equal(discovery.sitemapUrl, 'https://example.com/sitemap.xml');
  assert.equal(discovery.errors.length, 1);
  assert.ok(discovery.errors[0].includes('robots.txt'));
});

test('nested sitemap traversal visits child sitemaps in order', async () => {
  const child1Articles = makeArticles(8, 'child1');
  const child2Articles = makeArticles(7, 'child2');

  const responses = new Map([
    [
      'https://example.com/sitemap.xml',
      result(
        'https://example.com/sitemap.xml',
        `<?xml version="1.0" encoding="UTF-8"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://example.com/child-1.xml</loc></sitemap>
          <sitemap><loc>https://example.com/child-2.xml</loc></sitemap>
        </sitemapindex>`,
      ),
    ],
    [
      'https://example.com/child-1.xml',
      result(
        'https://example.com/child-1.xml',
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          ${child1Articles}
        </urlset>`,
      ),
    ],
    [
      'https://example.com/child-2.xml',
      result(
        'https://example.com/child-2.xml',
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          ${child2Articles}
        </urlset>`,
      ),
    ],
  ]);

  const service = new SitemapService({
    get: async (url) => responses.get(url) ?? result(url, '', 404),
  });

  const discovery = await service.discover('https://example.com');
  assert.equal(discovery.urls.length, 15);
  assert.equal(discovery.urls[0], 'https://example.com/blog/child1-1');
  assert.equal(discovery.urls[7], 'https://example.com/blog/child1-8');
  assert.equal(discovery.urls[8], 'https://example.com/blog/child2-1');
  assert.equal(discovery.urls[14], 'https://example.com/blog/child2-7');
  assert.equal(discovery.sitemapUrl, 'https://example.com/sitemap.xml');
  assert.equal(discovery.errors.length, 0);
});

test('asynchronous gzip sitemap decompression processes gzipped content correctly', async () => {
  const articlesXml = makeArticles(15, 'gzip');
  const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      ${articlesXml}
    </urlset>`;
  const compressed = gzipSync(Buffer.from(xmlContent));

  const responses = new Map([
    ['https://example.com/sitemap.xml.gz', result('https://example.com/sitemap.xml.gz', compressed)],
  ]);

  const service = new SitemapService({
    get: async (url) => responses.get(url) ?? result(url, '', 404),
  });

  const discovery = await service.discover('https://example.com');
  assert.equal(discovery.urls.length, 15);
  assert.equal(discovery.sitemapUrl, 'https://example.com/sitemap.xml.gz');
});

test('bounded gzip decompression detects and halts decompression bombs exceeding byte limit', async () => {
  const hugePayload = Buffer.alloc(10 * 1024 * 1024, 'X');
  const compressedBomb = gzipSync(hugePayload);

  await assert.rejects(
    decompressGzipBounded(compressedBomb, 1 * 1024 * 1024),
    /exceeds 1048576 bytes/,
  );
});

test('malformed sitemap XML records error and continues gracefully to next fallback', async () => {
  const articlesXml = makeArticles(15, 'fallback');
  const responses = new Map([
    [
      'https://example.com/sitemap.xml',
      result('https://example.com/sitemap.xml', '<urlset><unclosed-tag>'),
    ],
    [
      'https://example.com/sitemap_index.xml',
      result(
        'https://example.com/sitemap_index.xml',
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          ${articlesXml}
        </urlset>`,
      ),
    ],
  ]);

  const service = new SitemapService({
    get: async (url) => responses.get(url) ?? result(url, '', 404),
  });

  const discovery = await service.discover('https://example.com');
  assert.equal(discovery.urls.length, 15);
  assert.equal(discovery.errors.length, 1);
  assert.ok(discovery.errors[0].includes('Malformed sitemap XML'));
});

test('isolated-entry error handling: invalid child sitemap does not prevent remaining siblings', async () => {
  const articlesXml = makeArticles(15, 'recovered');
  const responses = new Map([
    [
      'https://example.com/sitemap.xml',
      result(
        'https://example.com/sitemap.xml',
        `<?xml version="1.0" encoding="UTF-8"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>http://[invalid-broken-url</loc></sitemap>
          <sitemap><loc>https://example.com/valid-child.xml</loc></sitemap>
        </sitemapindex>`,
      ),
    ],
    [
      'https://example.com/valid-child.xml',
      result(
        'https://example.com/valid-child.xml',
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          ${articlesXml}
        </urlset>`,
      ),
    ],
  ]);

  const service = new SitemapService({
    get: async (url) => responses.get(url) ?? result(url, '', 404),
  });

  const discovery = await service.discover('https://example.com');
  assert.equal(discovery.urls.length, 15);
  assert.equal(discovery.errors.length, 1);
  assert.ok(discovery.errors[0].includes('Child sitemap'));
});

test('deduplicates page URLs and enforces site-scoping rules', async () => {
  const responses = new Map([
    [
      'https://example.com/sitemap.xml',
      result(
        'https://example.com/sitemap.xml',
        `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/blog/post-1</loc></url>
          <url><loc>https://example.com/blog/post-1</loc></url>
          <url><loc>https://external-site.com/blog/spam</loc></url>
          <url><loc>https://example.com/blog/post-2</loc></url>
        </urlset>`,
      ),
    ],
  ]);

  const service = new SitemapService({
    get: async (url) => responses.get(url) ?? result(url, '', 404),
  });

  const discovery = await service.discover('https://example.com');
  assert.deepEqual(discovery.urls, [
    'https://example.com/blog/post-1',
    'https://example.com/blog/post-2',
  ]);
});

test('15-article stopping behavior stops scanning subsequent sitemaps', async () => {
  let sitemap2Requested = false;
  const articlesXml = makeArticles(15, 'batch1');

  const responses = new Map([
    [
      'https://example.com/sitemap.xml',
      result(
        'https://example.com/sitemap.xml',
        `<?xml version="1.0" encoding="UTF-8"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://example.com/child-1.xml</loc></sitemap>
          <sitemap><loc>https://example.com/child-2.xml</loc></sitemap>
        </sitemapindex>`,
      ),
    ],
    [
      'https://example.com/child-1.xml',
      result(
        'https://example.com/child-1.xml',
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${articlesXml}</urlset>`,
      ),
    ],
  ]);

  const service = new SitemapService({
    get: async (url) => {
      if (url === 'https://example.com/child-2.xml') {
        sitemap2Requested = true;
      }
      return responses.get(url) ?? result(url, '', 404);
    },
  });

  const discovery = await service.discover('https://example.com');
  assert.equal(discovery.urls.length, 15);
  assert.equal(sitemap2Requested, false, 'Should not fetch child-2 once 15 articles are found');
});

test('traversal depth limit stops recursion at depth > 5', async () => {
  const responses = new Map();
  for (let i = 0; i <= 6; i++) {
    const next = i + 1;
    const isLeaf = i === 6;
    const body = isLeaf
      ? `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/blog/deep-post</loc></url>
        </urlset>`
      : `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://example.com/level-${next}.xml</loc></sitemap>
        </sitemapindex>`;
    responses.set(`https://example.com/level-${i}.xml`, result(`https://example.com/level-${i}.xml`, body));
  }
  responses.set('https://example.com/sitemap.xml', responses.get('https://example.com/level-0.xml'));

  const service = new SitemapService({
    get: async (url) => responses.get(url) ?? result(url, '', 404),
  });

  const discovery = await service.discover('https://example.com');
  assert.equal(discovery.urls.includes('https://example.com/blog/deep-post'), false);
});

test('cancellation during robots.txt promptly propagates exception without swallowing', async () => {
  const abortController = new AbortController();

  const service = new SitemapService({
    get: async () => {
      abortController.abort();
      const err = new Error('Request aborted: operation cancelled');
      err.name = 'AbortError';
      throw err;
    },
  });

  await assert.rejects(
    service.discover('https://example.com', abortController.signal),
    (err) => err.name === 'AbortError' || /aborted/i.test(err.message),
  );
});

test('cancellation during nested sitemap traversal propagates exception', async () => {
  const abortController = new AbortController();

  const responses = new Map([
    [
      'https://example.com/sitemap.xml',
      result(
        'https://example.com/sitemap.xml',
        `<?xml version="1.0" encoding="UTF-8"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://example.com/child-1.xml</loc></sitemap>
        </sitemapindex>`,
      ),
    ],
  ]);

  const service = new SitemapService({
    get: async (url) => {
      if (url === 'https://example.com/child-1.xml') {
        abortController.abort();
        const err = new Error('Request aborted: operation cancelled');
        err.name = 'AbortError';
        throw err;
      }
      return responses.get(url) ?? result(url, '', 404);
    },
  });

  await assert.rejects(
    service.discover('https://example.com', abortController.signal),
    (err) => err.name === 'AbortError' || /aborted/i.test(err.message),
  );
});

test('cancellation before recursion continues stops immediately', async () => {
  const abortController = new AbortController();
  abortController.abort();

  const service = new SitemapService({
    get: async () => {
      assert.fail('Should not initiate HTTP request if already aborted');
    },
  });

  await assert.rejects(
    service.discover('https://example.com', abortController.signal),
    /aborted/i,
  );
});
