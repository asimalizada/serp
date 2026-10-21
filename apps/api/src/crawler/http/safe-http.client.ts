import { BeforeApplicationShutdown, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { Agent, request } from 'undici';
import {
  Address,
  DEFAULT_RESOLVER,
  normalizeHttpUrl,
  Resolver,
  validateDestination,
} from './url-safety';

export interface HttpResult {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

export interface HttpClient {
  get(url: string, maxBytes: number, signal?: AbortSignal): Promise<HttpResult>;
}

export type TransportResult = Omit<HttpResult, 'url'> & { location?: string };
export type Transport = (
  url: string,
  address: Address,
  maxBytes: number,
  signal?: AbortSignal,
) => Promise<TransportResult>;

/**
 * Executes a single HTTP hop via Undici using a dedicated, request-scoped Agent.
 *
 * Architecture Note on Connection Management:
 * A request-scoped Agent is used deliberately rather than an unbounded or shared connection pool:
 * 1. DNS Pinning & Anti-Rebinding: Undici binds DNS resolution at the Agent level via `connect.lookup`.
 *    By creating an Agent configured with the pre-validated IP address, the underlying TCP/TLS connection
 *    is guaranteed to connect to the verified IP, eliminating Time-Of-Check to Time-Of-Use (TOCTOU) rebinding.
 * 2. TLS SNI & Certificate Integrity: The original hostname is passed in the request URL, ensuring TLS
 *    Server Name Indication (SNI) and certificate validation match the target domain.
 * 3. Crawl Isolation: Web crawlers contact arbitrary, untrusted internet hosts. Request-scoped agents
 *    guarantee immediate socket closure upon response completion, preventing socket descriptor exhaustion,
 *    stale keep-alive connections, or cross-tenant/cross-origin connection leaks.
 */
export async function undiciTransport(
  url: string,
  address: Address,
  maxBytes: number,
  signal?: AbortSignal,
  onAgentCreated?: (agent: Agent) => void,
  onAgentClosed?: (agent: Agent) => void,
): Promise<TransportResult> {
  const agent = new Agent({
    connect: {
      timeout: 5000,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    },
  });

  onAgentCreated?.(agent);

  try {
    const response = await request(url, {
      dispatcher: agent,
      headers: {
        'user-agent': 'SERP-crawler/0.1 (+website analysis)',
        'accept': 'text/html, application/xml, text/xml, text/plain, application/gzip, */*',
        'accept-encoding': 'identity',
      },
      headersTimeout: 8000,
      bodyTimeout: 8000,
      signal,
    });

    const chunks: Buffer[] = [];
    let bytes = 0;

    for await (const chunk of response.body) {
      const part = Buffer.from(chunk);
      bytes += part.length;
      if (bytes > maxBytes) {
        throw new Error(`Response exceeds ${maxBytes} bytes`);
      }
      chunks.push(part);
    }

    const contentType = response.headers['content-type'];
    const location = response.headers.location;

    return {
      status: response.statusCode,
      contentType: typeof contentType === 'string' ? contentType : '',
      body: Buffer.concat(chunks),
      ...(typeof location === 'string' ? { location } : {}),
    };
  } finally {
    try {
      await agent.close();
    } finally {
      onAgentClosed?.(agent);
    }
  }
}

@Injectable()
export class SafeHttpClient implements HttpClient, BeforeApplicationShutdown, OnModuleDestroy {
  private readonly shutdownController = new AbortController();
  private readonly activeAgents = new Set<Agent>();

  constructor(
    @Optional() private readonly resolveAddresses: Resolver = DEFAULT_RESOLVER,
    @Optional() private readonly transport: Transport = undiciTransport,
  ) {
    this.resolveAddresses = this.resolveAddresses ?? DEFAULT_RESOLVER;
    this.transport = this.transport ?? undiciTransport;
  }

  onModuleDestroy(): void {
    this.beforeApplicationShutdown();
  }

  beforeApplicationShutdown(): void {
    if (!this.shutdownController.signal.aborted) {
      this.shutdownController.abort();
    }
    for (const agent of this.activeAgents) {
      try {
        void agent.destroy();
      } catch {
        // Ignore errors during immediate shutdown destruction
      }
    }
    this.activeAgents.clear();
  }

  async validateDestination(input: string, signal?: AbortSignal): Promise<string> {
    const combinedSignal = this.combineSignals(signal, 5000);
    const { url } = await validateDestination(input, this.resolveAddresses, combinedSignal);
    return url;
  }

  async get(input: string, maxBytes: number, signal?: AbortSignal): Promise<HttpResult> {
    let current = normalizeHttpUrl(input);

    for (let redirect = 0; redirect <= 5; redirect++) {
      if (this.shutdownController.signal.aborted || signal?.aborted) {
        throw new Error('Request aborted: application shutting down or operation cancelled');
      }

      const url = new URL(current);
      const combinedSignal = this.combineSignals(signal, 12000);
      const { addresses } = await validateDestination(current, this.resolveAddresses, combinedSignal);

      const trackAgent = (agent: Agent) => {
        this.activeAgents.add(agent);
      };

      let result: TransportResult;
      try {
        result = await this.executeTransport(current, addresses[0], maxBytes, combinedSignal, trackAgent);
      } catch (error) {
        if (combinedSignal.aborted && signal?.aborted) {
          throw new Error('Request aborted: operation cancelled');
        }
        if (combinedSignal.aborted && this.shutdownController.signal.aborted) {
          throw new Error('Request aborted: application shutting down');
        }
        throw error;
      }

      const location = result.location;
      if ([301, 302, 303, 307, 308].includes(result.status) && location) {
        if (redirect === 5) {
          throw new Error('Too many redirects');
        }
        const target = normalizeHttpUrl(new URL(location, current).toString());
        if (url.protocol === 'https:' && new URL(target).protocol !== 'https:') {
          throw new Error('HTTPS downgrade redirect refused');
        }
        current = target;
        continue;
      }

      return {
        url: current,
        status: result.status,
        contentType: result.contentType,
        body: result.body,
      };
    }

    throw new Error('Too many redirects');
  }

  private combineSignals(callerSignal?: AbortSignal, timeoutMs?: number): AbortSignal {
    const signals: AbortSignal[] = [this.shutdownController.signal];
    if (callerSignal) {
      signals.push(callerSignal);
    }
    if (timeoutMs !== undefined && timeoutMs > 0) {
      signals.push(AbortSignal.timeout(timeoutMs));
    }
    return AbortSignal.any(signals);
  }

  private async executeTransport(
    url: string,
    address: Address,
    maxBytes: number,
    signal: AbortSignal,
    trackAgent: (agent: Agent) => void,
  ): Promise<TransportResult> {
    if (this.transport === undiciTransport) {
      return undiciTransport(
        url,
        address,
        maxBytes,
        signal,
        trackAgent,
        (agent) => {
          this.activeAgents.delete(agent);
        },
      );
    }

    return this.transport(url, address, maxBytes, signal);
  }
}
