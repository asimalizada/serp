'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../lib/api-client';
import { loadPages, type PagesResult } from '../../lib/pages-data';
import { PagesTable } from './pages-table';

type ViewState = PagesResult | { kind: 'loading' };

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
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const requestInFlight = useRef<Promise<PagesResult> | null>(null);

  useEffect(() => {
    let active = true;
    requestInFlight.current ??= loadPages(apiRequest);

    void requestInFlight.current.then((result) => {
      if (!active) return;
      setState(result);
      if (result.kind === 'auth-expired') router.replace('/login');
    });

    return () => { active = false; };
  }, [attempt, router]);

  function retry() {
    requestInFlight.current = null;
    setState({ kind: 'loading' });
    setAttempt((current) => current + 1);
  }

  let content;
  if (state.kind === 'loading') {
    content = <StatusPanel message="Loading pages..." />;
  } else if (state.kind === 'auth-expired') {
    content = <StatusPanel message="Your session has expired. Opening sign in..." />;
  } else if (state.kind === 'network-error') {
    content = <StatusPanel message="Unable to reach the server. Check your connection and try again." onRetry={retry} />;
  } else if (state.kind === 'server-error') {
    content = <StatusPanel message="Pages are temporarily unavailable. Please try again." onRetry={retry} />;
  } else if (state.kind === 'invalid-response') {
    content = <StatusPanel message="Pages could not be displayed right now. Please try again." onRetry={retry} />;
  } else if (state.data.items.length === 0) {
    content = <StatusPanel message="No pages yet. Pages will appear here after a client has been crawled." />;
  } else {
    content = <PagesTable pages={state.data.items} />;
  }

  return (
    <section aria-label="Pages inventory" className="mt-7 sm:mt-8">
      {state.kind === 'success' && state.data.items.length > 0 && (
        <p className="mb-2.5 text-xs font-medium text-ink-faint">
          Showing {state.data.items.length} of {state.data.pagination.total} pages
        </p>
      )}
      {content}
    </section>
  );
}
