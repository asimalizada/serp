export interface ClientListItem {
  id: string;
  name: string;
  websiteUrl: string;
  normalizedDomain: string;
  createdAt: Date;
  pageCount: number;
  latestCrawl: {
    id: string;
    status: number;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
  } | null;
}

export interface CreateClientPersistenceData {
  userId: string;
  websiteUrl: string;
  normalizedDomain: string;
  name: string;
}

export interface CreatedClientResult {
  client: {
    id: string;
    userId: string;
    name: string;
    websiteUrl: string;
    normalizedDomain: string;
    createdAt: Date;
  };
  crawlRun: {
    id: string;
    status: number;
  };
}

export interface LatestCrawlStatus {
  id: string;
  status: number;
  sitemapUrl: string | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  processedPages: number;
  failedPages: number;
}
