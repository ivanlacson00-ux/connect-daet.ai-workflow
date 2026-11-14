export type WorkflowActor =
  | 'submitter'
  | 'responsible_office'
  | 'assigned_office'
  | 'system_admin';

export type WorkflowAction =
  | 'clarify'
  | 'revise_submission'
  | 'close_permanently'
  | 'withdraw_submission'
  | 'redirect'
  | 'receive'
  | 'request_changes'
  | 'return_to_submitter'
  | 'complete_submission'
  | 'approve'
  | 'reject'
  | 'complete_assignment'
  | 'return_assignment'
  | 'forward';

interface SubmissionActionState {
  status: string;
  reopen_count?: number | null;
  has_open_change_request?: boolean;
  change_request_repair_needed?: boolean;
}

interface AssignmentActionState {
  status: string;
}

const isChangesRequested = (status: string) =>
  status === 'changes_requested' || status === 'returned_for_requirements';

export function getAvailableActions(
  submission: SubmissionActionState,
  assignments: readonly AssignmentActionState[],
  actor: WorkflowActor,
): WorkflowAction[] {
  const status = submission.status.toLowerCase();
  const hasActiveAssignment = assignments.some(
    (assignment) => assignment.status === 'pending' || assignment.status === 'in_progress',
  );

  if (actor === 'system_admin') return [];

  if (actor === 'submitter') {
    if (isChangesRequested(status)) {
      const actions: WorkflowAction[] = ['clarify'];
      if (submission.has_open_change_request && !submission.change_request_repair_needed) {
        if ((submission.reopen_count ?? 0) === 0) actions.push('revise_submission');
        actions.push('close_permanently');
      }
      return actions;
    }
    if (status === 'submitted' || status === 'pending') return ['withdraw_submission'];
    if (status === 'returned') return ['redirect'];
    return [];
  }

  if (isChangesRequested(status)) return [];

  if (actor === 'responsible_office') {
    if (status === 'submitted' || status === 'pending_office') return ['receive'];
    if (status !== 'in_process' || hasActiveAssignment) {
      return status === 'in_process' ? ['return_to_submitter'] : [];
    }

    const actions: WorkflowAction[] = [
      'return_to_submitter',
      'complete_submission',
      'approve',
      'reject',
    ];
    if ((submission.reopen_count ?? 0) === 0) actions.push('request_changes');
    return actions;
  }

  if (status === 'in_process' && hasActiveAssignment) {
    return ['complete_assignment', 'return_assignment', 'forward'];
  }

  return [];
}
