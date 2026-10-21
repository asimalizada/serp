// Displayed fields are a subset of the backend GET /pages item contract.
export type PageListRow = {
  id: string;
  clientId: string;
  url: string;
  current: { title: string | null } | null;
  keywords: ReadonlyArray<{ phrase: string; relevanceScore: number }>;
  issueCount: number;
  latestRank: { position: number } | null;
};

function clientDomain(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

function PageIdentity({ page }: { page: PageListRow }) {
  const title = page.current?.title;
  const fallback = page.current ? 'Title unavailable' : 'Analysis unavailable';

  return (
    <div className="min-w-0">
      <p
        title={title ?? undefined}
        className="line-clamp-2 text-[0.9375rem] font-medium leading-[1.5] tracking-[-0.01em] text-ink"
      >
        {title || <span className="font-medium text-ink-muted">{fallback}</span>}
      </p>
      <p title={page.url} className="mt-1.5 truncate text-[0.8125rem] leading-5 text-ink-faint">
        {page.url}
      </p>
    </div>
  );
}

function KeywordSummary({ keywords }: { keywords: PageListRow['keywords'] }) {
  if (keywords.length === 0) {
    return <span className="text-sm text-ink-faint">No keywords yet</span>;
  }

  return (
    <div className="min-w-0">
      <p title={keywords[0].phrase} className="truncate text-sm font-medium text-ink-muted">
        {keywords[0].phrase}
      </p>
      {keywords.length > 1 && (
        <p className="mt-1 text-xs text-ink-faint">+{keywords.length - 1} more</p>
      )}
    </div>
  );
}

function RankValue({ rank }: { rank: PageListRow['latestRank'] }) {
  return rank ? (
    <span className="font-mono text-lg font-medium tabular-nums tracking-[-0.04em] text-accent">
      {rank.position}
    </span>
  ) : (
    <span title="No ranking data" className="font-mono text-lg text-ink-faint">
      <span aria-hidden="true">—</span>
      <span className="sr-only">No ranking data</span>
    </span>
  );
}

function IssueCount({ count, showLabel = false }: { count: number; showLabel?: boolean }) {
  return (
    <span className={count > 0 ? 'text-warning' : 'text-ink-faint'}>
      <span className="font-mono text-[0.9375rem] font-medium tabular-nums">{count}</span>
      {showLabel && <span className="ml-1.5 text-xs">{count === 1 ? 'issue' : 'issues'}</span>}
    </span>
  );
}

export function PagesTable({ pages }: { pages: readonly PageListRow[] }) {
  return (
    <>
      <div className="hidden lg:block">
        <table className="w-full table-fixed border-collapse border-t border-line-strong text-left">
          <caption className="sr-only">Sample pages, client domains, keywords, SEO issues, and latest ranking positions</caption>
          <colgroup>
            <col style={{ width: '44%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '23%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '8%' }} />
          </colgroup>
          <thead className="border-b border-line text-xs font-medium uppercase tracking-[0.09em] text-ink-muted">
            <tr>
              <th scope="col" className="py-3 pr-6 font-medium">Page</th>
              <th scope="col" className="px-3 py-3 font-medium">Client</th>
              <th scope="col" className="px-3 py-3 font-medium">Keywords</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Issues</th>
              <th scope="col" className="py-3 pl-3 text-right font-medium">Rank</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((page) => (
              <tr
                key={page.id}
                className="border-b border-line transition-colors duration-[var(--motion-fast)] hover:bg-surface-subtle"
              >
                <td className="py-[1.125rem] pr-6 align-top"><PageIdentity page={page} /></td>
                <td className="px-3 py-[1.125rem] align-top">
                  <span title={clientDomain(page.url)} className="block truncate pt-0.5 text-sm text-ink-muted">
                    {clientDomain(page.url)}
                  </span>
                </td>
                <td className="px-3 py-[1.125rem] align-top"><KeywordSummary keywords={page.keywords} /></td>
                <td className="px-3 py-[1.125rem] text-right align-top"><IssueCount count={page.issueCount} /></td>
                <td className="py-[0.875rem] pl-3 text-right align-top"><RankValue rank={page.latestRank} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="border-t border-line-strong lg:hidden" aria-label="Sample tracked pages">
        {pages.map((page) => (
          <li
            key={page.id}
            className="border-b border-line py-[1.125rem] transition-colors duration-[var(--motion-fast)] hover:bg-surface-subtle"
          >
            <div className="flex min-w-0 items-start gap-5">
              <div className="min-w-0 flex-1"><PageIdentity page={page} /></div>
              <div className="min-w-10 shrink-0 text-right">
                <p className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">Rank</p>
                <p className="mt-0.5"><RankValue rank={page.latestRank} /></p>
              </div>
            </div>
            <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1.5">
              <p title={clientDomain(page.url)} className="min-w-0 truncate text-sm text-ink-muted">
                {clientDomain(page.url)}
              </p>
              <p className="text-right"><IssueCount count={page.issueCount} showLabel /></p>
              <div className="col-span-2 min-w-0 text-sm"><KeywordSummary keywords={page.keywords} /></div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}