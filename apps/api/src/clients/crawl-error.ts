/** Present only known crawl failure facts; stored errors may contain untrusted remote text. */
export function describeCrawlError(error: string | null): string | null {
  if (!error) return null;
  const failedPages = /^(\d+) page\(s\) failed\./.exec(error);
  if (failedPages) return `${failedPages[1]} page(s) failed during crawling.`;
  if (error.includes('No qualifying blog posts found in accessible sitemaps')) {
    return 'No qualifying blog articles were found in accessible sitemaps.';
  }
  if (error.includes('Malformed sitemap XML')) return 'A sitemap could not be parsed.';
  if (/Unexpected page content type/.test(error)) return 'A page did not return HTML.';
  if (/Response exceeds \d+ bytes/.test(error)) return 'A website response exceeded the size limit.';
  if (/Too many redirects|redirected outside|downgrade redirect/i.test(error)) return 'A website redirect could not be followed.';
  if (/Unsafe destination|private address/i.test(error)) return 'A website address was rejected for safety.';
  if (/timeout|timed out|UND_ERR_CONNECT_TIMEOUT/i.test(error)) return 'A website request timed out.';
  const http = /\bHTTP ([1-5]\d{2})\b/.exec(error);
  if (http) return `The website returned HTTP ${http[1]}.`;
  return 'The crawl could not be completed. Review the page failure count or try again.';
}

export function publicPageUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return 'Page URL unavailable';
  }
}