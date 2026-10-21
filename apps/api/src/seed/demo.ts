import { hash } from 'bcryptjs';
import { PrismaClient } from '../generated/prisma/client';
import { CrawlService, CrawlSummary } from '../crawler/crawl-service';
import { isLikelyBlogArticle } from '../crawler/blog-url';
import { normalizeDomain, normalizeHttpUrl } from '../crawler/http/url-safety';
import { normalizeEmail } from '../normalize-email';

export const DEMO_SITES = [
  { email: 'semrush.demo@serp.local', name: 'Semrush', websiteUrl: 'https://www.semrush.com', passwordEnv: 'SEED_USER_A_PASSWORD' },
  { email: 'yoast.demo@serp.local', name: 'Yoast', websiteUrl: 'https://yoast.com', passwordEnv: 'SEED_USER_B_PASSWORD' },
] as const;

export function validateDemoPasswords(values: Record<string, string | undefined>): void {
  for (const site of DEMO_SITES) {
    const password = values[site.passwordEnv];
    if (!password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
      throw new Error(`${site.passwordEnv} must contain 12–72 UTF-8 bytes (bcrypt limit)`);
    }
  }
}

export async function provisionDemoClients(prisma: PrismaClient, values: Record<string, string | undefined>): Promise<string[]> {
  validateDemoPasswords(values);
  const clientIds: string[] = [];
  for (const site of DEMO_SITES) {
    const email = normalizeEmail(site.email);
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, passwordHash: await hash(values[site.passwordEnv]!, 12) },
      update: {},
    });
    const websiteUrl = normalizeHttpUrl(site.websiteUrl);
    const client = await prisma.client.upsert({
      where: { userId_normalizedDomain: { userId: user.id, normalizedDomain: normalizeDomain(websiteUrl) } },
      create: { userId: user.id, name: site.name, websiteUrl, normalizedDomain: normalizeDomain(websiteUrl) },
      update: {},
    });
    clientIds.push(client.id);
  }
  return clientIds;
}

export interface SeedCrawlResult { clientId: string; skipped: boolean; priorSuccessfulPages: number; summary?: CrawlSummary }

export async function crawlDemoClients(prisma: PrismaClient, crawler: CrawlService, clientIds: string[]): Promise<SeedCrawlResult[]> {
  const results: SeedCrawlResult[] = [];
  for (const clientId of clientIds) {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { websiteUrl: true, archivedAt: true } });
    const successful = await prisma.page.findMany({
      where: { clientId, pageCrawls: { some: { status: 2 } } }, select: { url: true },
    });
    const successfulUrls = new Set(successful.map(({ url }) => url)
      .filter((url) => isLikelyBlogArticle(url, client.websiteUrl)));
    if (client.archivedAt) {
      results.push({ clientId, skipped: true, priorSuccessfulPages: successfulUrls.size });
      continue;
    }
    const activeRun = await prisma.crawlRun.findFirst({
      where: { clientId, status: { in: [0, 1] } }, select: { id: true },
    });
    if (activeRun) {
      results.push({ clientId, skipped: true, priorSuccessfulPages: successfulUrls.size });
      continue;
    }
    if (successfulUrls.size >= 15) {
      results.push({ clientId, skipped: true, priorSuccessfulPages: successfulUrls.size });
      continue;
    }
    const summary = await crawler.crawlClient(clientId, successfulUrls);
    results.push({ clientId, skipped: false, priorSuccessfulPages: successfulUrls.size, summary });
  }
  return results;
}