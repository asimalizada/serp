'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useWorkspaceUser } from '../auth/workspace-user-context';
import { apiRequest } from '../../lib/api-client';
import { timezoneDisplayName, timezoneValidationError, updateTimezone } from '../../lib/timezone-settings';

export function TimezoneSettings() {
  const router = useRouter();
  const { user, updateUser } = useWorkspaceUser();
  const saving = useRef(false);
  const [selectedTimezone, setSelectedTimezone] = useState(user.timezone);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [requestMessage, setRequestMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (typeof Intl.supportedValuesOf === 'function') {
        setSuggestions(Intl.supportedValuesOf('timeZone'));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || selectedTimezone === user.timezone) return;
    setRequestMessage(null);
    const validationError = timezoneValidationError(selectedTimezone);
    if (validationError) {
      setFieldError(validationError);
      return;
    }

    saving.current = true;
    setIsSaving(true);
    try {
      const result = await updateTimezone(apiRequest, selectedTimezone, user.id);
      switch (result.kind) {
        case 'success':
          updateUser(result.user);
          setRequestMessage({ kind: 'success', text: 'Timezone saved.' });
          break;
        case 'invalid-timezone':
          setFieldError('Choose a valid IANA timezone.');
          break;
        case 'auth-expired':
          router.replace('/login');
          break;
        case 'resubmit-required':
          setRequestMessage({ kind: 'error', text: 'Your session was renewed. Save again to update your timezone.' });
          break;
        case 'unavailable':
          setRequestMessage({ kind: 'error', text: 'The server could not save your timezone right now. Try again.' });
          break;
        case 'uncertain':
          setRequestMessage({ kind: 'error', text: 'We could not confirm whether the change was saved. Reload this page to check before saving again.' });
          break;
      }
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }

  const options = [...new Set([user.timezone, 'UTC', ...suggestions])];

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header>
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-ink-faint">Preferences</p>
        <h1 className="text-[clamp(2rem,2.8vw,2.5rem)] font-semibold leading-tight tracking-[-0.05em] text-ink">Settings</h1>
        <p className="mt-2 max-w-xl text-[0.9375rem] leading-6 text-ink-muted">
          Choose how dates are interpreted in your ranking history.
        </p>
      </header>

      <section aria-labelledby="timezone-heading" className="mt-10 max-w-xl border-t border-line-strong pt-6">
        <h2 id="timezone-heading" className="text-lg font-semibold tracking-[-0.03em] text-ink">Timezone</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          Saved preference: <span className="font-medium text-ink">{timezoneDisplayName(user.timezone)}</span>
          <span className="ml-1 font-mono text-xs text-ink-faint">({user.timezone})</span>
        </p>

        <form onSubmit={submit} noValidate className="mt-7 max-w-[26rem]">
          <label htmlFor="timezone" className="block text-sm font-medium text-ink">Preferred timezone</label>
          <p id="timezone-help" className="mt-1 text-sm leading-6 text-ink-muted">
            Search by city or region, or enter an IANA timezone such as America/Toronto.
          </p>
          <input
            id="timezone"
            name="timezone"
            type="text"
            list="timezone-options"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={selectedTimezone}
            onChange={(event) => { setSelectedTimezone(event.target.value); setFieldError(null); setRequestMessage(null); }}
            disabled={isSaving}
            aria-describedby={`timezone-help${fieldError ? ' timezone-error' : ''}`}
            aria-invalid={!!fieldError}
            className="mt-2 h-11 w-full rounded-control border border-line-strong bg-surface px-3 font-mono text-sm text-ink hover:border-ink-faint focus:border-accent disabled:opacity-60"
          />
          <datalist id="timezone-options">
            {options.map((timezone) => (
              <option key={timezone} value={timezone} label={timezoneDisplayName(timezone)} />
            ))}
          </datalist>
          {fieldError && <p id="timezone-error" role="alert" className="mt-2 text-sm text-danger">{fieldError}</p>}
          {requestMessage && (
            <p role={requestMessage.kind === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm leading-6 ${requestMessage.kind === 'error' ? 'text-danger' : 'text-success'}`}>
              {requestMessage.text}
            </p>
          )}
          <button
            type="submit"
            disabled={isSaving || selectedTimezone === user.timezone}
            className="mt-6 inline-flex h-10 min-w-36 items-center justify-center rounded-control bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isSaving ? 'Saving…' : 'Save timezone'}
          </button>
        </form>
        <p className="mt-7 text-xs leading-5 text-ink-faint">Rank snapshots remain stored in UTC. Date filters use your selected timezone.</p>
      </section>
    </div>
  );
}