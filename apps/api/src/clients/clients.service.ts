import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateClientInput } from '@serp/shared';
import { normalizeDomain } from '../crawler/http/url-safety';
import { SafeHttpClient } from '../crawler/http/safe-http.client';
import { CrawlWorker } from '../crawler/workers/crawl-worker';
import { DuplicateClientError } from './errors/duplicate-client.error';
import { ClientsRepository } from './repositories/clients.repository';

@Injectable()
export class ClientsService {
  constructor(
    private readonly repository: ClientsRepository,
    private readonly worker: CrawlWorker,
    private readonly http: SafeHttpClient,
  ) {}

  async list(userId: string) {
    const clients = await this.repository.listWithSummary(userId);
    return { clients };
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
    return { clientId, crawlRun };
  }
}