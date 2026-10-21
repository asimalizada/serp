import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pages | SERP',
};

export default function PagesPage() {
  return (
    <>
      <header className="border-b border-line pb-8">
        <p className="text-caption font-semibold uppercase tracking-[0.14em] text-ink-faint">Workspace</p>
        <h1 className="mt-3 text-page-title font-semibold leading-tight tracking-[-0.04em] text-ink">Pages</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
          Your tracked pages and their search visibility, in one place.
        </p>
      </header>

      <section aria-label="Tracked pages preview" className="mt-8 rounded-surface border border-line bg-surface p-6 sm:p-8">
        <p className="text-sm font-medium text-ink">Tracked pages</p>
        <p className="mt-1 text-sm leading-6 text-ink-muted">Your page data will appear here.</p>
      </section>
    </>
  );
}