import { createHash } from 'node:crypto';
import { load } from 'cheerio';

export interface PageContent {
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  h1Count: number;
  headings: string[];
  text: string;
  wordCount: number;
  missingImageAltCount: number;
  contentHash: string;
}

function cleanText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function extractPageContent(html: string): PageContent {
  const $ = load(html);
  const title = cleanText($('head title').first().text()) || null;
  const metaDescription = cleanText($('meta[name="description"]').first().attr('content') ?? '') || null;
  const h1s = $('h1').toArray().map((element) => cleanText($(element).text())).filter(Boolean);
  let chosen;
  for (const selector of ['article', '[itemprop="articleBody"]', 'main', '[role="main"]']) {
    const candidates = $(selector).toArray();
    if (candidates.length) {
      chosen = candidates.sort((a, b) => $(b).text().length - $(a).text().length)[0];
      break;
    }
  }
  const content = chosen ? $(chosen).clone() : $('body').clone();
  content.find('script, style, noscript, nav, header, footer, aside, form, button, svg, iframe, [role="navigation"], .sidebar, .related, .comments, #comments').remove();
  const blocks = content.find('p, li, h2, h3, h4, blockquote').toArray();
  const text = cleanText(blocks.length ? blocks.map((node) => $(node).text()).join(' ') : content.text());
  const headings = content.find('h2, h3').toArray().map((node) => cleanText($(node).text())).filter(Boolean);
  const missingImageAltCount = content.find('img').toArray().filter((node) => $(node).attr('alt') === undefined).length;
  const analyzed = [title, metaDescription, h1s[0], text].map((part) => cleanText(part ?? '').toLowerCase()).join('\n');
  return {
    title,
    metaDescription,
    h1: h1s[0] ?? null,
    h1Count: h1s.length,
    headings,
    text,
    wordCount: text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0,
    missingImageAltCount,
    contentHash: createHash('sha256').update(analyzed).digest('hex'),
  };
}