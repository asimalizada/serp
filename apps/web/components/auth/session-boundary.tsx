'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { apiRequest } from '../../lib/api-client';
import { resolveSession, type SessionCheck } from '../../lib/session-response';
import { AppShell } from '../shell/app-shell';

type RouteKind = 'login' | 'workspace';
type SessionState = SessionCheck | { kind: 'checking' };

async function checkSession(): Promise<SessionCheck> {
  try {
    return await resolveSession(await apiRequest('/auth/me'));
  } catch {
    return { kind: 'unavailable', reason: 'server' };
  }
}

function SessionMessage({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="w-full max-w-[26rem] text-center">
        <p role={onRetry ? 'alert' : 'status'} className="text-sm leading-6 text-ink-muted">
          {message}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-ink hover:border-accent hover:text-accent"
          >
            Try again
          </button>
        )}
      </div>
    </main>
  );
}

export function SessionBoundary({
  children,
  route,
}: {
  children: ReactNode;
  route: RouteKind;
}) {
  const router = useRouter();
  const [session, setSession] = useState<SessionState>({ kind: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const checkInFlight = useRef<Promise<SessionCheck> | null>(null);
  const signOutInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    checkInFlight.current ??= checkSession();

    void checkInFlight.current.then((result) => {
      if (!active) return;
      setSession(result);
      if (route === 'workspace' && result.kind === 'unauthenticated') {
        router.replace('/login');
      } else if (route === 'login' && result.kind === 'authenticated') {
        router.replace('/pages');
      }
    });

    return () => { active = false; };
  }, [attempt, route, router]);

  function retryCheck() {
    checkInFlight.current = null;
    setSession({ kind: 'checking' });
    setAttempt((current) => current + 1);
  }

  async function signOut() {
    if (signOutInFlight.current) return;
    signOutInFlight.current = true;
    setIsSigningOut(true);
    setSignOutError(null);
    let signedOut = false;

    try {
      const result = await apiRequest('/auth/logout', { method: 'POST' });
      if (result.kind === 'response' && result.response.ok) {
        signedOut = true;
        setSession({ kind: 'unauthenticated' });
        router.replace('/login');
        return;
      }
      setSignOutError(result.kind === 'network-error'
        ? 'Unable to reach the server. Your session may still be active.'
        : 'Sign out could not be completed. Please try again.');
    } catch {
      setSignOutError('Sign out could not be completed. Please try again.');
    } finally {
      if (!signedOut) {
        signOutInFlight.current = false;
        setIsSigningOut(false);
      }
    }
  }

  if (session.kind === 'unavailable') {
    return (
      <SessionMessage
        message={session.reason === 'network'
          ? 'Unable to reach the server. Your session has not been changed.'
          : 'Unable to verify your session right now.'}
        onRetry={retryCheck}
      />
    );
  }

  if (route === 'workspace' && session.kind === 'authenticated') {
    return (
      <AppShell
        userEmail={session.user.email}
        onSignOut={signOut}
        isSigningOut={isSigningOut}
        signOutError={signOutError}
      >
        {children}
      </AppShell>
    );
  }

  if (route === 'login' && session.kind === 'unauthenticated') return <>{children}</>;

  return (
    <SessionMessage
      message={session.kind === 'checking' ? 'Checking your session…'
        : route === 'workspace' ? 'Opening sign in…' : 'Opening your workspace…'}
    />
  );
}