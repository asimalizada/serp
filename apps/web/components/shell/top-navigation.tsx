'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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
      <div className="mx-auto flex h-16 w-full max-w-[var(--layout-max-width)] items-stretch gap-4 px-[var(--layout-gutter)] max-[350px]:h-auto max-[350px]:flex-wrap max-[350px]:gap-y-0 sm:gap-10">
        <Link
          href="/pages"
          aria-label="SERP, Pages"
          className="inline-flex shrink-0 items-center rounded-control text-[1.3125rem] font-semibold tracking-[-0.075em] text-ink hover:text-accent-hover max-[350px]:h-16"
        >
          SERP<span aria-hidden="true" className="text-accent">.</span>
        </Link>
        <nav aria-label="Main navigation" className="flex items-stretch max-[350px]:h-16">
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
        <div className="ml-auto flex min-w-0 items-center gap-1.5 max-[350px]:ml-0 max-[350px]:h-10 max-[350px]:w-full max-[350px]:justify-end max-[350px]:border-t max-[350px]:border-line sm:gap-4">
          <span className="max-w-24 truncate text-xs text-ink-muted max-[350px]:max-w-44 sm:max-w-52 sm:text-sm" title={userEmail}>
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