import type { OfficeRole } from './offices';

export type OfficeDashboardFilter =
  | 'all'
  | 'needs_action'
  | 'waiting_on_office'
  | 'changes_requested'
  | 'completed'
  | 'returned'
  | 'withdrawn'
  | 'processed';

export interface OfficeDashboardSubmission {
  status: string;
  selected_office_role: string | null;
  /** This office's own assignment on the submission, if it was asked by another office. */
  officeRecord: {
    status: string;
  } | null;
  /** The latest assignment this office gave to another office. */
  consultedRecord?: {
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
  // While another office holds an assignment from this office, the next move is theirs.
  const waitingOnOffice = ['in_process', 'pending_office'].includes(submission.status)
    && (submission.consultedRecord?.status === 'pending'
      || submission.consultedRecord?.status === 'in_progress');
  switch (filter) {
    case 'needs_action':
      return (isResponsibleOffice
        && !waitingOnOffice
        && ['submitted', 'in_process', 'pending_office', 'pending_mayor'].includes(submission.status))
        || (['in_process', 'pending_office'].includes(submission.status) && hasPendingAssignment);
    case 'waiting_on_office':
      return waitingOnOffice;
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
        || ['approved', 'completed', 'declined_by_office', 'returned', 'withdrawn'].includes(submission.status)
        || ['approved', 'completed', 'returned', 'withdrawn'].includes(submission.officeRecord?.status ?? '');
    default:
      return true;
  }
}
