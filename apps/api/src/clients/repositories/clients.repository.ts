import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DuplicateClientError } from '../errors/duplicate-client.error';
import {
  ClientListItem,
  CreateClientPersistenceData,
  CreatedClientResult,
  LatestCrawlStatus,
} from '../types/client.types';

@Injectable()
export class ClientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listWithSummary(userId: string, status: 'active' | 'archived' = 'active'): Promise<ClientListItem[]> {
    const clients = await this.prisma.client.findMany({
      where: { userId, archivedAt: status === 'active' ? null : { not: null } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        websiteUrl: true,
        normalizedDomain: true,
        createdAt: true,
        archivedAt: true,
        _count: { select: { pages: true } },
        crawlRuns: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, error: true, createdAt: true, startedAt: true, finishedAt: true },
        },
      },
    });

    const runIds = clients.flatMap(({ crawlRuns }) => crawlRuns.map(({ id }) => id));
    const counts = runIds.length ? await this.prisma.pageCrawl.groupBy({
      by: ['crawlRunId', 'status'],
      where: { crawlRunId: { in: runIds }, status: { in: [2, 3] } },
      _count: { _all: true },
    }) : [];
    const countFor = (runId: string, statusValue: number) =>
      counts.find((item) => item.crawlRunId === runId && item.status === statusValue)?._count._all ?? 0;

    return clients.map(({ _count, crawlRuns, ...client }) => ({
      ...client,
      pageCount: _count.pages,
      latestCrawl: crawlRuns[0] ? {
        ...crawlRuns[0],
        processedPages: countFor(crawlRuns[0].id, 2),
        failedPages: countFor(crawlRuns[0].id, 3),
      } : null,
    }));
  }

  private async lockOwnedClient(tx: Prisma.TransactionClient, userId: string, clientId: string) {
    const rows = await tx.$queryRaw<{ id: string; archivedAt: Date | null }[]>`
      SELECT "id", "archivedAt" FROM "Clients"
      WHERE "id" = ${clientId}::uuid AND "userId" = ${userId}::uuid FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async setArchived(userId: string, clientId: string, archive: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const client = await this.lockOwnedClient(tx, userId, clientId);
      if (!client) return { kind: 'not-found' as const };
      if ((client.archivedAt !== null) === archive) {
        return { kind: 'unchanged' as const, archivedAt: client.archivedAt };
      }
      if (archive && await tx.crawlRun.count({ where: { clientId, status: { in: [0, 1] } } })) {
        return { kind: 'active-crawl' as const };
      }
      const updated = await tx.client.update({
        where: { id: clientId }, data: { archivedAt: archive ? new Date() : null },
        select: { archivedAt: true },
      });
      return { kind: 'changed' as const, archivedAt: updated.archivedAt };
    });
  }

  async queueRecrawl(userId: string, clientId: string) {
    return this.prisma.$transaction(async (tx) => {
      const client = await this.lockOwnedClient(tx, userId, clientId);
      if (!client) return { kind: 'not-found' as const };
      if (client.archivedAt) return { kind: 'archived' as const };
      if (await tx.crawlRun.count({ where: { clientId, status: { in: [0, 1] } } })) {
        return { kind: 'active-crawl' as const };
      }
      const run = await tx.crawlRun.create({ data: { clientId, status: 0 }, select: { id: true, status: true } });
      return { kind: 'created' as const, crawlRun: run };
    });
  }

  async createWithInitialRun(data: CreateClientPersistenceData): Promise<CreatedClientResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const client = await tx.client.create({
          data: {
            userId: data.userId,
            websiteUrl: data.websiteUrl,
            normalizedDomain: data.normalizedDomain,
            name: data.name,
          },
        });
        const run = await tx.crawlRun.create({
          data: {
            clientId: client.id,
            status: 0,
          },
        });
        return {
          client,
          crawlRun: { id: run.id, status: run.status },
        };
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        throw new DuplicateClientError();
      }
      throw error;
    }
  }

  async existsForUser(clientId: string, userId: string): Promise<boolean> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, userId },
      select: { id: true },
    });
    return client !== null;
  }

  async findLatestCrawlStatus(clientId: string): Promise<LatestCrawlStatus | null> {
    const run = await this.prisma.crawlRun.findFirst({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        sitemapUrl: true,
        error: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
      },
    });

    if (!run) return null;

    const [counts, failures] = await Promise.all([this.prisma.pageCrawl.groupBy({
      by: ['status'],
      where: { crawlRunId: run.id },
      _count: { _all: true },
    }), this.prisma.pageCrawl.findMany({
      where: { crawlRunId: run.id, status: 3 },
      orderBy: [{ sitemapOrder: 'asc' }, { id: 'asc' }],
      take: 10,
      select: { page: { select: { url: true } }, httpStatusCode: true, error: true },
    })]);

    return {
      ...run,
      processedPages: counts.find((item) => item.status === 2)?._count._all ?? 0,
      failedPages: counts.find((item) => item.status === 3)?._count._all ?? 0,
      pageFailures: failures.map(({ page, httpStatusCode, error }) => ({ url: page.url, httpStatusCode, error })),
    };
  }
}