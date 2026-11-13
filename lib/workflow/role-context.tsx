'use client';

import { createContext, useContext, type ReactNode } from 'react';

const WorkflowRoleContext = createContext<string | null>(null);

export function WorkflowRoleProvider({
  role,
  children,
}: {
  role: string | null;
  children: ReactNode;
}) {
  return (
    <WorkflowRoleContext.Provider value={role}>
      {children}
    </WorkflowRoleContext.Provider>
  );
}

export function useWorkflowRole() {
  return useContext(WorkflowRoleContext);
}
