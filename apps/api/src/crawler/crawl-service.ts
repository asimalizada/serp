import { isSameSiteUrl, selectBlogUrls } from './blog-url';
import { extractPageContent } from './analysis/content';
import { extractKeywords } from './analysis/keywords';
import { detectSeoIssues } from './analysis/seo-issues';
import { HttpClient } from './http/safe-http.client';
import { CrawlStore } from './persistence/prisma-crawl.store';
import { SitemapService } from './sitemaps/sitemap.service';

export interface CrawlSummary {
  runId: string;
  discovered: number;
  selected: number;
  processed: number;
  failed: number;
  sitemapUrl: string | null;
  errors: string[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CrawlService {
  constructor(
    private readonly store: CrawlStore,
    private readonly http: HttpClient,
    private readonly sitemaps: SitemapService,
  ) {}

  async crawlClient(clientId: string, skipSuccessfulUrls: ReadonlySet<string> = new Set(), queuedRunId?: string, signal?: AbortSignal): Promise<CrawlSummary> {
    const client = await this.store.getClient(clientId);
    if (!client) throw new Error(`Client ${clientId} does not exist`);
    const runId = queuedRunId ?? await this.store.createRun(clientId);
    const summary: CrawlSummary = { runId, discovered: 0, selected: 0, processed: 0, failed: 0, sitemapUrl: null, errors: [] };
    await this.store.startRun(runId);
    try {
      if (signal?.aborted) throw new Error('Crawl aborted: application is shutting down');
      let unpersistedPage = false;
      await this.store.ensureIssueTypes();
      const discovery = await this.sitemaps.discover(client.websiteUrl, signal);
      summary.discovered = discovery.urls.length;
      summary.sitemapUrl = discovery.sitemapUrl;
      summary.errors.push(...discovery.errors);
      const selected = selectBlogUrls(discovery.urls, client.websiteUrl)
        .map((url, index) => ({ url, order: index + 1 }))
        .filter(({ url }) => !skipSuccessfulUrls.has(url));
      summary.selected = selected.length;
      if (!selected.length) throw new Error('No qualifying blog posts found in accessible sitemaps');

      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(3, selected.length) }, async () => {
        while (cursor < selected.length) {
          if (signal?.aborted) throw new Error('Crawl aborted: application is shutting down');
          const index = cursor++;
          const { url, order } = selected[index];
          let httpStatusCode: number | undefined;
          try {
            const response = await this.http.get(url, 2_000_000, signal);
            httpStatusCode = response.status;
            if (!isSameSiteUrl(response.url, client.websiteUrl)) throw new Error('Page redirected outside the client website');
            if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
            if (response.contentType && !/text\/html|application\/xhtml\+xml/i.test(response.contentType)) {
              throw new Error(`Unexpected page content type: ${response.contentType}`);
            }
            const content = extractPageContent(response.body.toString('utf8'));
            await this.store.savePage(clientId, runId, url, order, {
              content, keywords: extractKeywords(content), issues: detectSeoIssues(content), httpStatusCode: response.status,
            });
            summary.processed++;
          } catch (error) {
            const message = `${url}: ${errorText(error)}`;
            summary.failed++;
            summary.errors.push(message);
            try {
              await this.store.saveFailedPage(clientId, runId, url, order, errorText(error), httpStatusCode);
            } catch (persistenceError) {
              unpersistedPage = true;
              summary.errors.push(`${url}: failed to save page failure: ${errorText(persistenceError)}`);
            }
          }
        }
      }));
      await this.store.finishRun(runId, summary.processed > 0 && !unpersistedPage ? 2 : 3, summary.sitemapUrl,
        summary.failed ? `${summary.failed} page(s) failed. ${summary.errors.slice(-3).join(' | ')}`.slice(0, 2000) : null);
    } catch (error) {
      summary.errors.push(errorText(error));
      await this.store.finishRun(runId, 3, summary.sitemapUrl, summary.errors.slice(-3).join(' | ').slice(0, 2000));
    }
    return summary;
  }
}