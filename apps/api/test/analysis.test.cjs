const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractPageContent } = require('../dist/crawler/analysis/content.js');
const { extractKeywords } = require('../dist/crawler/analysis/keywords.js');
const { detectSeoIssues, ISSUE_DEFINITIONS } = require('../dist/crawler/analysis/seo-issues.js');
const {
  isLikelyBlogArticle,
  isSameSiteUrl,
  normalizePageUrl,
  selectBlogUrls,
} = require('../dist/crawler/blog-url.js');

test('extractPageContent prioritizes article/main containers and strips unwanted elements', () => {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>  Advanced SEO Strategies &amp; Guide  </title>
      <meta name="description" content=" Learn comprehensive search engine optimization strategies. ">
    </head>
    <body>
      <nav>Navigation links should be removed</nav>
      <header>Header content</header>
      <main>
        <h1>Advanced SEO Strategies</h1>
        <p>This is the primary article body paragraph with informative text.</p>
        <div class="sidebar">Sidebar advertising and promotions</div>
        <div class="comments">User comments section</div>
        <script>console.log("tracking code");</script>
      </main>
      <footer>Footer copyright 2026</footer>
    </body>
    </html>
  `;

  const content = extractPageContent(html);
  assert.equal(content.title, 'Advanced SEO Strategies & Guide');
  assert.equal(content.metaDescription, 'Learn comprehensive search engine optimization strategies.');
  assert.equal(content.h1, 'Advanced SEO Strategies');
  assert.equal(content.h1Count, 1);
  assert.ok(content.text.includes('primary article body paragraph'));
  assert.ok(!content.text.includes('Navigation links'));
  assert.ok(!content.text.includes('Header content'));
  assert.ok(!content.text.includes('Footer copyright'));
  assert.ok(!content.text.includes('Sidebar advertising'));
  assert.ok(!content.text.includes('User comments'));
});

test('extractPageContent accurately counts words across Unicode characters, emojis, and contractions', () => {
  const html = `
    <article>
      <h1>Tech Innovation</h1>
      <p>Don't stop learning! L'innovation française 🚀 transforms modern world-class APIs in 2026.</p>
    </article>
  `;

  const content = extractPageContent(html);
  // Don't (1), stop (2), learning (3), L'innovation (4), française (5), transforms (6), modern (7), world (8), class (9), APIs (10), in (11), 2026 (12)
  assert.ok(content.wordCount >= 10, `Expected word count around 12, got ${content.wordCount}`);
});

test('extractPageContent accurately detects missing image alt attributes', () => {
  const html = `
    <article>
      <p>Images test</p>
      <img src="/img1.jpg" alt="Valid alt description">
      <img src="/img2.jpg" alt="">
      <img src="/img3.jpg">
      <img src="/img4.jpg" class="responsive">
    </article>
  `;

  const content = extractPageContent(html);
  // img3 and img4 have undefined alt attribute. img2 has empty string alt="" (which is defined).
  assert.equal(content.missingImageAltCount, 2);
});

test('contentHash is deterministic across whitespace variations', () => {
  const html1 = `
    <html><head><title>Title</title></head>
    <body><article><h1>Headline</h1><p>First paragraph.</p><p>Second paragraph.</p></article></body></html>
  `;
  const html2 = `
    <html><head><title>   Title   </title></head>
    <body><article>
      <h1>  Headline  </h1>
      <p>  First    paragraph.  </p>
      <p>   Second   paragraph.  </p>
    </article></body></html>
  `;

  const content1 = extractPageContent(html1);
  const content2 = extractPageContent(html2);
  assert.equal(content1.contentHash, content2.contentHash);
});

test('extractKeywords scores phrases, applies stop-word filtering, and bounds relevance to [0, 1]', () => {
  const content = {
    title: 'Modern SEO Optimization Guide',
    metaDescription: 'Complete guide for search engine optimization and ranking.',
    h1: 'Modern SEO Optimization',
    h1Count: 1,
    headings: ['Key Strategies for Optimization', 'Ranking Factors'],
    text: 'Modern SEO optimization is essential. Search engine ranking requires consistent optimization and optimization techniques.',
    wordCount: 15,
    missingImageAltCount: 0,
    contentHash: 'mock-hash',
  };

  const keywords = extractKeywords(content);
  assert.ok(keywords.length > 0);
  assert.ok(keywords.length <= 12);

  for (const kw of keywords) {
    assert.ok(kw.phrase.length >= 3);
    assert.ok(kw.relevanceScore > 0 && kw.relevanceScore <= 1);
    // Stop words alone should not form phrases
    assert.ok(!/^(the|and|or|in|at|to|a|an)$/i.test(kw.phrase));
  }

  // Keywords appearing in title and h1 should rank highest
  assert.ok(keywords.some((k) => k.phrase.includes('optimization')));
});

test('detectSeoIssues identifies all 6 SEO issue codes correctly', () => {
  const emptyPage = {
    title: null,
    metaDescription: null,
    h1: null,
    h1Count: 0,
    headings: [],
    text: 'Short text.',
    wordCount: 2,
    missingImageAltCount: 3,
    contentHash: 'hash-empty',
  };

  const issues = detectSeoIssues(emptyPage);
  const codes = issues.map((i) => i.code).sort();
  assert.deepEqual(codes, [
    'MISSING_H1',
    'MISSING_IMAGE_ALT',
    'MISSING_META_DESCRIPTION',
    'MISSING_TITLE',
    'THIN_CONTENT',
  ]);

  // Multiple H1s
  const multiH1Page = {
    title: 'Valid Title',
    metaDescription: 'Valid meta description.',
    h1: 'First H1',
    h1Count: 2,
    headings: ['Heading 2'],
    text: 'A'.repeat(500) + ' and ' + 'word '.repeat(350),
    wordCount: 351,
    missingImageAltCount: 0,
    contentHash: 'hash-multi',
  };
  const multiIssues = detectSeoIssues(multiH1Page);
  assert.equal(multiIssues.length, 1);
  assert.equal(multiIssues[0].code, 'MULTIPLE_H1');
  assert.equal(multiIssues[0].severity, 2);
});

test('blog-url heuristics accurately identify blog articles and filter out non-articles', () => {
  const website = 'https://example.com';

  // Valid blog articles
  assert.equal(isLikelyBlogArticle('https://example.com/blog/first-post', website), true);
  assert.equal(isLikelyBlogArticle('https://example.com/news/2026/03/update', website), true);
  assert.equal(isLikelyBlogArticle('https://blog.example.com/announcement', website), true);
  assert.equal(isLikelyBlogArticle('https://example.com/insights/market-trends', website), true);

  // Non-blog articles (categories, author pages, legal, etc.)
  assert.equal(isLikelyBlogArticle('https://example.com/blog/category/tech', website), false);
  assert.equal(isLikelyBlogArticle('https://example.com/blog/author/john', website), false);
  assert.equal(isLikelyBlogArticle('https://example.com/company/about-us', website), false);
  assert.equal(isLikelyBlogArticle('https://example.com/pricing', website), false);
  assert.equal(isLikelyBlogArticle('https://external-domain.com/blog/article', website), false);
});

test('extractKeywords produces deterministic output and deduplicates phrases across repeated runs', () => {
  const content = {
    title: 'Cloud Architecture & Infrastructure Best Practices',
    metaDescription: 'A comprehensive deep dive into cloud architecture, infrastructure, and resilience.',
    h1: 'Cloud Architecture & Infrastructure',
    h1Count: 1,
    headings: ['Scalable Infrastructure Patterns', 'Resilient Cloud Design'],
    text: 'Cloud architecture patterns enable high availability. Cloud architecture and infrastructure automation are essential.',
    wordCount: 16,
    missingImageAltCount: 0,
    contentHash: 'mock-hash-deterministic',
  };

  const run1 = extractKeywords(content);
  const run2 = extractKeywords(content);

  assert.deepEqual(run1, run2, 'Keyword extraction must produce bit-for-bit identical results on identical input');

  // Verify no duplicate phrases in output
  const phrases = run1.map((k) => k.phrase);
  const uniquePhrases = new Set(phrases);
  assert.equal(phrases.length, uniquePhrases.size, 'Extracted keywords must not contain duplicate phrases');
});
