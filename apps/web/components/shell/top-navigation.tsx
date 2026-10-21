'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { EyeMark } from '../brand/eye-mark';

export function TopNavigation({
  userEmail,
  onSignOut,
  isSigningOut,
  signOutError,
}: {
  userEmail: string;
  onSignOut: () => void;
  isSigningOut: boolean;
  signOutError: string | null;
}) {
  const pathname = usePathname();
  const pagesActive = pathname === '/pages' || pathname.startsWith('/pages/');
  const settingsActive = pathname === '/settings';
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto grid w-full max-w-[var(--layout-max-width)] grid-cols-[minmax(0,1fr)_auto] grid-rows-[3.5rem_2.75rem] items-center px-[var(--layout-gutter)] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:grid-rows-[4rem]">
        <Link
          href="/pages"
          aria-label="SERP, Pages"
          className="col-start-1 row-start-1 inline-flex w-fit items-center gap-1.5 rounded-control text-[1.3125rem] font-semibold tracking-[-0.075em] text-ink hover:text-accent-hover"
        >
          <span>SERP<span aria-hidden="true" className="text-accent">.</span></span>
          <EyeMark className="pointer-events-none h-6 w-[3.2rem] shrink-0" />
        </Link>
        <nav aria-label="Main navigation" className="col-span-2 row-start-2 flex h-full items-stretch justify-self-center sm:col-span-1 sm:col-start-2 sm:row-start-1">
          <Link
            href="/pages"
            aria-current={pagesActive ? 'page' : undefined}
            className={`inline-flex min-w-14 items-center justify-center border-b-2 pt-0.5 text-sm font-medium transition-[color,border-color] duration-[var(--motion-fast)] hover:text-accent-hover hover:border-accent-hover ${pagesActive ? 'border-accent text-ink' : 'border-transparent text-ink-muted'}`}
          >
            Pages
          </Link>
          <Link
            href="/settings"
            aria-current={settingsActive ? 'page' : undefined}
            className={`inline-flex min-w-18 items-center justify-center border-b-2 px-1 pt-0.5 text-sm font-medium transition-[color,border-color] duration-[var(--motion-fast)] hover:text-accent-hover hover:border-accent-hover ${settingsActive ? 'border-accent text-ink' : 'border-transparent text-ink-muted'}`}
          >
            Settings
          </Link>
        </nav>
        <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-self-end gap-1.5 sm:col-start-3 sm:gap-4">
          <span className="max-w-24 truncate text-xs text-ink-muted max-[359px]:max-w-16 sm:max-w-52 sm:text-sm" title={userEmail}>
            {userEmail}
          </span>
          <button
            type="button"
            onClick={onSignOut}
            disabled={isSigningOut}
            className="shrink-0 rounded-control px-1.5 py-2 text-xs font-medium text-ink-muted hover:text-accent-hover disabled:cursor-wait disabled:opacity-60 sm:px-2 sm:text-sm"
          >
            {isSigningOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      </div>
      {signOutError && (
        <p role="alert" className="mx-auto w-full max-w-[var(--layout-max-width)] px-[var(--layout-gutter)] pb-3 text-sm text-danger">
          {signOutError}
        </p>
      )}
    </header>
  );
}