import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, request } from 'undici';
import ipaddr from 'ipaddr.js';

export interface HttpResult {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

export interface HttpClient {
  get(url: string, maxBytes: number): Promise<HttpResult>;
}

type Address = { address: string; family: 4 | 6 };
type Resolver = (hostname: string) => Promise<Address[]>;
type Transport = (url: string, address: Address, maxBytes: number) => Promise<Omit<HttpResult, 'url'>>;

const DEFAULT_RESOLVER: Resolver = async (hostname) => {
  if (isIP(hostname)) return [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  return (await lookup(hostname, { all: true, verbatim: true })) as Address[];
};

export function normalizeHttpUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Invalid website URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('Only credential-free HTTP(S) URLs are allowed');
  }
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Unsafe HTTP port');
  url.hash = '';
  return url.toString();
}

function publicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

async function resolveWithin(resolver: Resolver, hostname: string): Promise<Address[]> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      resolver(hostname),
      new Promise<Address[]>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS lookup timed out')), 5000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function undiciTransport(url: string, address: Address, maxBytes: number): Promise<Omit<HttpResult, 'url'>> {
  const agent = new Agent({
    connect: {
      timeout: 5000,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    },
  });
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
      signal: AbortSignal.timeout(12000),
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      const part = Buffer.from(chunk);
      bytes += part.length;
      if (bytes > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes`);
      chunks.push(part);
    }
    const contentType = response.headers['content-type'];
    const location = response.headers.location;
    return {
      status: response.statusCode,
      contentType: typeof contentType === 'string' ? contentType : '',
      body: Buffer.concat(chunks),
      ...((typeof location === 'string' ? { location } : {}) as { location?: string }),
    };
  } finally {
    await agent.close();
  }
}

export class SafeHttpClient implements HttpClient {
  constructor(
    private readonly resolveAddresses: Resolver = DEFAULT_RESOLVER,
    private readonly transport: Transport = undiciTransport,
  ) {}

  async get(input: string, maxBytes: number): Promise<HttpResult> {
    let current = normalizeHttpUrl(input);
    for (let redirect = 0; redirect <= 5; redirect++) {
      const url = new URL(current);
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = await resolveWithin(this.resolveAddresses, hostname);
      if (!addresses.length || addresses.some((item) => !publicAddress(item.address))) {
        throw new Error(`Unsafe destination: ${hostname}`);
      }
      const result = await this.transport(current, addresses[0], maxBytes);
      const location = (result as { location?: string }).location;
      if ([301, 302, 303, 307, 308].includes(result.status) && location) {
        if (redirect === 5) throw new Error('Too many redirects');
        const target = normalizeHttpUrl(new URL(location, current).toString());
        if (url.protocol === 'https:' && new URL(target).protocol !== 'https:') {
          throw new Error('HTTPS downgrade redirect refused');
        }
        current = target;
        continue;
      }
      return { url: current, status: result.status, contentType: result.contentType, body: result.body };
    }
    throw new Error('Too many redirects');
  }
}