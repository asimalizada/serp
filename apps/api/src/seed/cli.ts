import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '../generated/prisma/client';
import { CrawlService } from '../crawler/crawl-service';
import { CrawlerModule } from '../crawler/crawler.module';
import { crawlDemoClients, provisionDemoClients, validateDemoPasswords } from './demo';
import { generateRankSnapshots } from './ranks';

async function main(): Promise<void> {
  loadEnv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
  validateDemoPasswords(process.env);
  const app = await NestFactory.createApplicationContext(CrawlerModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaClient);
    const clientIds = await provisionDemoClients(prisma, process.env);
    const crawls = await crawlDemoClients(prisma, app.get(CrawlService), clientIds);
    for (const result of crawls) process.stdout.write(`${JSON.stringify(result)}\n`);
    const ranks = await generateRankSnapshots(prisma);
    process.stdout.write(`${JSON.stringify({ rankSnapshots: ranks })}\n`);
    if (crawls.some(({ summary }) => summary && (summary.failed > 0 || summary.processed === 0))) process.exitCode = 1;
  } finally {
    await app.get(PrismaClient).$disconnect();
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});