import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CrawlService } from '../crawl-service';
import { isLikelyBlogArticle } from '../blog-url';
import { CrawlRunNotPendingError } from '../persistence/prisma-crawl.store';

@Injectable()
export class CrawlWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(CrawlWorker.name);
  private working = false;
  private stopping = false;
  private scheduled = false;
  private task?: Promise<void>;
  private pollTimer?: NodeJS.Timeout;
  private abortController = new AbortController();

  constructor(private readonly prisma: PrismaService, private readonly crawler: CrawlService) {}

  async onApplicationBootstrap(): Promise<void> {
    const running = await this.prisma.crawlRun.count({ where: { status: 1 } });
    if (running) this.logger.warn(`${running} running crawl(s) found at startup; ownership cannot be inferred, so they were left untouched`);
    this.schedule();
    this.pollTimer = setInterval(() => {
      this.schedule();
    }, 15_000);
    this.pollTimer.unref();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.abortController.abort();
    await this.task;
  }

  schedule(): void {
    if (this.stopping) return;
    this.scheduled = true;
    if (this.working) return;
    setImmediate(() => {
      if (this.working || this.stopping) return;
      this.task = this.processQueue().catch((error: unknown) => {
        this.logger.error('Background crawl queue stopped unexpectedly', error instanceof Error ? error.stack : String(error));
      }).finally(() => {
        this.task = undefined;
      });
    });
  }

  async processQueue(): Promise<void> {
    if (this.working || this.stopping) return;
    this.working = true;
    try {
      while (!this.stopping) {
        this.scheduled = false;
        const run = await this.prisma.crawlRun.findFirst({
          where: { status: 0 }, orderBy: { createdAt: 'asc' },
          select: { id: true, clientId: true, client: { select: { websiteUrl: true } } }
        });
        if (!run) {
          if (this.scheduled && !this.stopping) {
            continue;
          }
          break;
        }
        try {
          const successful = await this.prisma.page.findMany({
            where: {
              clientId: run.clientId,
              pageCrawls: { some: { status: 2 } }
            }, select: { url: true }
          });
          const urls = new Set(successful.map(({ url }) => url)
            .filter((url) => isLikelyBlogArticle(url, run.client.websiteUrl)));
          await this.crawler.crawlClient(run.clientId, urls, run.id, this.abortController.signal);
        } catch (error) {
          if (error instanceof CrawlRunNotPendingError) {
            this.logger.debug?.(`Crawl run ${run.id} was claimed by another worker; skipping`);
            continue;
          }
          this.logger.error(`Background crawl ${run.id} failed`, error instanceof Error ? error.stack : String(error));
          const errorMessage = `Background crawl failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 2000);
          const current = await this.prisma.crawlRun.findUnique({ where: { id: run.id }, select: { status: true } });
          if (current?.status === 0) {
            // Error occurred before claiming. Claim 0 -> 1 atomically, then 1 -> 3.
            const claimed = await this.prisma.crawlRun.updateMany({
              where: { id: run.id, status: 0 },
              data: { status: 1, startedAt: new Date() }
            });
            if (claimed.count === 1) {
              await this.prisma.crawlRun.updateMany({
                where: { id: run.id, status: 1 },
                data: { status: 3, finishedAt: new Date(), error: errorMessage }
              });
            }
          } else if (current?.status === 1) {
            // Error occurred after successful claim by this worker. Finalize 1 -> 3.
            await this.prisma.crawlRun.updateMany({
              where: { id: run.id, status: 1 },
              data: { status: 3, finishedAt: new Date(), error: errorMessage }
            });
          }
        }
      }
    } finally {
      this.working = false;
      if (this.scheduled && !this.stopping) {
        this.schedule();
      }
    }
  }
}