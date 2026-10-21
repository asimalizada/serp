import Link from 'next/link';

export function TopNavigation() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-16 w-full max-w-[var(--layout-max-width)] items-stretch gap-7 px-[var(--layout-gutter)] sm:gap-10">
        <Link
          href="/pages"
          aria-label="SERP, Pages"
          className="inline-flex shrink-0 items-center rounded-control text-[1.3125rem] font-semibold tracking-[-0.075em] text-ink hover:text-accent-hover"
        >
          SERP<span aria-hidden="true" className="text-accent">.</span>
        </Link>
        <nav aria-label="Main navigation" className="flex items-stretch">
          <Link
            href="/pages"
            aria-current="page"
            className="inline-flex min-w-14 items-center justify-center border-b-2 border-accent pt-0.5 text-sm font-medium text-ink transition-[color,border-color] duration-[var(--motion-fast)] hover:text-accent-hover hover:border-accent-hover"
          >
            Pages
          </Link>
        </nav>
      </div>
    </header>
  );
}