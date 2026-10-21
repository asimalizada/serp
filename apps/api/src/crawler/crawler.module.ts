import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PrismaService } from '../database/prisma.service';
import { CrawlService } from './crawl-service';
import { PrismaCrawlStore } from './persistence/prisma-crawl.store';
import { SafeHttpClient } from './http/safe-http.client';
import { SitemapService } from './sitemaps/sitemap.service';
import { CrawlWorker } from './workers/crawl-worker';

@Module({
  imports: [DatabaseModule],
  providers: [
    SafeHttpClient,
    { provide: SitemapService, useFactory: (http: SafeHttpClient) => new SitemapService(http), inject: [SafeHttpClient] },
    { provide: PrismaCrawlStore, useFactory: (prisma: PrismaService) => new PrismaCrawlStore(prisma), inject: [PrismaService] },
    { provide: CrawlService, useFactory: (store: PrismaCrawlStore, http: SafeHttpClient, sitemaps: SitemapService) =>
      new CrawlService(store, http, sitemaps), inject: [PrismaCrawlStore, SafeHttpClient, SitemapService] },
    CrawlWorker,
  ],
  exports: [CrawlService, SafeHttpClient, CrawlWorker],
})
export class CrawlerModule {}