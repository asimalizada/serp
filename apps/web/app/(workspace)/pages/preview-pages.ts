import type { PageListRow } from '../../../components/pages/pages-table';

// Illustrative records shaped from the fields returned by GET /pages.
export const previewPages: PageListRow[] = [
  {
    id: '8cd8022e-eae7-4e26-a496-c186fa805dc8',
    clientId: '1b9096cf-e545-4f43-acaa-e95378cc39b7',
    url: 'https://www.semrush.com/blog/technical-seo-audit/',
    current: { title: 'A practical guide to technical SEO audits' },
    keywords: [
      { phrase: 'technical seo audit', relevanceScore: 0.9182 },
      { phrase: 'website audit checklist', relevanceScore: 0.7421 },
      { phrase: 'site health', relevanceScore: 0.6158 },
    ],
    issueCount: 2,
    latestRank: { position: 8 },
  },
  {
    id: '0a79346b-042b-4bb1-ae0b-f941950944a2',
    clientId: '1b9096cf-e545-4f43-acaa-e95378cc39b7',
    url: 'https://www.semrush.com/blog/content-strategy-for-organic-search-and-long-term-visibility/',
    current: { title: 'Building a content strategy for lasting organic search visibility across your entire website' },
    keywords: [
      { phrase: 'content strategy', relevanceScore: 0.8874 },
      { phrase: 'organic search visibility', relevanceScore: 0.7035 },
    ],
    issueCount: 0,
    latestRank: { position: 23 },
  },
  {
    id: '251a3672-204f-4cd4-a5ad-930e31fca2bc',
    clientId: 'a4975d13-c538-4712-bd26-bdcacfb55d44',
    url: 'https://yoast.com/wordpress-seo-guide/',
    current: { title: 'WordPress SEO: a guide for site owners' },
    keywords: [
      { phrase: 'wordpress seo', relevanceScore: 0.9016 },
      { phrase: 'seo guide', relevanceScore: 0.6712 },
    ],
    issueCount: 1,
    latestRank: null,
  },
  {
    id: '237f8b6d-1fe0-4b10-a143-ce8b1b60ee9d',
    clientId: 'a4975d13-c538-4712-bd26-bdcacfb55d44',
    url: 'https://yoast.com/seo-blog/improving-site-structure-with-clear-navigation-and-internal-links/',
    current: { title: null },
    keywords: [{ phrase: 'internal linking', relevanceScore: 0.7583 }],
    issueCount: 3,
    latestRank: { position: 41 },
  },
  {
    id: '163cf06b-e689-42cf-8cbe-d650d32bb7bd',
    clientId: '1b9096cf-e545-4f43-acaa-e95378cc39b7',
    url: 'https://www.semrush.com/blog/keyword-research-process/',
    current: null,
    keywords: [],
    issueCount: 0,
    latestRank: null,
  },
];