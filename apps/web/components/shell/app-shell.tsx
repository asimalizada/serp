import type { ReactNode } from 'react';
import { TopNavigation } from './top-navigation';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:not-sr-only focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-accent"
      >
        Skip to content
      </a>
      <TopNavigation />
      <main id="main-content" className="mx-auto w-full max-w-[var(--layout-max-width)] px-[var(--layout-gutter)] pb-20 pt-9 sm:pt-11">
        {children}
      </main>
    </div>
  );
}