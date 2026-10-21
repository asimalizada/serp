'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useWorkspaceUser } from '../auth/workspace-user-context';
import { apiRequest } from '../../lib/api-client';
import {
  changeClient, loadClientFailureDetails, loadManagedClients,
  type ClientAction, type ClientFailureDetails, type ClientView, type LoadClientsResult, type ManagedClient,
} from '../../lib/client-management';

const crawlLabels: Record<number, string> = {
  0: 'Queued', 1: 'Crawling', 2: 'Completed', 3: 'Failed',
};

function crawlDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: timezone }).format(new Date(value));
}

export function ClientsContent() {
  const router = useRouter();
  const { user } = useWorkspaceUser();
  const [view, setView] = useState<ClientView>('active');
  const [list, setList] = useState<LoadClientsResult | { kind: 'loading' }>({ kind: 'loading' });
  const [revision, setRevision] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const busy = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ClientFailureDetails | 'loading' | 'unavailable'>>({});

  useEffect(() => {
    let active = true;
    void loadManagedClients(apiRequest, view).then((result) => {
      if (!active) return;
      setList(result);
      if (result.kind === 'auth-expired') router.replace('/login');
    });
    return () => { active = false; };
  }, [view, revision, router]);

  useEffect(() => {
    if (view !== 'active' || list.kind !== 'success' ||
        !list.clients.some((client) => client.latestCrawl && client.latestCrawl.status <= 1)) return;
    const timer = window.setTimeout(() => setRevision((value) => value + 1), 5_000);
    return () => window.clearTimeout(timer);
  }, [view, list]);

  function selectView(next: ClientView) {
    if (next === view) return;
    setView(next);
    setList({ kind: 'loading' });
    setMessage(null);
    setDetails({});
  }

  async function act(client: ManagedClient, action: ClientAction) {
    if (busy.current) return;
    if (action === 'recrawl' && !window.confirm(`Start a new crawl for ${client.name}?`)) return;
    if (action === 'archive' && !window.confirm(`Archive ${client.name}? Its history will be preserved.`)) return;
    busy.current = true;
    setBusyId(client.id);
    setMessage(null);
    try {
      const result = await changeClient(apiRequest, client.id, action);
      if (result.kind === 'auth-expired') {
        router.replace('/login');
      } else if (result.kind === 'success') {
        setDetails({});
        setRevision((value) => value + 1);
      } else {
        const text = result.kind === 'conflict'
          ? action === 'recrawl' ? 'A crawl is already active, or this client is archived.' : 'Wait for the active crawl to finish before archiving.'
          : result.kind === 'not-found' ? 'This client is no longer available.'
          : result.kind === 'resubmit-required' ? 'Your session was renewed. Confirm the action again.'
          : 'We could not confirm the action. Refresh the list before trying again.';
        setMessage(text);
        setRevision((value) => value + 1);
      }
    } finally {
      busy.current = false;
      setBusyId(null);
    }
  }

  async function showFailures(clientId: string) {
    if (details[clientId]) {
      setDetails((current) => {
        const next = { ...current };
        delete next[clientId];
        return next;
      });
      return;
    }
    setDetails((current) => ({ ...current, [clientId]: 'loading' }));
    const result = await loadClientFailureDetails(apiRequest, clientId);
    if (result.kind === 'auth-expired') {
      router.replace('/login');
    } else {
      setDetails((current) => ({ ...current, [clientId]: result.kind === 'success' ? result.data : 'unavailable' }));
    }
  }

  return (
    <div>
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[clamp(2rem,2.8vw,2.5rem)] font-semibold leading-tight tracking-[-0.05em] text-ink">Clients</h1>
          <p className="mt-2 max-w-2xl text-[0.9375rem] leading-6 text-ink-muted">
            Manage websites, review crawl results, and keep historical analysis intact.
          </p>
        </div>
        <Link href="/clients/new" className="inline-flex h-10 shrink-0 items-center justify-center self-start rounded-control border border-line-strong bg-surface px-4 text-sm font-medium text-ink hover:border-accent hover:text-accent sm:self-auto">
          Add client
        </Link>
      </header>

      <div className="mt-8 flex gap-6 border-b border-line" role="group" aria-label="Client status">
        {(['active', 'archived'] as const).map((option) => (
          <button key={option} type="button" onClick={() => selectView(option)}
            aria-pressed={view === option}
            className={`border-b-2 pb-3 text-sm font-medium transition-[color,border-color] duration-[var(--motion-fast)] hover:text-accent ${view === option ? 'border-accent text-ink' : 'border-transparent text-ink-muted'}`}>
            {option === 'active' ? 'Active' : 'Archived'}
          </button>
        ))}
      </div>

      {message && <p role="alert" className="mt-5 text-sm leading-6 text-danger">{message}</p>}
      {list.kind === 'loading' ? (
        <p role="status" className="py-10 text-sm text-ink-muted">Loading clients…</p>
      ) : list.kind === 'unavailable' ? (
        <div role="alert" className="py-10 text-sm text-ink-muted">
          Clients could not be loaded.
          <button type="button" onClick={() => setRevision((value) => value + 1)} className="ml-2 font-medium text-accent hover:text-accent-hover">Try again</button>
        </div>
      ) : list.kind === 'auth-expired' ? (
        <p role="status" className="py-10 text-sm text-ink-muted">Your session has expired. Opening sign in…</p>
      ) : list.clients.length === 0 ? (
        <p className="py-10 text-sm text-ink-muted">{view === 'active' ? 'No active clients yet.' : 'No archived clients.'}</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.clients.map((client) => {
            const run = client.latestCrawl;
            const running = run && run.status <= 1;
            const detail = details[client.id];
            return (
              <li key={client.id} className="grid gap-4 py-5 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_auto] lg:items-start lg:gap-6">
                <div className="min-w-0">
                  <h2 className="break-words text-base font-medium leading-6 text-ink">{client.name}</h2>
                  <p className="mt-1 break-all text-sm leading-5 text-ink-muted">{client.websiteUrl}</p>
                  {run?.error && <p className="mt-2 text-sm leading-5 text-warning">{run.error}</p>}
                </div>
                <div className="text-sm">
                  <p className="font-medium text-ink">{view === 'archived' ? 'Archived' : run ? crawlLabels[run.status] : 'Not crawled'}</p>
                  {run && <p className="mt-1 text-xs text-ink-muted">{run.processedPages} processed · {run.failedPages} failed</p>}
                  {run && run.failedPages > 0 && (
                    <button type="button" onClick={() => { void showFailures(client.id); }}
                      className="mt-2 rounded-control text-xs font-medium text-accent hover:text-accent-hover">
                      {detail ? 'Hide failure details' : 'View failure details'}
                    </button>
                  )}
                </div>
                <div className="text-sm text-ink-muted">
                  <p><span className="font-mono tabular-nums text-ink">{client.pageCount}</span> pages discovered</p>
                  {run && <p className="mt-1 text-xs">Last crawl: {crawlDate(run.finishedAt ?? run.createdAt, user.timezone)}</p>}
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {view === 'active' ? (
                    <>
                      <button type="button" disabled={!!busyId || !!running} onClick={() => { void act(client, 'recrawl'); }}
                        className="rounded-control border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50">Recrawl</button>
                      <button type="button" disabled={!!busyId || !!running} onClick={() => { void act(client, 'archive'); }}
                        className="rounded-control px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50">Archive</button>
                    </>
                  ) : (
                    <button type="button" disabled={!!busyId} onClick={() => { void act(client, 'unarchive'); }}
                      className="rounded-control border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50">Restore</button>
                  )}
                </div>
                {detail && (
                  <div className="min-w-0 text-sm text-ink-muted lg:col-span-4">
                    {detail === 'loading' ? 'Loading failure details…' : detail === 'unavailable' ? 'Failure details are unavailable right now.' : (
                      detail.crawlRun?.pageFailures.length ? (
                        <ul className="space-y-2 border-l-2 border-line-strong pl-4">
                          {detail.crawlRun.pageFailures.map((failure, index) => (
                            <li key={`${failure.url}:${index}`}>
                              <span className="break-all text-ink">{failure.url}</span>
                              <span className="ml-2">{failure.reason ?? (failure.httpStatusCode ? `HTTP ${failure.httpStatusCode}` : 'Page processing failed.')}</span>
                            </li>
                          ))}
                        </ul>
                      ) : 'No page-level failures were recorded for this crawl.'
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}