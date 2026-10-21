import type { ReactNode } from 'react';
import { MobileMenu } from './mobile-menu';
import { Sidebar } from './sidebar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[14.5rem_minmax(0,1fr)]">
      <a
        href="#main-content"
        className="sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:not-sr-only focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-accent"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="min-w-0">
        <MobileMenu />
        <main id="main-content" className="mx-auto w-full max-w-[var(--layout-max-width)] px-[var(--layout-gutter)] py-10 sm:py-12 lg:py-14">
          {children}
        </main>
      </div>
    </div>
  );
}