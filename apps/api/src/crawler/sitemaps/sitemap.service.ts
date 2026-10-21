import { Injectable } from '@nestjs/common';
import { isLikelyBlogArticle, isSameSiteUrl } from '../blog-url';
import { HttpClient, SafeHttpClient } from '../http/safe-http.client';
import { normalizeHttpUrl } from '../http/url-safety';
import {
  decompressGzipBounded,
  isGzipContent,
  MAX_XML_BYTES,
  parseSitemapXml,
} from './sitemap.parser';

export const SITEMAP_PATHS = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/wp-sitemap.xml',
  '/sitemap.xml.gz',
];

export interface SitemapDiscovery {
  urls: string[];
  sitemapUrl: string | null;
  errors: string[];
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof Error) {
    return error.name === 'AbortError' || /aborted/i.test(error.message);
  }
  return false;
}

@Injectable()
export class SitemapService {
  constructor(private readonly http: HttpClient) {}

  async discover(websiteUrl: string, signal?: AbortSignal): Promise<SitemapDiscovery> {
    if (signal?.aborted) {
      throw new Error('Sitemap discovery aborted: operation cancelled');
    }

    const website = new URL(normalizeHttpUrl(websiteUrl));
    const origin = website.origin;
    const candidates: string[] = [];
    const errors: string[] = [];

    // 1. Fetch and inspect robots.txt
    try {
      const robots = await this.http.get(`${origin}/robots.txt`, 256_000, signal);
      if (robots.status >= 200 && robots.status < 300) {
        for (const line of robots.body.toString('utf8').split(/\r?\n/)) {
          const match = /^\s*sitemap\s*:\s*([^#\s]+)/i.exec(line);
          if (match) {
            try {
              const candidate = new URL(match[1], origin).toString();
              const normalized = normalizeHttpUrl(candidate);
              if (isSameSiteUrl(normalized, websiteUrl)) {
                candidates.push(normalized);
              }
            } catch {
              // Ignore malformed robots.txt sitemap directives
            }
          }
        }
      }
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw error;
      }
      errors.push(`robots.txt: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 2. Add standard fallback paths
    candidates.push(...SITEMAP_PATHS.map((path) => `${origin}${path}`));

    const seenSitemaps = new Set<string>();
    const seenPages = new Set<string>();
    const urls: string[] = [];
    let blogCount = 0;
    let firstSitemap: string | null = null;

    // 3. Recursive visitor
    const visit = async (raw: string, depth: number): Promise<void> => {
      if (signal?.aborted) {
        throw new Error('Sitemap discovery aborted: operation cancelled');
      }

      if (blogCount >= 15 || depth > 5 || seenSitemaps.size >= 40 || urls.length >= 20_000) {
        return;
      }

      let sitemap: string;
      try {
        sitemap = normalizeHttpUrl(raw);
        if (!isSameSiteUrl(sitemap, websiteUrl)) {
          return;
        }
      } catch (error) {
        if (isAbortError(error, signal)) throw error;
        errors.push(`Invalid sitemap URL: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }

      if (seenSitemaps.has(sitemap)) {
        return;
      }
      seenSitemaps.add(sitemap);

      try {
        const response = await this.http.get(sitemap, 2_000_000, signal);
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`HTTP ${response.status}`);
        }

        const compressed = isGzipContent(sitemap, response.body);
        const bodyBuffer = compressed
          ? await decompressGzipBounded(response.body, MAX_XML_BYTES, signal)
          : response.body;

        if (bodyBuffer.byteLength > MAX_XML_BYTES) {
          throw new Error(`Decompressed sitemap exceeds ${MAX_XML_BYTES} bytes`);
        }

        const xml = bodyBuffer.toString('utf8');
        const parsed = parseSitemapXml(xml, MAX_XML_BYTES);

        if (parsed.type === 'index') {
          firstSitemap ??= response.url;
          for (const childLoc of parsed.sitemapUrls) {
            if (blogCount >= 15 || signal?.aborted) break;
            try {
              const childUrl = new URL(childLoc, response.url).toString();
              const normalizedChild = normalizeHttpUrl(childUrl);
              if (!isSameSiteUrl(normalizedChild, websiteUrl)) {
                continue;
              }
              await visit(normalizedChild, depth + 1);
            } catch (childError) {
              if (isAbortError(childError, signal)) {
                throw childError;
              }
              // One malformed child sitemap must not stop processing of remaining siblings
              errors.push(
                `Child sitemap ${childLoc}: ${childError instanceof Error ? childError.message : String(childError)}`,
              );
            }
          }
        } else if (parsed.type === 'urlset') {
          firstSitemap ??= response.url;
          for (const pageLoc of parsed.pageUrls) {
            if (urls.length >= 20_000 || blogCount >= 15) break;
            if (signal?.aborted) {
              throw new Error('Sitemap discovery aborted: operation cancelled');
            }

            try {
              const candidate = new URL(pageLoc, response.url).toString();
              const normalized = normalizeHttpUrl(candidate);
              if (!isSameSiteUrl(normalized, websiteUrl)) {
                continue;
              }
              if (!seenPages.has(normalized)) {
                seenPages.add(normalized);
                urls.push(normalized);
                if (isLikelyBlogArticle(normalized, websiteUrl)) {
                  blogCount++;
                }
              }
            } catch (entryError) {
              if (isAbortError(entryError, signal)) {
                throw entryError;
              }
              // Malformed individual entry does not invalidate the sitemap
            }
          }
        }
      } catch (error) {
        if (isAbortError(error, signal)) {
          throw error;
        }
        errors.push(`${sitemap}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    // 4. Iterate top-level candidates
    for (const candidate of candidates) {
      if (blogCount >= 15 || signal?.aborted) break;
      await visit(candidate, 0);
    }

    if (signal?.aborted) {
      throw new Error('Sitemap discovery aborted: operation cancelled');
    }

    if (urls.length >= 20_000 || seenSitemaps.size >= 40) {
      errors.push('Sitemap scan limit reached before 15 blog posts were found');
    }

    return { urls, sitemapUrl: firstSitemap, errors };
  }
}
