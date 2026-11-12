const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  pending: 'Submitted',
  pending_approver: 'Submitted',
  in_process: 'In Process',
  pending_office: 'In Process',
  pending_mayor: 'In Process',
  changes_requested: 'Changes Requested',
  returned_for_requirements: 'Changes Requested',
  returned: 'Returned',
  completed: 'Completed',
  approved: 'Completed',
  withdrawn: 'Withdrawn',
};

export function getSubmissionStatusLabel(status: string | null | undefined) {
  const normalized = status?.toLowerCase() ?? '';
  return STATUS_LABELS[normalized] ?? (normalized.replaceAll('_', ' ') || 'Unknown');
}

export function getSubmissionStatusTone(status: string | null | undefined) {
  switch (status?.toLowerCase()) {
    case 'submitted':
    case 'pending':
    case 'pending_approver':
    case 'changes_requested':
    case 'returned_for_requirements':
      return 'pending';
    case 'in_process':
    case 'pending_office':
    case 'pending_mayor':
      return 'progress';
    case 'completed':
    case 'approved':
      return 'completed';
    case 'returned':
      return 'returned';
    case 'withdrawn':
      return 'withdrawn';
    default:
      return 'legacy';
  }
}
