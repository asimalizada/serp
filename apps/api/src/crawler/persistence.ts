import { PrismaClient } from '../generated/prisma/client';
import { PageContent } from './content';
import { ScoredKeyword } from './keywords';
import { DetectedIssue, ISSUE_DEFINITIONS } from './seo-issues';

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

export class PrismaCrawlStore implements CrawlStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getClient(clientId: string) {
    return this.prisma.client.findUnique({ where: { id: clientId }, select: { id: true, websiteUrl: true } });
  }

  async createRun(clientId: string): Promise<string> {
    const run = await this.prisma.crawlRun.create({ data: { clientId, status: 0 } });
    return run.id;
  }

  async startRun(runId: string): Promise<void> {
    await this.prisma.crawlRun.update({ where: { id: runId }, data: { status: 1, startedAt: new Date() } });
  }

  async finishRun(runId: string, status: 2 | 3, sitemapUrl: string | null, error: string | null): Promise<void> {
    await this.prisma.crawlRun.update({
      where: { id: runId },
      data: { status, sitemapUrl, error, finishedAt: new Date() },
    });
  }

  async ensureIssueTypes(): Promise<void> {
    for (const definition of ISSUE_DEFINITIONS) {
      const existing = await this.prisma.seoIssueType.upsert({
        where: { id: definition.id },
        create: { id: definition.id, code: definition.code, name: definition.name, description: definition.description },
        update: {},
      });
      if (existing.code !== definition.code) throw new Error(`SEO issue type ${definition.id} is assigned to ${existing.code}`);
    }
  }

  async savePage(clientId: string, runId: string, url: string, order: number, analysis: PageAnalysis): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.upsert({
        where: { clientId_url: { clientId, url } },
        create: { clientId, url }, update: {},
      });
      const crawl = await tx.pageCrawl.create({
        data: {
          crawlRunId: runId, pageId: page.id, clientId, sitemapOrder: order, status: 0,
          httpStatusCode: analysis.httpStatusCode,
          title: analysis.content.title, metaDescription: analysis.content.metaDescription,
          h1: analysis.content.h1, wordCount: analysis.content.wordCount,
          contentHash: analysis.content.contentHash,
        },
      });
      for (const item of analysis.keywords) {
        await tx.keyword.createMany({ data: [{ phrase: item.phrase }], skipDuplicates: true });
        const keyword = await tx.keyword.findUniqueOrThrow({ where: { phrase: item.phrase } });
        await tx.pageKeyword.upsert({
          where: { pageId_keywordId: { pageId: page.id, keywordId: keyword.id } },
          create: { pageId: page.id, keywordId: keyword.id }, update: {},
        });
        await tx.pageCrawlKeyword.create({
          data: { pageCrawlId: crawl.id, pageId: page.id, keywordId: keyword.id, relevanceScore: item.relevanceScore },
        });
      }
      for (const issue of analysis.issues) {
        await tx.seoIssue.create({
          data: { pageCrawlId: crawl.id, issueTypeId: issue.issueTypeId, severity: issue.severity, details: issue.details },
        });
      }
      await tx.pageCrawl.update({ where: { id: crawl.id }, data: { status: 2, processedAt: new Date() } });
    }, { maxWait: 10_000, timeout: 20_000 });
  }

  async saveFailedPage(clientId: string, runId: string, url: string, order: number, error: string, httpStatusCode?: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.upsert({
        where: { clientId_url: { clientId, url } },
        create: { clientId, url }, update: {},
      });
      await tx.pageCrawl.create({
        data: {
          crawlRunId: runId, pageId: page.id, clientId, sitemapOrder: order,
          status: 3, httpStatusCode, error: error.slice(0, 2000), processedAt: new Date(),
        },
      });
    }, { maxWait: 10_000, timeout: 20_000 });
  }
}