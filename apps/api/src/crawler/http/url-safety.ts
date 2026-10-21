import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export type Address = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<Address[]>;

export const DEFAULT_RESOLVER: Resolver = async (hostname: string): Promise<Address[]> => {
  const ipVersion = isIP(hostname);
  if (ipVersion === 4 || ipVersion === 6) {
    return [{ address: hostname, family: ipVersion as 4 | 6 }];
  }
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.filter((result): result is Address => result.family === 4 || result.family === 6);
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
  if (url.port && !['80', '443'].includes(url.port)) {
    throw new Error('Unsafe HTTP port');
  }
  url.hash = '';
  return url.toString();
}

export function normalizeDomain(websiteUrl: string): string {
  return new URL(normalizeHttpUrl(websiteUrl)).hostname.toLowerCase().replace(/^www\./, '');
}

export function isPublicIp(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

export async function resolveWithin(
  resolver: Resolver,
  hostname: string,
  timeoutMs: number = 5000,
  signal?: AbortSignal,
): Promise<Address[]> {
  if (signal?.aborted) {
    throw new Error('DNS lookup aborted');
  }

  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;

  try {
    return await Promise.race([
      resolver(hostname),
      new Promise<Address[]>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS lookup timed out')), timeoutMs);
        if (signal) {
          onAbort = () => reject(new Error('DNS lookup aborted'));
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export async function validateDestination(
  input: string,
  resolver: Resolver = DEFAULT_RESOLVER,
  signal?: AbortSignal,
): Promise<{ url: string; addresses: Address[] }> {
  const normalized = normalizeHttpUrl(input);
  const hostname = new URL(normalized).hostname.replace(/^\[|\]$/g, '');
  const ipVersion = isIP(hostname);
  const addresses: Address[] =
    ipVersion === 4 || ipVersion === 6
      ? [{ address: hostname, family: ipVersion as 4 | 6 }]
      : await resolveWithin(resolver, hostname, 5000, signal);

  if (!addresses.length || addresses.some((item) => !isPublicIp(item.address))) {
    throw new Error(`Unsafe destination: ${hostname}`);
  }
  return { url: normalized, addresses };
}