import type { ReactNode } from 'react';
import { SessionBoundary } from '../../components/auth/session-boundary';

export default function LoginLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <SessionBoundary route="login">{children}</SessionBoundary>;
}