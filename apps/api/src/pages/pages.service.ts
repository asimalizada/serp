import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PageListQueryOutput, RankHistoryQueryOutput } from '@serp/shared';
import { DateTime } from 'luxon';
import { mapPageRecordToResponse, mapRankSnapshotsToHistory } from './mappers/page.mapper';
import { PagesRepository } from './repositories/pages.repository';
import {
  FormattedPageResponse,
  PageKeywordRelationship,
  PaginatedPagesResponse,
  RankHistoryResponse,
} from './types/page.types';

export function localDateBounds(from: DateTime, to: DateTime): { start: Date; end: Date } {
  return {
    start: from.startOf('day').toUTC().toJSDate(),
    end: to.plus({ days: 1 }).startOf('day').toUTC().toJSDate(),
  };
}

@Injectable()
export class PagesService {
  constructor(private readonly pagesRepository: PagesRepository) {}

  async list(userId: string, query: PageListQueryOutput): Promise<PaginatedPagesResponse> {
    const { total, pages } = await this.pagesRepository.findPaginatedPages(userId, query);
    return {
      items: pages.map(mapPageRecordToResponse),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async detail(userId: string, pageId: string): Promise<FormattedPageResponse> {
    const page = await this.pagesRepository.findPageById(userId, pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }
    return mapPageRecordToResponse(page);
  }

  async rankHistory(
    userId: string,
    timezone: string,
    pageId: string,
    query: RankHistoryQueryOutput,
  ): Promise<RankHistoryResponse> {
    const to = query.to
      ? DateTime.fromISO(query.to, { zone: timezone })
      : DateTime.now().setZone(timezone).startOf('day');
    const from = query.from
      ? DateTime.fromISO(query.from, { zone: timezone })
      : to.minus({ days: 29 });

    const validateDateRange = () => {
      if (
        !from.isValid ||
        !to.isValid ||
        from.toISODate() !== (query.from ?? from.toISODate()) ||
        to.toISODate() !== (query.to ?? to.toISODate()) ||
        from > to ||
        to.diff(from, 'days').days > 365
      ) {
        throw new BadRequestException('Date range must use valid YYYY-MM-DD dates spanning at most 366 days');
      }
    };

    let keywordRelation: PageKeywordRelationship | null = null;

    if (!query.keywordId) {
      const page = await this.pagesRepository.findPageById(userId, pageId);
      if (!page) {
        throw new NotFoundException('Page not found');
      }
      validateDateRange();

      const formatted = mapPageRecordToResponse(page);
      const pageKeywordId = formatted.primaryKeyword?.pageKeywordId;
      if (!pageKeywordId) {
        return {
          pageId,
          pageKeywordId: null,
          keyword: null,
          timezone,
          from: from.toISODate(),
          to: to.toISODate(),
          history: [],
          latestPosition: null,
        };
      }
      keywordRelation = {
        id: pageKeywordId,
        keyword: {
          id: formatted.primaryKeyword!.id,
          phrase: formatted.primaryKeyword!.phrase,
        },
      };
    } else {
      const pageExists = await this.pagesRepository.pageExistsForTenant(userId, pageId);
      if (!pageExists) {
        throw new NotFoundException('Page not found');
      }
      validateDateRange();

      keywordRelation = await this.pagesRepository.findPageKeywordForTenant(
        userId,
        pageId,
        query.keywordId,
      );
      if (!keywordRelation) {
        throw new NotFoundException('Keyword not found for this page');
      }
    }

    const { start, end } = localDateBounds(from, to);
    const snapshots = await this.pagesRepository.findRankSnapshotsForTenant(
      userId,
      pageId,
      keywordRelation.id,
      start,
      end,
    );

    const history = mapRankSnapshotsToHistory(snapshots, timezone);

    return {
      pageId,
      pageKeywordId: keywordRelation.id,
      keyword: keywordRelation.keyword,
      timezone,
      from: from.toISODate(),
      to: to.toISODate(),
      history,
      latestPosition: history.at(-1)?.position ?? null,
    };
  }
}