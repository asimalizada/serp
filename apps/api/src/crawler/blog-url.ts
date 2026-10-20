import { normalizeHttpUrl } from './safe-http';

function siteHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

export function normalizePageUrl(input: string): string {
  const url = new URL(normalizeHttpUrl(input));
  return url.toString();
}

export function isSameSiteUrl(input: string, websiteUrl: string): boolean {
  const url = new URL(normalizeHttpUrl(input));
  const website = new URL(normalizeHttpUrl(websiteUrl));
  const primaryHost = siteHost(website.hostname);
  return siteHost(url.hostname) === primaryHost || url.hostname.toLowerCase() === `blog.${primaryHost}`;
}

export function isLikelyBlogArticle(input: string, websiteUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(normalizePageUrl(input));
  } catch {
    return false;
  }
  if (!isSameSiteUrl(url.toString(), websiteUrl)) return false;
  const segments = url.pathname.toLowerCase().split('/').filter(Boolean);
  if (!segments.length) return false;
  if (segments.some((part) => /^(category|categories|tag|tags|author|authors|page|feed|search|archives?)$/.test(part))) return false;
  if (segments.some((part) => /^(company|customers|case-studies|success-stories)$/.test(part))) return false;
  const slug = segments.at(-1)!;
  if (!/[a-z]/.test(slug) || /^(blog|news|articles?|insights?|resources?|index|sitemap)(\.html?)?$/.test(slug)) return false;
  const section = segments.slice(0, -1).some((part) => /(blog|news|articles?|insights?|stories|guides)/.test(part));
  const dated = segments.length >= 4 && /^20\d{2}$/.test(segments[0]) && /^\d{1,2}$/.test(segments[1]);
  const blogSubdomain = url.hostname.toLowerCase().startsWith('blog.');
  return (section && segments.length >= 2) || dated || (blogSubdomain && segments.length >= 1);
}

export function selectBlogUrls(urls: string[], websiteUrl: string, limit = 15): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    if (!isLikelyBlogArticle(raw, websiteUrl)) continue;
    const url = normalizePageUrl(raw);
    if (seen.has(url)) continue;
    seen.add(url);
    selected.push(url);
    if (selected.length === limit) break;
  }
  return selected;
}