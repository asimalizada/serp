import { PageContent } from './content';

export interface IssueDefinition {
  id: number;
  code: string;
  name: string;
  description: string;
  severity: 1 | 2 | 3;
  detect: (content: PageContent) => string | null;
}

export const ISSUE_DEFINITIONS: IssueDefinition[] = [
  {
    id: 1, code: 'MISSING_TITLE', name: 'Missing title', description: 'The page has no HTML title.', severity: 3,
    detect: (page) => page.title ? null : 'No non-empty <title> element was found.'
  },
  {
    id: 2, code: 'MISSING_META_DESCRIPTION', name: 'Missing meta description', description: 'The page has no meta description.', severity: 2,
    detect: (page) => page.metaDescription ? null : 'No non-empty meta description was found.'
  },
  {
    id: 3, code: 'MISSING_H1', name: 'Missing H1', description: 'The page has no H1 heading.', severity: 2,
    detect: (page) => page.h1Count ? null : 'No <h1> element was found.'
  },
  {
    id: 4, code: 'MULTIPLE_H1', name: 'Multiple H1 headings', description: 'The page has more than one H1 heading.', severity: 2,
    detect: (page) => page.h1Count > 1 ? `Found ${page.h1Count} H1 headings.` : null
  },
  {
    id: 5, code: 'MISSING_IMAGE_ALT', name: 'Missing image alt text', description: 'Article images are missing alt attributes.', severity: 2,
    detect: (page) => page.missingImageAltCount ? `${page.missingImageAltCount} article image(s) have no alt attribute.` : null
  },
  {
    id: 6, code: 'THIN_CONTENT', name: 'Thin content', description: 'The article has fewer than 300 words.', severity: 1,
    detect: (page) => page.wordCount < 300 ? `Article contains ${page.wordCount} words; threshold is 300.` : null
  },
];

export interface DetectedIssue {
  issueTypeId: number;
  code: string;
  severity: 1 | 2 | 3;
  details: string;
}

export function detectSeoIssues(content: PageContent): DetectedIssue[] {
  return ISSUE_DEFINITIONS.flatMap((definition) => {
    const details = definition.detect(content);
    return details ? [{ issueTypeId: definition.id, code: definition.code, severity: definition.severity, details }] : [];
  });
}