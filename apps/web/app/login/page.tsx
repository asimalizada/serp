import type { Metadata } from 'next';
import { SignInForm } from '../../components/auth/sign-in-form';
import { TrackingEyes } from '../../components/auth/tracking-eyes';

export const metadata: Metadata = {
  title: 'Sign in | SERP',
  description: 'Sign in to your SERP workspace.',
};

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-12 sm:px-8">
      <div className="w-full max-w-[26rem]">
        <div className="mb-11 flex items-center gap-2.5">
          <div className="text-[1.625rem] font-semibold leading-none tracking-[-0.075em] text-ink">
            SERP<span aria-hidden="true" className="text-accent">.</span>
          </div>
          <TrackingEyes />
        </div>

        <div className="mb-8">
          <h1 className="text-[1.875rem] font-semibold leading-[1.2] tracking-[-0.04em] text-ink">
            Welcome back
          </h1>
          <p className="mt-2.5 text-[0.9375rem] leading-6 text-ink-muted">
            Sign in to manage your pages and search visibility.
          </p>
        </div>

        <SignInForm />
      </div>
    </main>
  );
}