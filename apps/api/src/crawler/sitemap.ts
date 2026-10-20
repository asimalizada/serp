import { gunzipSync } from 'node:zlib';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { isLikelyBlogArticle } from './blog-url';
import { HttpClient, normalizeHttpUrl } from './safe-http';

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false });
const SITEMAP_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml', '/sitemap.xml.gz'];

function asList<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function loc(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('loc' in value)) return null;
  const raw = (value as { loc: unknown }).loc;
  return typeof raw === 'string' ? raw.trim() : null;
}

export interface SitemapDiscovery {
  urls: string[];
  sitemapUrl: string | null;
  errors: string[];
}

export class SitemapService {
  constructor(private readonly http: HttpClient) {}

  async discover(websiteUrl: string): Promise<SitemapDiscovery> {
    const website = new URL(normalizeHttpUrl(websiteUrl));
    const origin = website.origin;
    const candidates: string[] = [];
    const errors: string[] = [];
    try {
      const robots = await this.http.get(`${origin}/robots.txt`, 256_000);
      if (robots.status >= 200 && robots.status < 300) {
        for (const line of robots.body.toString('utf8').split(/\r?\n/)) {
          const match = /^\s*sitemap\s*:\s*([^#\s]+)/i.exec(line);
          if (match) candidates.push(new URL(match[1], origin).toString());
        }
      }
    } catch (error) {
      errors.push(`robots.txt: ${String(error)}`);
    }
    candidates.push(...SITEMAP_PATHS.map((path) => `${origin}${path}`));

    const seenSitemaps = new Set<string>();
    const seenPages = new Set<string>();
    const urls: string[] = [];
    let blogCount = 0;
    let firstSitemap: string | null = null;

    const visit = async (raw: string, depth: number): Promise<void> => {
      if (blogCount >= 15 || depth > 5 || seenSitemaps.size >= 40 || urls.length >= 20_000) return;
      let sitemap: string;
      try {
        sitemap = normalizeHttpUrl(raw);
      } catch (error) {
        errors.push(`Invalid sitemap URL: ${String(error)}`);
        return;
      }
      if (seenSitemaps.has(sitemap)) return;
      seenSitemaps.add(sitemap);
      try {
        const response = await this.http.get(sitemap, 2_000_000);
        if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
        const compressed = sitemap.endsWith('.gz') || response.body.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]));
        const xml = (compressed ? gunzipSync(response.body, { maxOutputLength: 8_000_000 }) : response.body).toString('utf8');
        if (xml.length > 8_000_000 || XMLValidator.validate(xml) !== true) throw new Error('Malformed sitemap XML');
        const data = parser.parse(xml) as {
          sitemapindex?: { sitemap?: unknown | unknown[] };
          urlset?: { url?: unknown | unknown[] };
        };
        if (data.sitemapindex) {
          firstSitemap ??= response.url;
          for (const child of asList(data.sitemapindex.sitemap)) {
            if (blogCount >= 15) break;
            const childUrl = loc(child);
            if (childUrl) await visit(new URL(childUrl, response.url).toString(), depth + 1);
          }
        } else if (data.urlset) {
          firstSitemap ??= response.url;
          for (const entry of asList(data.urlset.url)) {
            const pageUrl = loc(entry);
            if (!pageUrl) continue;
            try {
              const normalized = normalizeHttpUrl(pageUrl);
              if (!seenPages.has(normalized)) {
                seenPages.add(normalized);
                urls.push(normalized);
                if (isLikelyBlogArticle(normalized, websiteUrl)) blogCount++;
              }
            } catch {
              // Invalid entries do not invalidate the remaining sitemap.
            }
            if (urls.length >= 20_000 || blogCount >= 15) break;
          }
        } else {
          throw new Error('Not a sitemap index or URL set');
        }
      } catch (error) {
        errors.push(`${sitemap}: ${String(error)}`);
      }
    };

    for (const candidate of candidates) {
      if (blogCount >= 15) break;
      await visit(candidate, 0);
    }
    if (urls.length >= 20_000 || seenSitemaps.size >= 40) errors.push('Sitemap scan limit reached before 15 blog posts were found');
    return { urls, sitemapUrl: firstSitemap, errors };
  }
}