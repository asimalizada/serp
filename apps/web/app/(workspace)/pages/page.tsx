import type { Metadata } from 'next';
import Link from 'next/link';
import { PagesContent } from '../../../components/pages/pages-content';

export const metadata: Metadata = {
  title: 'Pages | SERP',
};

export default function PagesPage() {
  return (
    <>
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[clamp(2rem,2.8vw,2.5rem)] font-semibold leading-tight tracking-[-0.05em] text-ink">Pages</h1>
          <p className="mt-2 max-w-2xl text-[0.9375rem] leading-6 text-ink-muted">
            Indexed client pages, their search keywords, SEO issues, and latest positions.
          </p>
        </div>
        <Link href="/clients/new" className="inline-flex h-10 shrink-0 items-center justify-center self-start rounded-control border border-line-strong bg-surface px-4 text-sm font-medium text-ink hover:border-accent hover:text-accent sm:self-auto">
          Add client
        </Link>
      </header>

      <PagesContent />
    </>
  );
}