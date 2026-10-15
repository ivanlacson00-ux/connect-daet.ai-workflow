export type WorkflowTimingStatus = 'on-time' | 'due-soon' | 'overdue' | 'not-applicable';

export interface WorkflowTimingRecord {
  status: string;
  current_stage_due_at?: string | null;
  current_responsible_role?: string | null;
}

export function getWorkflowTiming(record: WorkflowTimingRecord, now = new Date()) {
  if (!record.current_stage_due_at || !['pending', 'pending_approver', 'pending_admin', 'approved'].includes(record.status)) {
    return { state: 'not-applicable' as const, label: 'No Pending Deadline', responsible: null };
  }

  const dueAt = new Date(record.current_stage_due_at);
  const remainingMs = dueAt.getTime() - now.getTime();
  const dueSoon = remainingMs > 0 && remainingMs <= 24 * 60 * 60 * 1000;
  const state: WorkflowTimingStatus = remainingMs <= 0 ? 'overdue' : dueSoon ? 'due-soon' : 'on-time';
  const label = state === 'overdue' ? 'Overdue' : state === 'due-soon' ? 'Due Soon' : 'On Time';
  const responsible = record.current_responsible_role === 'approver' ? 'Approver Team' : 'Administrator';

  return { state, label, responsible, dueAt };
}

export function workflowTimingClasses(state: WorkflowTimingStatus) {
  switch (state) {
    case 'overdue':
      return 'border-red-700 bg-red-50 text-red-700';
    case 'due-soon':
      return 'border-amber-700 bg-amber-50 text-amber-700';
    case 'on-time':
      return 'border-green-700 bg-green-50 text-green-700';
    default:
      return 'border-gray-400 bg-gray-50 text-gray-500';
  }
}
