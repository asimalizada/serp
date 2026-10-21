'use client';

import { rankHistoryQuerySchema } from '@serp/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../../lib/api-client';
import {
  loadPageDetail,
  loadRankHistory,
  type DetailResult,
  type HistoryResult,
  type PageDetail,
} from '../../lib/page-detail-data';
import { loadClients, type ClientsResult } from '../../lib/pages-data';
import { RankHistoryChart } from './rank-history-chart';

type DetailState = DetailResult | { kind: 'loading' };
type ClientsState = ClientsResult | { kind: 'loading' };
type DateRange = { from?: string; to?: string };

function Status({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role={onRetry ? 'alert' : 'status'} className="border-t border-line-strong py-10 text-sm text-ink-muted">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-4 rounded-control border border-line-strong bg-surface px-3.5 py-2 font-medium text-ink hover:border-accent hover:text-accent">
          Try again
        </button>
      )}
    </div>
  );
}

function utcTimestamp(value: string | null): string {
  return value ? `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Unavailable';
}

function AnalysisSummary({ current }: { current: PageDetail['current'] }) {
  if (!current) {
    return <Status message="No successful page analysis is available yet." />;
  }

  return (
    <div className="border-t border-line-strong pt-5">
      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">HTTP status</dt>
          <dd className="mt-1 font-mono text-sm tabular-nums text-ink">{current.httpStatusCode ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">Word count</dt>
          <dd className="mt-1 font-mono text-sm tabular-nums text-ink">{current.wordCount ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">Analyzed at</dt>
          <dd className="mt-1 font-mono text-xs text-ink">{utcTimestamp(current.processedAt)}</dd>
        </div>
        <div className="sm:col-span-3">
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">First H1</dt>
          <dd className="mt-1 text-sm leading-6 text-ink">{current.h1 || <span className="text-ink-faint">Unavailable</span>}</dd>
        </div>
        <div className="sm:col-span-3">
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">Meta description</dt>
          <dd className="mt-1 text-sm leading-6 text-ink">{current.metaDescription || <span className="text-ink-faint">Unavailable</span>}</dd>
        </div>
      </dl>
    </div>
  );
}

function KeywordsSection({ page }: { page: PageDetail }) {
  return (
    <section aria-labelledby="keywords-heading" className="mt-11">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id="keywords-heading" className="text-lg font-semibold tracking-[-0.03em] text-ink">Keywords</h2>
        <span className="font-mono text-xs tabular-nums text-ink-faint">{page.keywords.length}</span>
      </div>
      {page.keywords.length === 0 ? (
        <Status message={page.current ? 'No keywords were recorded for this analysis.' : 'Keyword analysis is unavailable.'} />
      ) : (
        <ul className="border-t border-line-strong">
          {page.keywords.map((keyword) => (
            <li key={keyword.pageKeywordId} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-5 border-b border-line py-3.5 sm:grid-cols-[minmax(0,1fr)_7rem_8rem] sm:gap-x-6">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-ink">{keyword.phrase}</p>
                {page.primaryKeyword?.pageKeywordId === keyword.pageKeywordId && (
                  <p className="mt-0.5 text-xs text-ink-faint">Primary keyword</p>
                )}
              </div>
              <div className="text-right sm:text-left">
                <p className="font-mono text-xs tabular-nums text-ink-muted">{keyword.relevanceScore.toFixed(4)}</p>
                <p className="text-[0.6875rem] text-ink-faint">Relevance</p>
              </div>
              <div className="col-span-2 flex items-baseline gap-2 sm:col-span-1 sm:block sm:text-right">
                <p className={keyword.latestRank ? 'font-mono text-base tabular-nums text-accent' : 'text-sm text-ink-faint'}>
                  {keyword.latestRank ? `#${keyword.latestRank.position}` : 'No rank'}
                </p>
                {keyword.latestRank && (
                  <p className="text-xs text-ink-faint">{keyword.latestRank.snapshotDate} UTC</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const severityLabel: Record<number, string> = { 1: 'Info', 2: 'Warning', 3: 'Critical' };

function IssuesSection({ page }: { page: PageDetail }) {
  return (
    <section aria-labelledby="issues-heading" className="mt-11">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id="issues-heading" className="text-lg font-semibold tracking-[-0.03em] text-ink">SEO issues</h2>
        <span className="font-mono text-xs tabular-nums text-ink-faint">{page.current ? page.issueCount : '—'}</span>
      </div>
      {!page.current ? (
        <Status message="SEO issue results are unavailable until a page analysis succeeds." />
      ) : page.issues.length === 0 ? (
        <Status message="No SEO issues were detected in the latest successful analysis." />
      ) : (
        <ul className="border-t border-line-strong">
          {page.issues.map((issue) => (
            <li key={issue.id} className="grid gap-1 border-b border-line py-3.5 sm:grid-cols-[minmax(0,1fr)_5rem] sm:gap-x-5">
              <div>
                <p className="text-sm font-medium text-ink">{issue.name}</p>
                <p className="mt-1 text-sm leading-6 text-ink-muted">{issue.details}</p>
              </div>
              <p className={`text-xs font-medium sm:text-right ${issue.severity === 3 ? 'text-danger' : issue.severity === 2 ? 'text-warning' : 'text-ink-faint'}`}>
                {severityLabel[issue.severity]}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function historyError(result: HistoryResult, retry: () => void) {
  if (result.kind === 'not-found') return <Status message="Ranking history for this keyword is unavailable." onRetry={retry} />;
  if (result.kind === 'network-error') return <Status message="Unable to reach the server for ranking history." onRetry={retry} />;
  if (result.kind === 'server-error') return <Status message="Ranking history is temporarily unavailable." onRetry={retry} />;
  if (result.kind === 'invalid-response') return <Status message="Ranking history could not be displayed right now." onRetry={retry} />;
  return <Status message="Your session has expired. Opening sign in..." />;
}

export function PageDetailContent({ pageId }: { pageId: string }) {
  const router = useRouter();
  const detailRequest = useRef<Promise<DetailResult> | null>(null);
  const clientsRequest = useRef<Promise<ClientsResult> | null>(null);
  const historyRequest = useRef<{ key: string; promise: Promise<HistoryResult> } | null>(null);
  const [detailState, setDetailState] = useState<DetailState>({ kind: 'loading' });
  const [clientsState, setClientsState] = useState<ClientsState>({ kind: 'loading' });
  const [historyState, setHistoryState] = useState<{ key: string; result: HistoryResult } | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const [clientsRetry, setClientsRetry] = useState(0);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [selectedKeywordId, setSelectedKeywordId] = useState('');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>({});
  const [dateError, setDateError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    detailRequest.current ??= loadPageDetail(apiRequest, pageId);
    void detailRequest.current.then((result) => {
      if (!active) return;
      setDetailState(result);
      if (result.kind === 'auth-expired') router.replace('/login');
    });
    return () => { active = false; };
  }, [pageId, detailRetry, router]);

  useEffect(() => {
    let active = true;
    clientsRequest.current ??= loadClients(apiRequest);
    void clientsRequest.current.then((result) => {
      if (!active) return;
      setClientsState(result);
      if (result.kind === 'auth-expired') router.replace('/login');
    });
    return () => { active = false; };
  }, [clientsRetry, router]);

  const page = detailState.kind === 'success' ? detailState.data : null;
  const pageKeywordId = selectedKeywordId || page?.primaryKeyword?.pageKeywordId || page?.keywords[0]?.pageKeywordId || '';
  const historyKey = JSON.stringify([pageId, pageKeywordId, dateRange.from, dateRange.to, historyRetry]);

  useEffect(() => {
    if (!pageKeywordId) return;
    let active = true;
    if (historyRequest.current?.key !== historyKey) {
      historyRequest.current = {
        key: historyKey,
        promise: loadRankHistory(apiRequest, pageId, {
          keywordId: pageKeywordId,
          from: dateRange.from,
          to: dateRange.to,
        }),
      };
    }
    void historyRequest.current.promise.then((result) => {
      if (!active) return;
      setHistoryState({ key: historyKey, result });
      if (result.kind === 'auth-expired') router.replace('/login');
    });
    return () => { active = false; };
  }, [pageId, pageKeywordId, dateRange.from, dateRange.to, historyKey, router]);

  function retryDetail() {
    detailRequest.current = null;
    setDetailState({ kind: 'loading' });
    setDetailRetry((current) => current + 1);
  }

  function retryClients() {
    clientsRequest.current = null;
    setClientsState({ kind: 'loading' });
    setClientsRetry((current) => current + 1);
  }

  function applyDateRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const from = fromInput.trim();
    const to = toInput.trim();
    if (!from && !to) {
      setDateRange({});
      setDateError(null);
      return;
    }
    const parsed = rankHistoryQuerySchema.safeParse({ keywordId: pageKeywordId, from, to });
    if (!from || !to || !parsed.success) {
      setDateError('Choose a valid start and end date.');
      return;
    }
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    if (days < 0) {
      setDateError('Start date must be on or before end date.');
      return;
    }
    if (days > 365) {
      setDateError('Choose a range of no more than 366 calendar days.');
      return;
    }
    setDateError(null);
    setDateRange({ from, to });
  }

  const client = clientsState.kind === 'success'
    ? clientsState.clients.find((item) => item.id === page?.clientId)
    : undefined;
  const currentHistory = historyState?.key === historyKey ? historyState.result : null;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Link href="/pages" className="inline-flex rounded-control text-sm font-medium text-accent hover:text-accent-hover">
        ← Back to pages
      </Link>

      {detailState.kind === 'loading' ? (
        <div className="mt-8"><Status message="Loading page details..." /></div>
      ) : detailState.kind === 'not-found' ? (
        <div className="mt-8"><Status message="Page not found." /></div>
      ) : detailState.kind === 'auth-expired' || clientsState.kind === 'auth-expired' ? (
        <div className="mt-8"><Status message="Your session has expired. Opening sign in..." /></div>
      ) : detailState.kind === 'network-error' ? (
        <div className="mt-8"><Status message="Unable to reach the server for this page." onRetry={retryDetail} /></div>
      ) : detailState.kind === 'server-error' ? (
        <div className="mt-8"><Status message="Page details are temporarily unavailable." onRetry={retryDetail} /></div>
      ) : detailState.kind === 'invalid-response' ? (
        <div className="mt-8"><Status message="Page details could not be displayed right now." onRetry={retryDetail} /></div>
      ) : page && (
        <>
          <header className="mt-7">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-ink-faint">Page analysis</p>
            <h1 className="max-w-4xl text-[clamp(1.75rem,2.6vw,2.375rem)] font-semibold leading-[1.2] tracking-[-0.045em] text-ink">
              {page.current?.title || <span className="text-ink-muted">{page.current ? 'Title unavailable' : 'Analysis unavailable'}</span>}
            </h1>
            <p className="mt-3 break-all text-sm leading-6 text-ink-muted">{page.url}</p>
            <div className="mt-4 flex flex-wrap items-baseline gap-x-2 text-sm text-ink-muted">
              <span className="text-ink-faint">Client</span>
              {client ? (
                <span>{client.name}{client.name !== client.normalizedDomain && <span className="text-ink-faint"> · {client.normalizedDomain}</span>}</span>
              ) : clientsState.kind === 'loading' ? (
                <span className="text-ink-faint">Loading...</span>
              ) : (
                <>
                  <span className="text-ink-faint">Unavailable</span>
                  {clientsState.kind !== 'success' && (
                    <button type="button" onClick={retryClients} className="rounded-control text-xs font-medium text-accent hover:text-accent-hover">Try again</button>
                  )}
                </>
              )}
            </div>
          </header>

          <section aria-labelledby="analysis-heading" className="mt-10">
            <h2 id="analysis-heading" className="mb-4 text-lg font-semibold tracking-[-0.03em] text-ink">Current analysis</h2>
            <AnalysisSummary current={page.current} />
          </section>

          <KeywordsSection page={page} />
          <IssuesSection page={page} />

          <section aria-labelledby="history-heading" className="mt-12">
            <h2 id="history-heading" className="text-lg font-semibold tracking-[-0.03em] text-ink">Rank history</h2>
            <p className="mt-1 text-sm text-ink-muted">Daily positions for a selected page keyword.</p>
            {!pageKeywordId ? (
              <div className="mt-5"><Status message="Rank history is unavailable until this page has a keyword." /></div>
            ) : (
              <>
                <div className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:items-end">
                  <div>
                    <label htmlFor="history-keyword" className="mb-1.5 block text-xs font-medium text-ink-muted">Keyword</label>
                    <select
                      id="history-keyword"
                      value={pageKeywordId}
                      onChange={(event) => { setSelectedKeywordId(event.target.value); setDateError(null); }}
                      className="h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink hover:border-ink-faint focus:border-accent"
                    >
                      {page.keywords.map((keyword) => (
                        <option key={keyword.pageKeywordId} value={keyword.pageKeywordId}>{keyword.phrase}</option>
                      ))}
                    </select>
                  </div>
                  <form onSubmit={applyDateRange} className="flex flex-wrap items-end gap-3">
                    <div className="min-w-32 flex-1">
                      <label htmlFor="history-from" className="mb-1.5 block text-xs font-medium text-ink-muted">From</label>
                      <input id="history-from" type="date" value={fromInput} onChange={(event) => setFromInput(event.target.value)} className="h-10 w-full rounded-control border border-line-strong bg-surface px-2.5 text-sm text-ink hover:border-ink-faint focus:border-accent" />
                    </div>
                    <div className="min-w-32 flex-1">
                      <label htmlFor="history-to" className="mb-1.5 block text-xs font-medium text-ink-muted">To</label>
                      <input id="history-to" type="date" value={toInput} onChange={(event) => setToInput(event.target.value)} className="h-10 w-full rounded-control border border-line-strong bg-surface px-2.5 text-sm text-ink hover:border-ink-faint focus:border-accent" />
                    </div>
                    <button type="submit" className="h-10 rounded-control bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover">Apply</button>
                    {(dateRange.from || fromInput || toInput) && (
                      <button type="button" onClick={() => { setFromInput(''); setToInput(''); setDateRange({}); setDateError(null); }} className="h-10 rounded-control px-2 text-sm font-medium text-ink-muted hover:text-accent">
                        Reset
                      </button>
                    )}
                  </form>
                </div>
                <p className="mt-2 text-xs text-ink-faint">Leave dates blank for the latest 30 days. Custom dates use your account timezone.</p>
                {dateError && <p role="alert" className="mt-2 text-sm text-danger">{dateError}</p>}
                <div className="mt-6">
                  {!currentHistory ? (
                    <Status message="Loading ranking history..." />
                  ) : currentHistory.kind !== 'success' ? (
                    historyError(currentHistory, () => setHistoryRetry((current) => current + 1))
                  ) : (
                    <div className="border-t border-line-strong pt-5">
                      <p className="mb-4 text-xs text-ink-muted">
                        {currentHistory.data.from} to {currentHistory.data.to} · {currentHistory.data.timezone}
                      </p>
                      {currentHistory.data.history.length === 0 ? (
                        <p className="py-6 text-sm text-ink-muted">No rank observations for this keyword and period.</p>
                      ) : (
                        <RankHistoryChart data={currentHistory.data} />
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}