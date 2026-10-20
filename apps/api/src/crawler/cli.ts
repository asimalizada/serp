import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '../generated/prisma/client';
import { CrawlService } from './crawl-service';
import { CrawlerModule } from './crawler.module';

async function main(): Promise<void> {
  const option = process.argv.indexOf('--client');
  const clientId = option >= 0 ? process.argv[option + 1] : undefined;
  if (!clientId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
    throw new Error('Usage: pnpm crawl --client <client-uuid>');
  }
  loadEnv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
  const app = await NestFactory.createApplicationContext(CrawlerModule, { logger: ['error', 'warn'] });
  try {
    const summary = await app.get(CrawlService).crawlClient(clientId);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!summary.processed) process.exitCode = 1;
  } finally {
    await app.get(PrismaClient).$disconnect();
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});