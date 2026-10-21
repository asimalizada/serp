export interface PageFilterOptions {
  clientId?: string;
  url?: string;
  keyword?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export interface SeoIssueProjection {
  id: string;
  severity: number;
  details: string;
  issueType: {
    id: number;
    code: string;
    name: string;
  };
}

export interface RankSnapshotProjection {
  snapshotDate: Date;
  snapshotAt: Date;
  position: number;
}

export interface PageCrawlKeywordProjection {
  relevanceScore: { toNumber(): number } | number;
  keyword: {
    id: string;
    phrase: string;
  };
  pageKeyword: {
    id: string;
    rankSnapshots: RankSnapshotProjection[];
  };
}

export interface PageCrawlCurrentProjection {
  id: string;
  processedAt: Date | null;
  httpStatusCode: number | null;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  wordCount: number | null;
  contentHash: string | null;
  seoIssues: SeoIssueProjection[];
  pageCrawlKeywords: PageCrawlKeywordProjection[];
}

export interface PageWithAnalysisRecord {
  id: string;
  clientId: string;
  url: string;
  createdAt: Date;
  pageCrawls: PageCrawlCurrentProjection[];
}

export interface PageKeywordRelationship {
  id: string;
  keyword: {
    id: string;
    phrase: string;
  };
}

export interface LatestRankSummary {
  position: number;
  snapshotDate: string;
  snapshotAt: string;
}

export interface PageKeywordSummary {
  id: string;
  pageKeywordId: string;
  phrase: string;
  relevanceScore: number;
  latestRank: LatestRankSummary | null;
}

export interface PageIssueSummary {
  id: string;
  severity: number;
  details: string;
  code: string;
  name: string;
  issueTypeId: number;
}

export interface PageCurrentAnalysisSummary {
  id: string;
  processedAt: Date | null;
  httpStatusCode: number | null;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  wordCount: number | null;
  contentHash: string | null;
}

export interface FormattedPageResponse {
  id: string;
  clientId: string;
  url: string;
  createdAt: Date;
  current: PageCurrentAnalysisSummary | null;
  issueCount: number;
  issues: PageIssueSummary[];
  keywords: PageKeywordSummary[];
  primaryKeyword: PageKeywordSummary | null;
  latestRank: LatestRankSummary | null;
}

export interface PaginatedPagesResponse {
  items: FormattedPageResponse[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface RankHistoryPoint {
  date: string | null;
  snapshotDate: string;
  snapshotAt: string;
  position: number;
}

export interface RankHistoryResponse {
  pageId: string;
  pageKeywordId: string | null;
  keyword: { id: string; phrase: string } | null;
  timezone: string;
  from: string | null;
  to: string | null;
  history: RankHistoryPoint[];
  latestPosition: number | null;
}

export interface PaginatedPagesDbResult {
  pages: PageWithAnalysisRecord[];
  total: number;
}
