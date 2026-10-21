import { DateTime } from 'luxon';
import {
  FormattedPageResponse,
  PageCrawlCurrentProjection,
  PageKeywordSummary,
  PageWithAnalysisRecord,
  RankHistoryPoint,
  RankSnapshotProjection,
} from '../types/page.types';

export function sortPageKeywords(keywords: PageKeywordSummary[]): PageKeywordSummary[] {
  return [...keywords].sort((a, b) => b.relevanceScore - a.relevanceScore || a.phrase.localeCompare(b.phrase));
}

export function selectPrimaryKeyword(keywords: PageKeywordSummary[]): PageKeywordSummary | null {
  return keywords[0] ?? null;
}

export function mapCrawlKeywords(crawl: PageCrawlCurrentProjection | undefined): PageKeywordSummary[] {
  if (!crawl?.pageCrawlKeywords) {
    return [];
  }

  const rawKeywords = crawl.pageCrawlKeywords.map((item) => {
    const latestSnapshot = item.pageKeyword.rankSnapshots[0];
    const relevance = typeof item.relevanceScore === 'number'
      ? item.relevanceScore
      : item.relevanceScore.toNumber();

    return {
      id: item.keyword.id,
      pageKeywordId: item.pageKeyword.id,
      phrase: item.keyword.phrase,
      relevanceScore: relevance,
      latestRank: latestSnapshot
        ? {
            position: latestSnapshot.position,
            snapshotDate: latestSnapshot.snapshotDate.toISOString().slice(0, 10),
            snapshotAt: latestSnapshot.snapshotAt.toISOString(),
          }
        : null,
    };
  });

  return sortPageKeywords(rawKeywords);
}

export function mapPageRecordToResponse(page: PageWithAnalysisRecord): FormattedPageResponse {
  const crawl = page.pageCrawls[0];
  const keywords = mapCrawlKeywords(crawl);
  const primaryKeyword = selectPrimaryKeyword(keywords);

  return {
    id: page.id,
    clientId: page.clientId,
    url: page.url,
    createdAt: page.createdAt,
    current: crawl
      ? {
          id: crawl.id,
          processedAt: crawl.processedAt,
          httpStatusCode: crawl.httpStatusCode,
          title: crawl.title,
          metaDescription: crawl.metaDescription,
          h1: crawl.h1,
          wordCount: crawl.wordCount,
          contentHash: crawl.contentHash,
        }
      : null,
    issueCount: crawl?.seoIssues.length ?? 0,
    issues:
      crawl?.seoIssues.map(({ issueType, ...issue }) => ({
        ...issue,
        code: issueType.code,
        name: issueType.name,
        issueTypeId: issueType.id,
      })) ?? [],
    keywords,
    primaryKeyword,
    latestRank: primaryKeyword?.latestRank ?? null,
  };
}

export function mapRankSnapshotsToHistory(
  snapshots: RankSnapshotProjection[],
  timezone: string,
): RankHistoryPoint[] {
  return snapshots.map((item) => ({
    date: DateTime.fromJSDate(item.snapshotAt, { zone: timezone }).toISODate(),
    snapshotDate: item.snapshotDate.toISOString().slice(0, 10),
    snapshotAt: item.snapshotAt.toISOString(),
    position: item.position,
  }));
}
