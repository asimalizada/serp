import { PrismaService } from '../../database/prisma.service';
import { PageContent } from '../analysis/content';
import { ScoredKeyword } from '../analysis/keywords';
import { DetectedIssue, ISSUE_DEFINITIONS } from '../analysis/seo-issues';

export interface PageAnalysis {
  content: PageContent;
  keywords: ScoredKeyword[];
  issues: DetectedIssue[];
  httpStatusCode: number;
}

export interface CrawlStore {
  getClient(clientId: string): Promise<{ id: string; websiteUrl: string } | null>;
  createRun(clientId: string): Promise<string>;
  startRun(runId: string): Promise<void>;
  finishRun(runId: string, status: 2 | 3, sitemapUrl: string | null, error: string | null): Promise<void>;
  ensureIssueTypes(): Promise<void>;
  savePage(clientId: string, runId: string, url: string, order: number, analysis: PageAnalysis): Promise<void>;
  saveFailedPage(clientId: string, runId: string, url: string, order: number, error: string, httpStatusCode?: number): Promise<void>;
}

export class CrawlRunNotPendingError extends Error {
  constructor(runId: string) {
    super(`Crawl run ${runId} is no longer pending`);
    this.name = 'CrawlRunNotPendingError';
  }
}

export class PrismaCrawlStore implements CrawlStore {
  private issueTypesEnsured = false;

  constructor(private readonly prisma: PrismaService) {}

  async getClient(clientId: string): Promise<{ id: string; websiteUrl: string } | null> {
    return this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, websiteUrl: true },
    });
  }

  async createRun(clientId: string): Promise<string> {
    const run = await this.prisma.crawlRun.create({ data: { clientId, status: 0 } });
    return run.id;
  }

  async startRun(runId: string): Promise<void> {
    const claimed = await this.prisma.crawlRun.updateMany({
      where: { id: runId, status: 0 },
      data: { status: 1, startedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new CrawlRunNotPendingError(runId);
    }
  }

  async finishRun(runId: string, status: 2 | 3, sitemapUrl: string | null, error: string | null): Promise<void> {
    await this.prisma.crawlRun.updateMany({
      where: { id: runId, status: 1 },
      data: { status, sitemapUrl, error, finishedAt: new Date() },
    });
  }

  async ensureIssueTypes(): Promise<void> {
    if (this.issueTypesEnsured) return;

    const count = await this.prisma.seoIssueType.count();
    if (count < ISSUE_DEFINITIONS.length) {
      for (const definition of ISSUE_DEFINITIONS) {
        const existing = await this.prisma.seoIssueType.upsert({
          where: { id: definition.id },
          create: {
            id: definition.id,
            code: definition.code,
            name: definition.name,
            description: definition.description,
          },
          update: {},
        });
        if (existing.code !== definition.code) {
          throw new Error(`SEO issue type ${definition.id} is assigned to ${existing.code}`);
        }
      }
    }
    this.issueTypesEnsured = true;
  }

  async savePage(clientId: string, runId: string, url: string, order: number, analysis: PageAnalysis): Promise<void> {
    // 1. In-memory deduplication of keywords with highest relevance score preserved
    const uniqueKeywordsMap = new Map<string, number>();
    for (const item of analysis.keywords) {
      const phrase = item.phrase.trim();
      if (!phrase) continue;
      const existing = uniqueKeywordsMap.get(phrase);
      if (existing === undefined || item.relevanceScore > existing) {
        uniqueKeywordsMap.set(phrase, item.relevanceScore);
      }
    }
    const sortedPhrases = [...uniqueKeywordsMap.keys()].sort();

    // 2. In-memory deduplication of SEO issues by issueTypeId
    const uniqueIssuesMap = new Map<number, DetectedIssue>();
    for (const issue of analysis.issues) {
      uniqueIssuesMap.set(issue.issueTypeId, issue);
    }
    const uniqueIssues = [...uniqueIssuesMap.values()];

    // 3. Retry loop for transient database concurrency conflicts (P2034)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            // A. Page upsert
            const page = await tx.page.upsert({
              where: { clientId_url: { clientId, url } },
              create: { clientId, url },
              update: {},
            });

            // B. Create PageCrawl in status 0 (trigger requires status < 2 before adding children)
            const crawl = await tx.pageCrawl.create({
              data: {
                crawlRunId: runId,
                pageId: page.id,
                clientId,
                sitemapOrder: order,
                status: 0,
                httpStatusCode: analysis.httpStatusCode,
                title: analysis.content.title,
                metaDescription: analysis.content.metaDescription,
                h1: analysis.content.h1,
                wordCount: analysis.content.wordCount,
                contentHash: analysis.content.contentHash,
              },
            });

            // C. Batch insert missing Keywords
            if (sortedPhrases.length > 0) {
              await tx.keyword.createMany({
                data: sortedPhrases.map((phrase) => ({ phrase })),
                skipDuplicates: true,
              });

              // D. Batch fetch keyword records
              const keywordRecords = await tx.keyword.findMany({
                where: { phrase: { in: sortedPhrases } },
                select: { id: true, phrase: true },
              });

              // E. Batch insert PageKeywords (skip duplicates)
              await tx.pageKeyword.createMany({
                data: keywordRecords.map((kw) => ({
                  pageId: page.id,
                  keywordId: kw.id,
                })),
                skipDuplicates: true,
              });

              // F. Batch insert PageCrawlKeywords
              await tx.pageCrawlKeyword.createMany({
                data: keywordRecords.map((kw) => ({
                  pageCrawlId: crawl.id,
                  pageId: page.id,
                  keywordId: kw.id,
                  relevanceScore: uniqueKeywordsMap.get(kw.phrase) ?? 0,
                })),
                skipDuplicates: true,
              });
            }

            // G. Batch insert SeoIssues
            if (uniqueIssues.length > 0) {
              await tx.seoIssue.createMany({
                data: uniqueIssues.map((issue) => ({
                  pageCrawlId: crawl.id,
                  issueTypeId: issue.issueTypeId,
                  severity: issue.severity,
                  details: issue.details,
                })),
                skipDuplicates: true,
              });
            }

            // H. Atomically transition PageCrawl to terminal status 2
            await tx.pageCrawl.update({
              where: { id: crawl.id },
              data: { status: 2, processedAt: new Date() },
            });
          },
          { maxWait: 10_000, timeout: 20_000 },
        );
        return;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'P2034') || attempt === 2) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  }

  async saveFailedPage(
    clientId: string,
    runId: string,
    url: string,
    order: number,
    error: string,
    httpStatusCode?: number,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const page = await tx.page.upsert({
          where: { clientId_url: { clientId, url } },
          create: { clientId, url },
          update: {},
        });
        await tx.pageCrawl.create({
          data: {
            crawlRunId: runId,
            pageId: page.id,
            clientId,
            sitemapOrder: order,
            status: 3,
            httpStatusCode,
            error: error.slice(0, 2000),
            processedAt: new Date(),
          },
        });
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }
}
