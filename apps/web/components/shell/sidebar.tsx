import Link from 'next/link';

export function Brand() {
  return (
    <Link
      href="/pages"
      aria-label="SERP, Pages"
      className="inline-flex w-fit items-center gap-2.5 rounded-control text-ink hover:text-accent"
    >
      <span aria-hidden="true" className="grid size-7 place-items-center rounded-control bg-accent text-sm font-semibold text-white">
        S
      </span>
      <span className="text-lg font-semibold tracking-[-0.055em]">SERP</span>
    </Link>
  );
}

export function ShellNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main navigation">
      <p className="px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        Workspace
      </p>
      <div className="mt-3">
        <Link
          href="/pages"
          aria-current="page"
          onClick={onNavigate}
          className="flex min-h-10 items-center gap-3 rounded-control bg-accent-soft px-3 text-sm font-medium text-accent transition-colors duration-[var(--motion-fast)] hover:bg-[#dcebe1]"
        >
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
          Pages
        </Link>
      </div>
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface px-5 py-7 lg:flex">
      <div className="px-2">
        <Brand />
      </div>
      <div className="mt-14">
        <ShellNavigation />
      </div>
    </aside>
  );
}