import { Injectable } from '@nestjs/common';
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

  async listWithSummary(userId: string): Promise<ClientListItem[]> {
    const clients = await this.prisma.client.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        websiteUrl: true,
        normalizedDomain: true,
        createdAt: true,
        _count: { select: { pages: true } },
        crawlRuns: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, createdAt: true, startedAt: true, finishedAt: true },
        },
      },
    });

    return clients.map(({ _count, crawlRuns, ...client }) => ({
      ...client,
      pageCount: _count.pages,
      latestCrawl: crawlRuns[0] ?? null,
    }));
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

    const counts = await this.prisma.pageCrawl.groupBy({
      by: ['status'],
      where: { crawlRunId: run.id },
      _count: { _all: true },
    });

    return {
      ...run,
      processedPages: counts.find((item) => item.status === 2)?._count._all ?? 0,
      failedPages: counts.find((item) => item.status === 3)?._count._all ?? 0,
    };
  }
}
