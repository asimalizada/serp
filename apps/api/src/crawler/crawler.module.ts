import { Module } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { CrawlService } from './crawl-service';
import { PrismaCrawlStore } from './persistence';
import { SafeHttpClient } from './safe-http';
import { SitemapService } from './sitemap';

@Module({
  providers: [
    { provide: PrismaClient, useFactory: () => {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
      return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    } },
    { provide: SafeHttpClient, useFactory: () => new SafeHttpClient() },
    { provide: SitemapService, useFactory: (http: SafeHttpClient) => new SitemapService(http), inject: [SafeHttpClient] },
    { provide: PrismaCrawlStore, useFactory: (prisma: PrismaClient) => new PrismaCrawlStore(prisma), inject: [PrismaClient] },
    { provide: CrawlService, useFactory: (store: PrismaCrawlStore, http: SafeHttpClient, sitemaps: SitemapService) =>
      new CrawlService(store, http, sitemaps), inject: [PrismaCrawlStore, SafeHttpClient, SitemapService] },
  ],
})
export class CrawlerModule {}