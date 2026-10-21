'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../../lib/api-client';
import {
  createClient,
  loadCrawlStatus,
  validateClientWebsiteUrl,
  type CreatedClient,
  type CrawlStatusResult,
} from '../../lib/client-creation';

const crawlLabels: Record<number, string> = {
  0: 'Queued',
  1: 'Crawling',
  2: 'Completed',
  3: 'Failed',
};

export function AddClientForm() {
  const router = useRouter();
  const submitting = useRef(false);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [outcomeUncertain, setOutcomeUncertain] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedClient | null>(null);
  const [crawlStatus, setCrawlStatus] = useState<CrawlStatusResult | null>(null);
  const [statusRetry, setStatusRetry] = useState(0);

  useEffect(() => {
    if (!created) return;
    const clientId = created.client.id;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function checkStatus() {
      const result = await loadCrawlStatus(apiRequest, clientId);
      if (!active) return;
      setCrawlStatus(result);
      if (result.kind === 'auth-expired') {
        router.replace('/login');
        return;
      }
      if (result.kind === 'unavailable' ||
          (result.kind === 'success' && (!result.data.crawlRun || result.data.crawlRun.status <= 1))) {
        timer = setTimeout(() => { void checkStatus(); }, result.kind === 'unavailable' ? 10_000 : 5_000);
      }
    }

    void checkStatus();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [created, statusRetry, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || created || outcomeUncertain) return;
    setRequestError(null);
    const validationError = validateClientWebsiteUrl(websiteUrl);
    if (validationError) {
      setFieldError(validationError);
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);
    try {
      const result = await createClient(apiRequest, websiteUrl);
      switch (result.kind) {
        case 'success':
          setCreated(result.data);
          break;
        case 'duplicate':
          setFieldError('This website is already a client in your workspace.');
          break;
        case 'validation-error':
          setFieldError('This URL could not be accepted. Check that it points to a public HTTP or HTTPS website.');
          break;
        case 'auth-expired':
          router.replace('/login');
          break;
        case 'resubmit-required':
          setRequestError('Your session was renewed. Submit again to create this client.');
          break;
        case 'uncertain':
        case 'invalid-response':
          setOutcomeUncertain(true);
          setRequestError('We could not confirm whether this client was added. Check the client selector on Pages before submitting it again.');
          break;
      }
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  const run = crawlStatus?.kind === 'success' ? crawlStatus.data.crawlRun : null;
  const status = run?.status ?? created?.crawlRun.status;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link href="/pages" className="inline-flex rounded-control text-sm font-medium text-accent hover:text-accent-hover">
        ← Back to pages
      </Link>
      <header className="mt-7">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-ink-faint">Clients</p>
        <h1 className="text-[clamp(2rem,2.8vw,2.5rem)] font-semibold leading-tight tracking-[-0.05em] text-ink">Add client</h1>
        <p className="mt-2 max-w-xl text-[0.9375rem] leading-6 text-ink-muted">
          Add a website to discover its blog pages and begin SEO analysis.
        </p>
      </header>

      {created ? (
        <section aria-live="polite" className="mt-10 max-w-xl border-t border-line-strong pt-6">
          <h2 className="text-lg font-semibold tracking-[-0.03em] text-ink">Client added</h2>
          <dl className="mt-5 grid gap-y-4 text-sm sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-x-4">
            <dt className="text-ink-faint">Name</dt>
            <dd className="font-medium text-ink">{created.client.name}</dd>
            <dt className="text-ink-faint">Website</dt>
            <dd className="break-all text-ink">{created.client.websiteUrl}</dd>
            <dt className="text-ink-faint">Crawl</dt>
            <dd className="text-ink">
              {status === undefined ? 'Status unavailable' : crawlLabels[status]}
              {run && (run.processedPages > 0 || run.failedPages > 0) && (
                <span className="mt-1 block text-ink-muted">
                  {run.processedPages} processed · {run.failedPages} failed
                </span>
              )}
            </dd>
          </dl>
          {crawlStatus?.kind === 'unavailable' ? (
            <p role="status" className="mt-5 text-sm text-ink-muted">
              Crawl status is temporarily unavailable. It will be checked again.
              <button type="button" onClick={() => setStatusRetry((value) => value + 1)} className="ml-2 rounded-control font-medium text-accent hover:text-accent-hover">Check now</button>
            </p>
          ) : status === 3 ? (
            <p className="mt-5 text-sm leading-6 text-ink-muted">The crawl failed. Any pages processed successfully remain available on Pages.</p>
          ) : status === 2 ? (
            <p className="mt-5 text-sm leading-6 text-ink-muted">The crawl has finished. Ranking history is generated separately.</p>
          ) : (
            <p className="mt-5 text-sm leading-6 text-ink-muted">Crawling may take a few minutes. You can leave this page while it runs.</p>
          )}
          <Link href="/pages" className="mt-7 inline-flex rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-ink hover:border-accent hover:text-accent">
            View pages
          </Link>
        </section>
      ) : (
        <form onSubmit={submit} noValidate className="mt-10 max-w-[26rem] border-t border-line-strong pt-6">
          <label htmlFor="client-website-url" className="block text-sm font-medium text-ink">Website URL</label>
          <p id="client-url-help" className="mt-1 text-sm leading-6 text-ink-muted">Include http:// or https://. Use the website you want to crawl.</p>
          <input
            id="client-website-url"
            name="websiteUrl"
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://example.com"
            value={websiteUrl}
            onChange={(event) => { setWebsiteUrl(event.target.value); setFieldError(null); setRequestError(null); }}
            aria-describedby={`client-url-help${fieldError ? ' client-url-error' : ''}`}
            aria-invalid={!!fieldError}
            disabled={isSubmitting || outcomeUncertain}
            className="mt-2 h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint hover:border-ink-faint focus:border-accent disabled:opacity-60"
          />
          {fieldError && <p id="client-url-error" role="alert" className="mt-2 text-sm text-danger">{fieldError}</p>}
          {requestError && <p role="alert" className="mt-3 text-sm leading-6 text-danger">{requestError}</p>}
          {outcomeUncertain && <Link href="/pages" className="mt-2 inline-flex rounded-control text-sm font-medium text-accent hover:text-accent-hover">Go to Pages</Link>}
          <button
            type="submit"
            disabled={isSubmitting || outcomeUncertain}
            className="mt-6 inline-flex h-10 min-w-32 items-center justify-center rounded-control bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Adding client…' : 'Add client'}
          </button>
        </form>
      )}
    </div>
  );
}