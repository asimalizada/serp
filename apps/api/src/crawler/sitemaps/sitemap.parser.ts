import { createGunzip } from 'node:zlib';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const MAX_XML_BYTES = 8_000_000;

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
});

export function isGzipContent(url: string, body: Buffer): boolean {
  return (
    url.endsWith('.gz') ||
    (body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b)
  );
}

/**
 * Asynchronously decompresses a gzip buffer with strict output size bounding.
 * Protects against decompression bombs by destroying the stream if decompressed
 * bytes exceed maxOutputBytes.
 */
export async function decompressGzipBounded(
  buffer: Buffer,
  maxOutputBytes: number = MAX_XML_BYTES,
  signal?: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('Decompression aborted: operation cancelled'));
    }

    const gunzip = createGunzip({ maxOutputLength: maxOutputBytes });
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    const onAbort = () => {
      gunzip.destroy(new Error('Decompression aborted: operation cancelled'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    gunzip.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxOutputBytes) {
        gunzip.destroy(new Error(`Decompressed sitemap exceeds ${maxOutputBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });

    gunzip.on('error', (err) => {
      cleanup();
      reject(err);
    });

    gunzip.on('end', () => {
      cleanup();
      resolve(Buffer.concat(chunks, totalBytes));
    });

    gunzip.end(buffer);
  });
}

function asList<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

export function extractLoc(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('loc' in value)) return null;
  const raw = (value as { loc: unknown }).loc;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

export type ParsedSitemap =
  | { type: 'index'; sitemapUrls: string[] }
  | { type: 'urlset'; pageUrls: string[] };

/**
 * Parses and validates sitemap XML, returning either an index of child sitemaps
 * or a set of page URLs.
 * Validates actual byte length rather than JavaScript UTF-16 character length.
 */
export function parseSitemapXml(xml: string, maxBytes: number = MAX_XML_BYTES): ParsedSitemap {
  if (Buffer.byteLength(xml, 'utf8') > maxBytes) {
    throw new Error(`Sitemap XML exceeds ${maxBytes} bytes`);
  }

  if (XMLValidator.validate(xml) !== true) {
    throw new Error('Malformed sitemap XML');
  }

  const data = parser.parse(xml) as {
    sitemapindex?: { sitemap?: unknown | unknown[] };
    urlset?: { url?: unknown | unknown[] };
  };

  if (data.sitemapindex) {
    const sitemapUrls: string[] = [];
    for (const child of asList(data.sitemapindex.sitemap)) {
      const location = extractLoc(child);
      if (location) {
        sitemapUrls.push(location);
      }
    }
    return { type: 'index', sitemapUrls };
  }

  if (data.urlset) {
    const pageUrls: string[] = [];
    for (const entry of asList(data.urlset.url)) {
      const location = extractLoc(entry);
      if (location) {
        pageUrls.push(location);
      }
    }
    return { type: 'urlset', pageUrls };
  }

  throw new Error('Not a sitemap index or URL set');
}
