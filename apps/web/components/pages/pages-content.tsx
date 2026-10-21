'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../lib/api-client';
import {
  loadClients,
  loadPages,
  type ClientsResult,
  type PagesResult,
} from '../../lib/pages-data';
import { PagesTable } from './pages-table';

type ClientsState = ClientsResult | { kind: 'loading' };

function StatusPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="border-t border-line-strong py-10 text-sm text-ink-muted" role={onRetry ? 'alert' : 'status'}>
      <p>{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-control border border-line-strong bg-surface px-3.5 py-2 font-medium text-ink hover:border-accent hover:text-accent"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function PagesContent() {
  const router = useRouter();
  const searchInput = useRef<HTMLInputElement>(null);
  const pagesRequest = useRef<{ key: string; promise: Promise<PagesResult> } | null>(null);
  const clientsRequest = useRef<Promise<ClientsResult> | null>(null);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [clientId, setClientId] = useState('');
  const [page, setPage] = useState(1);
  const [pagesRetry, setPagesRetry] = useState(0);
  const [clientsRetry, setClientsRetry] = useState(0);
  const [pagesState, setPagesState] = useState<{ key: string; result: PagesResult } | null>(null);
  const [clientsState, setClientsState] = useState<ClientsState>({ kind: 'loading' });

  const searchPending = searchText.trim() !== debouncedSearch;
  const queryKey = JSON.stringify([debouncedSearch, clientId, page, pagesRetry]);

  useEffect(() => {
    if (!searchPending) return;
    const timer = window.setTimeout(() => setDebouncedSearch(searchText.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchPending, searchText]);

  useEffect(() => {
    let active = true;
    if (!clientsRequest.current) clientsRequest.current = loadClients(apiRequest);

    void clientsRequest.current.then((result) => {
      if (!active) return;
      setClientsState(result);
      if (result.kind === 'auth-expired') router.replace('/login');
    });

    return () => { active = false; };
  }, [clientsRetry, router]);

  useEffect(() => {
    if (searchPending) return;
    let active = true;
    if (pagesRequest.current?.key !== queryKey) {
      pagesRequest.current = {
        key: queryKey,
        promise: loadPages(apiRequest, {
          page,
          search: debouncedSearch || undefined,
          clientId: clientId || undefined,
        }),
      };
    }

    void pagesRequest.current.promise.then((result) => {
      if (!active) return;
      setPagesState({ key: queryKey, result });
      if (result.kind === 'auth-expired') router.replace('/login');
    });

    return () => { active = false; };
  }, [searchPending, queryKey, page, debouncedSearch, clientId, router]);

  function retryPages() {
    setPagesRetry((current) => current + 1);
  }

  function retryClients() {
    clientsRequest.current = null;
    setClientsState({ kind: 'loading' });
    setClientsRetry((current) => current + 1);
  }

  function clearSearch() {
    setSearchText('');
    setDebouncedSearch('');
    setPage(1);
    searchInput.current?.focus();
  }

  const currentResult = !searchPending && pagesState?.key === queryKey ? pagesState.result : null;
  const clients = clientsState.kind === 'success' ? clientsState.clients : [];
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const expired = clientsState.kind === 'auth-expired' || currentResult?.kind === 'auth-expired';

  let content;
  if (expired) {
    content = <StatusPanel message="Your session has expired. Opening sign in..." />;
  } else if (!currentResult || clientsState.kind === 'loading') {
    content = <StatusPanel message={searchPending ? 'Searching pages...'
      : clientsState.kind === 'loading' && currentResult ? 'Loading clients...' : 'Loading pages...'} />;
  } else if (currentResult.kind === 'network-error') {
    content = <StatusPanel message="Unable to reach the server. Check your connection and try again." onRetry={retryPages} />;
  } else if (currentResult.kind === 'server-error') {
    content = <StatusPanel message="Pages are temporarily unavailable. Please try again." onRetry={retryPages} />;
  } else if (currentResult.kind === 'invalid-response') {
    content = <StatusPanel message="Pages could not be displayed right now. Please try again." onRetry={retryPages} />;
  } else if (currentResult.kind === 'success' && currentResult.data.items.length === 0) {
    content = <StatusPanel message={debouncedSearch || clientId
      ? 'No pages match these filters.'
      : 'No pages yet. Pages will appear here after a client has been crawled.'} />;
  } else if (currentResult.kind === 'success') {
    const { items, pagination } = currentResult.data;
    const first = (pagination.page - 1) * pagination.pageSize + 1;
    const last = Math.min(pagination.page * pagination.pageSize, pagination.total);
    content = (
      <>
        <p className="mb-2.5 text-xs font-medium text-ink-faint">
          Showing {first}–{last} of {pagination.total} pages
        </p>
        <PagesTable pages={items} clientsById={clientsById} />
        <nav aria-label="Pages pagination" className="mt-5 flex flex-wrap items-center justify-end gap-3 text-sm">
          <button
            type="button"
            onClick={() => setPage((current) => current - 1)}
            disabled={pagination.page <= 1}
            aria-label="Previous page"
            className="rounded-control border border-line-strong bg-surface px-3 py-1.5 font-medium text-ink-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            Previous
          </button>
          <span className="min-w-20 text-center font-mono text-xs tabular-nums text-ink-muted">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => current + 1)}
            disabled={pagination.page >= pagination.totalPages}
            aria-label="Next page"
            className="rounded-control border border-line-strong bg-surface px-3 py-1.5 font-medium text-ink-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            Next
          </button>
        </nav>
      </>
    );
  }

  return (
    <section aria-label="Pages inventory" className="mt-7 sm:mt-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div className="min-w-0 flex-1">
          <label htmlFor="pages-search" className="mb-1.5 block text-xs font-medium text-ink-muted">
            Search pages
          </label>
          <div className="relative">
            <input
              ref={searchInput}
              id="pages-search"
              type="text"
              inputMode="search"
              maxLength={200}
              placeholder="URL or keyword"
              value={searchText}
              onChange={(event) => { setSearchText(event.target.value); setPage(1); }}
              className="h-10 w-full rounded-control border border-line-strong bg-surface px-3 pr-16 text-sm text-ink placeholder:text-ink-faint hover:border-ink-faint focus:border-accent"
            />
            {searchText && (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Clear search"
                className="absolute inset-y-1 right-1 rounded-control px-2 text-xs font-medium text-ink-muted hover:text-accent"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="w-full sm:w-60">
          <label htmlFor="pages-client" className="mb-1.5 block text-xs font-medium text-ink-muted">
            Client
          </label>
          <select
            id="pages-client"
            value={clientId}
            onChange={(event) => { setClientId(event.target.value); setPage(1); }}
            disabled={clientsState.kind !== 'success'}
            className="h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink hover:border-ink-faint focus:border-accent disabled:opacity-60"
          >
            <option value="">{clientsState.kind === 'loading' ? 'Loading clients...' : 'All clients'}</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name === client.normalizedDomain ? client.name : `${client.name} · ${client.normalizedDomain}`}
              </option>
            ))}
          </select>
        </div>
      </div>
      {clientsState.kind !== 'loading' && clientsState.kind !== 'success' && clientsState.kind !== 'auth-expired' && (
        <p role="alert" className="mb-5 text-xs text-ink-muted">
          Client names and filtering are unavailable.
          <button type="button" onClick={retryClients} className="ml-2 font-medium text-accent hover:text-accent-hover">
            Try again
          </button>
        </p>
      )}
      {content}
    </section>
  );
}