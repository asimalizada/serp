import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientListQuery, CreateClientInput } from '@serp/shared';
import { normalizeDomain } from '../crawler/http/url-safety';
import { SafeHttpClient } from '../crawler/http/safe-http.client';
import { CrawlWorker } from '../crawler/workers/crawl-worker';
import { DuplicateClientError } from './errors/duplicate-client.error';
import { describeCrawlError, publicPageUrl } from './crawl-error';
import { ClientsRepository } from './repositories/clients.repository';

@Injectable()
export class ClientsService {
  constructor(
    private readonly repository: ClientsRepository,
    private readonly worker: CrawlWorker,
    private readonly http: SafeHttpClient,
  ) {}

  async list(userId: string, query: ClientListQuery = { status: 'active' }) {
    const clients = await this.repository.listWithSummary(userId, query.status);
    return { clients: clients.map((client) => ({
      ...client,
      latestCrawl: client.latestCrawl ? {
        ...client.latestCrawl, error: describeCrawlError(client.latestCrawl.error),
      } : null,
    })) };
  }

  async create(userId: string, body: CreateClientInput) {
    let websiteUrl: string;
    try {
      websiteUrl = await this.http.validateDestination(body.websiteUrl);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid website URL');
    }
    const normalizedDomain = normalizeDomain(websiteUrl);
    const name = body.name?.trim() || normalizedDomain;

    try {
      const result = await this.repository.createWithInitialRun({
        userId,
        websiteUrl,
        normalizedDomain,
        name,
      });
      this.worker.schedule();
      return result;
    } catch (error) {
      if (error instanceof DuplicateClientError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  async crawlStatus(userId: string, clientId: string) {
    const exists = await this.repository.existsForUser(clientId, userId);
    if (!exists) {
      throw new NotFoundException('Client not found');
    }
    const crawlRun = await this.repository.findLatestCrawlStatus(clientId);
    return { clientId, crawlRun: crawlRun ? {
      ...crawlRun,
      error: describeCrawlError(crawlRun.error),
      pageFailures: crawlRun.pageFailures.map((failure) => ({
        url: publicPageUrl(failure.url),
        httpStatusCode: failure.httpStatusCode,
        reason: describeCrawlError(failure.error),
      })),
    } : null };
  }

  async setArchived(userId: string, clientId: string, archive: boolean) {
    const result = await this.repository.setArchived(userId, clientId, archive);
    if (result.kind === 'not-found') throw new NotFoundException('Client not found');
    if (result.kind === 'active-crawl') throw new ConflictException('Wait for the active crawl to finish before archiving this client');
    return { clientId, archivedAt: result.archivedAt, changed: result.kind === 'changed' };
  }

  async recrawl(userId: string, clientId: string) {
    let result: Awaited<ReturnType<ClientsRepository['queueRecrawl']>>;
    try {
      result = await this.repository.queueRecrawl(userId, clientId);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('A crawl is already pending or running for this client');
      }
      throw error;
    }
    if (result.kind === 'not-found') throw new NotFoundException('Client not found');
    if (result.kind === 'archived') throw new ConflictException('Restore this client before recrawling');
    if (result.kind === 'active-crawl') throw new ConflictException('A crawl is already pending or running for this client');
    this.worker.schedule();
    return { clientId, crawlRun: result.crawlRun };
  }
}