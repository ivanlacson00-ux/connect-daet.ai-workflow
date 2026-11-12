import type { OfficeRole } from './offices';

export type OfficeDashboardFilter =
  | 'all'
  | 'needs_action'
  | 'changes_requested'
  | 'completed'
  | 'returned'
  | 'withdrawn'
  | 'processed';

export interface OfficeDashboardSubmission {
  status: string;
  selected_office_role: string | null;
  officeRecord: {
    status: string;
  } | null;
}

export function matchesOfficeDashboardFilter(
  submission: OfficeDashboardSubmission,
  filter: OfficeDashboardFilter,
  role: OfficeRole,
) {
  const isResponsibleOffice = submission.selected_office_role === role;
  const hasPendingAssignment = submission.officeRecord?.status === 'pending'
    || submission.officeRecord?.status === 'in_progress';
  switch (filter) {
    case 'needs_action':
      return (isResponsibleOffice
        && ['submitted', 'in_process', 'pending_office', 'pending_mayor'].includes(submission.status))
        || (['in_process', 'pending_office'].includes(submission.status) && hasPendingAssignment);
    case 'changes_requested':
      return isResponsibleOffice && submission.status === 'changes_requested';
    case 'completed':
      return submission.status === 'completed' || submission.status === 'approved';
    case 'returned':
      return isResponsibleOffice && submission.status === 'returned';
    case 'withdrawn':
      return submission.status === 'withdrawn';
    case 'processed':
      // Waiting on the submitter is out of the office's queue, like completed work.
      return (isResponsibleOffice && submission.status === 'changes_requested')
        || ['approved', 'completed', 'returned', 'withdrawn'].includes(submission.officeRecord?.status ?? '');
    default:
      return true;
  }
}
