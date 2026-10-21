import type { Metadata } from 'next';
import { PagesTable } from '../../../components/pages/pages-table';
import { previewPages } from './preview-pages';

export const metadata: Metadata = {
  title: 'Pages | SERP',
};

export default function PagesPage() {
  return (
    <>
      <header>
        <h1 className="text-[clamp(2rem,2.8vw,2.5rem)] font-semibold leading-tight tracking-[-0.05em] text-ink">Pages</h1>
        <p className="mt-2 max-w-2xl text-[0.9375rem] leading-6 text-ink-muted">
          Indexed client pages, their search keywords, SEO issues, and latest positions.
        </p>
      </header>

      <section aria-label="Pages preview" className="mt-7 sm:mt-8">
        <p className="mb-2.5 text-xs font-medium text-ink-faint">Sample preview data · Not live results</p>
        <PagesTable pages={previewPages} />
      </section>
    </>
  );
}