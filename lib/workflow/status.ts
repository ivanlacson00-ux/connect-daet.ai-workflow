const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  pending: 'Submitted',
  pending_approver: 'Submitted',
  in_process: 'In Process',
  pending_office: 'In Process',
  pending_mayor: 'In Process',
  changes_requested: 'Closed — Changes Requested',
  returned_for_requirements: 'Closed — Changes Requested',
  returned: 'Returned',
  completed: 'Completed',
  approved: 'Approved',
  declined_by_office: 'Rejected',
  withdrawn: 'Withdrawn',
  closed_by_submitter: 'Permanently Closed by Submitter',
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
    case 'closed_by_submitter':
      return 'withdrawn';
    default:
      return 'legacy';
  }
}
