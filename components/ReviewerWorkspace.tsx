'use client';

import { useEffect, useState } from 'react';
import OfficeDashboard from '@/components/OfficeDashboard';
import OfficeNotificationsPage from '@/components/OfficeNotificationsPage';
import WorkflowNotificationArchive from '@/components/WorkflowNotificationArchive';
import { useWorkflowRole } from '@/lib/workflow/role-context';
import { isOfficeRole, type OfficeRole } from '@/lib/workflow/offices';

type ReviewerWorkspaceView =
  | 'dashboard'
  | 'file-management'
  | 'notifications'
  | 'notification-archive';

export default function ReviewerWorkspace({ view }: { view: ReviewerWorkspaceView }) {
  const currentRole = useWorkflowRole();
  const [adminOfficeRole, setAdminOfficeRole] = useState<OfficeRole | null>(null);

  useEffect(() => {
    if (currentRole !== 'system_admin') return;
    const office = new URLSearchParams(window.location.search).get('office');
    setAdminOfficeRole(isOfficeRole(office) ? office : null);
  }, [currentRole]);

  const role = isOfficeRole(currentRole)
    ? currentRole
    : currentRole === 'system_admin'
      ? adminOfficeRole
      : null;

  if (!role) {
    return (
      <div className="w-full">
        <div
          role={currentRole ? 'alert' : 'status'}
          aria-busy={!currentRole}
          className="rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text"
        >
          {currentRole
            ? 'An office role is required to open this workspace.'
            : 'Loading your office workspace...'}
        </div>
      </div>
    );
  }

  if (view === 'dashboard') {
    return <OfficeDashboard role={role} view="dashboard" />;
  }
  if (view === 'file-management') {
    return <OfficeDashboard role={role} view="file-management" />;
  }
  if (view === 'notifications') {
    return <OfficeNotificationsPage role={role} />;
  }
  return <WorkflowNotificationArchive role={role} />;
}
