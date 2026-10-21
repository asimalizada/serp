'use client';

import { useEffect, useRef } from 'react';
import { Brand, ShellNavigation } from './sidebar';

export function MobileMenu() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktop.matches && dialogRef.current?.open) dialogRef.current.close();
    };

    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  function closeMenu() {
    dialogRef.current?.close();
  }

  return (
    <>
      <header className="flex h-16 items-center justify-between border-b border-line bg-surface px-[var(--layout-gutter)] lg:hidden">
        <Brand />
        <button
          ref={triggerRef}
          type="button"
          aria-label="Open navigation"
          aria-haspopup="dialog"
          aria-controls="mobile-navigation"
          onClick={() => dialogRef.current?.showModal()}
          className="inline-flex min-h-10 items-center gap-2 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-subtle"
        >
          <span aria-hidden="true" className="flex w-3.5 flex-col gap-1">
            <span className="h-px w-full bg-current" />
            <span className="h-px w-full bg-current" />
          </span>
          Menu
        </button>
      </header>

      <dialog
        ref={dialogRef}
        id="mobile-navigation"
        aria-label="Navigation"
        onClose={() => triggerRef.current?.focus()}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeMenu();
        }}
        className="mobile-nav-dialog"
      >
        <div className="flex h-full flex-col bg-surface px-5 py-6">
          <div className="flex items-center justify-between px-2">
            <Brand />
            <button
              type="button"
              autoFocus
              onClick={closeMenu}
              className="min-h-10 rounded-control px-2 text-sm font-medium text-ink-muted hover:text-ink"
            >
              Close
            </button>
          </div>
          <div className="mt-14">
            <ShellNavigation onNavigate={closeMenu} />
          </div>
        </div>
      </dialog>
    </>
  );
}