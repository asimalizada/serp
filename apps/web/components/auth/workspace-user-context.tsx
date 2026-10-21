'use client';

import { createContext, useContext } from 'react';
import type { AuthUser } from '../../lib/session-response';

export type WorkspaceUserContextValue = {
  user: AuthUser;
  updateUser: (user: AuthUser) => void;
};

export const WorkspaceUserContext = createContext<WorkspaceUserContextValue | null>(null);

export function useWorkspaceUser(): WorkspaceUserContextValue {
  const context = useContext(WorkspaceUserContext);
  if (!context) throw new Error('Workspace user is unavailable outside the authenticated workspace');
  return context;
}