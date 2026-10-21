import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  PageFilterOptions,
  PageKeywordRelationship,
  PaginatedPagesDbResult,
  PageWithAnalysisRecord,
  RankSnapshotProjection,
} from '../types/page.types';

const CURRENT_ANALYSIS = {
  where: { status: 2 },
  orderBy: { processedAt: 'desc' },
  take: 1,
  select: {
    id: true,
    processedAt: true,
    httpStatusCode: true,
    title: true,
    metaDescription: true,
    h1: true,
    wordCount: true,
    contentHash: true,
    seoIssues: {
      select: {
        id: true,
        severity: true,
        details: true,
        issueType: { select: { id: true, code: true, name: true } },
      },
    },
    pageCrawlKeywords: {
      select: {
        relevanceScore: true,
        keyword: { select: { id: true, phrase: true } },
        pageKeyword: {
          select: {
            id: true,
            rankSnapshots: {
              orderBy: { snapshotDate: 'desc' },
              take: 1,
              select: { snapshotDate: true, snapshotAt: true, position: true },
            },
          },
        },
      },
    },
  },
} as const;

@Injectable()
export class PagesRepository {
  constructor(private readonly prisma: PrismaService) { }

  async findPaginatedPages(
    userId: string,
    options: PageFilterOptions,
  ): Promise<PaginatedPagesDbResult> {
    const where: Prisma.PageWhereInput = {
      client: { userId, archivedAt: null },
      ...(options.clientId ? { clientId: options.clientId } : {}),
      ...(options.url ? { url: { contains: options.url, mode: 'insensitive' } } : {}),
      ...(options.keyword
        ? { pageKeywords: { some: { keyword: { phrase: { contains: options.keyword, mode: 'insensitive' } } } } }
        : {}),
      ...(options.search
        ? {
          OR: [
            { url: { contains: options.search, mode: 'insensitive' } },
            { pageKeywords: { some: { keyword: { phrase: { contains: options.search, mode: 'insensitive' } } } } },
          ],
        }
        : {}),
    };

    const [total, pages] = await Promise.all([
      this.prisma.page.count({ where }),
      this.prisma.page.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
        select: {
          id: true,
          clientId: true,
          url: true,
          createdAt: true,
          pageCrawls: CURRENT_ANALYSIS,
        },
      }),
    ]);

    return { total, pages: pages as unknown as PageWithAnalysisRecord[] };
  }

  async findPageById(userId: string, pageId: string): Promise<PageWithAnalysisRecord | null> {
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, client: { userId, archivedAt: null } },
      select: {
        id: true,
        clientId: true,
        url: true,
        createdAt: true,
        pageCrawls: CURRENT_ANALYSIS,
      },
    });

    return page as unknown as PageWithAnalysisRecord | null;
  }

  async pageExistsForTenant(userId: string, pageId: string): Promise<boolean> {
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, client: { userId, archivedAt: null } },
      select: { id: true },
    });

    return page !== null;
  }

  async findPageKeywordForTenant(
    userId: string,
    pageId: string,
    pageKeywordId: string,
  ): Promise<PageKeywordRelationship | null> {
    return this.prisma.pageKeyword.findFirst({
      where: {
        id: pageKeywordId,
        pageId,
        page: { client: { userId, archivedAt: null } },
      },
      select: {
        id: true,
        keyword: {
          select: { id: true, phrase: true },
        },
      },
    });
  }

  async findRankSnapshotsForTenant(
    userId: string,
    pageId: string,
    pageKeywordId: string,
    start: Date,
    end: Date,
  ): Promise<RankSnapshotProjection[]> {
    return this.prisma.rankSnapshot.findMany({
      where: {
        pageKeywordId,
        pageKeyword: {
          id: pageKeywordId,
          pageId,
          page: { client: { userId, archivedAt: null } },
        },
        snapshotDate: {
          gte: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())),
          lte: new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())),
        },
        snapshotAt: { gte: start, lt: end },
      },
      orderBy: { snapshotAt: 'asc' },
      take: 400,
      select: {
        snapshotDate: true,
        snapshotAt: true,
        position: true,
      },
    });
  }
}