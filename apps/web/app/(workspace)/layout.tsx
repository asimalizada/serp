import type { ReactNode } from 'react';
import { SessionBoundary } from '../../components/auth/session-boundary';

export default function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <SessionBoundary route="workspace">{children}</SessionBoundary>;
}