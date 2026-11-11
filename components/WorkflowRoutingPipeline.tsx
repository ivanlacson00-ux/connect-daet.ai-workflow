import {
  OFFICE_CONFIG,
  OFFICE_RESPONSIBILITIES,
  TOURISM_OFFICE_LABEL,
  TOURISM_OFFICE_ROLE,
  isOfficeRole,
  type OfficeRole,
  type OfficeResponsibility,
} from '@/lib/workflow/offices';

type PipelineState = 'complete' | 'active' | 'pending' | 'rejected' | 'skipped';

interface PipelineRouteStep {
  sequence_number: number;
  office_role: string;
  status: string;
  responsibility?: OfficeResponsibility | string;
  assignment_source?: string;
  started_at?: string | null;
  decided_at?: string | null;
  requirements_requested_at?: string | null;
}

interface PipelineAuditEvent {
  action_type: string;
  created_at: string;
}

interface WorkflowRoutingPipelineProps {
  submissionStatus: string;
  submittedAt: string;
  routeSteps: PipelineRouteStep[];
  routeStatus: string | null;
  routeFinalizedAt?: string | null;
  selectedOfficeRole?: string | null;
  initialDestinationRole?: string | null;
  finalDecisionOfficeRole?: string | null;
  auditEvents: PipelineAuditEvent[];
  routeLoadFailed?: boolean;
  variant?: 'full' | 'compact';
}

interface PipelineStep {
  key: string;
  title: string;
  subtitle: string;
  state: PipelineState;
  officeRole?: OfficeRole;
  detail?: string;
  timestamp?: string | null;
}

const formatTimestamp = (timestamp?: string | null) => {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const isDeclined = (status: string) =>
  status.startsWith('declined') || status === 'rejected';

const getSubmissionStatusLabel = (status: string) => {
  if (status === 'returned_for_requirements') return 'Waiting for submitter';
  if (status === 'completed') return 'Completed';
  if (isDeclined(status)) return 'Declined';
  return null;
};

export default function WorkflowRoutingPipeline({
  submissionStatus,
  submittedAt,
  routeSteps,
  routeStatus,
  routeFinalizedAt,
  selectedOfficeRole,
  initialDestinationRole,
  finalDecisionOfficeRole,
  auditEvents,
  routeLoadFailed = false,
  variant = 'full',
}: WorkflowRoutingPipelineProps) {
  const status = submissionStatus.toLowerCase();
  const sortedEvents = [...auditEvents].sort(
    (first, second) =>
      new Date(first.created_at).getTime() - new Date(second.created_at).getTime()
  );
  const eventTime = (...actionTypes: string[]) =>
    sortedEvents.find((event) => actionTypes.includes(event.action_type))?.created_at;
  const initialRoleValue = initialDestinationRole ?? selectedOfficeRole ?? null;
  const initialOfficeRole = isOfficeRole(initialRoleValue) ? initialRoleValue : null;
  const tourismOfficeWasSelected = initialDestinationRole === TOURISM_OFFICE_ROLE;
  const finalRoleValue = finalDecisionOfficeRole ?? null;
  const finalOfficeRole = isOfficeRole(finalRoleValue)
    ? finalRoleValue
    : initialOfficeRole;
  const tourismForwarded = sortedEvents.some(
    (event) => event.action_type === 'OFFICE_FORWARDED_TO_TOURISM_OFFICER'
  );
  const declined = isDeclined(status);
  const routeForDisplay: PipelineRouteStep[] = routeStatus === 'finalized' && routeSteps.length
    ? [...routeSteps].sort(
        (first, second) =>
          first.sequence_number - second.sequence_number
          || first.office_role.localeCompare(second.office_role)
      )
    : [];
  const tourismInvolved =
    tourismOfficeWasSelected
    || tourismForwarded
    || (status === 'pending_approver' && Boolean(initialOfficeRole))
    || routeForDisplay.some((step) => step.assignment_source === 'tourism_officer');
  const mayorInvolved =
    initialOfficeRole !== 'mayor_office'
    && (
      status === 'pending_mayor'
      || status === 'declined_by_mayor'
      || status === 'returned_for_requirements' && selectedOfficeRole === 'mayor_office'
      || sortedEvents.some((event) =>
        ['MAYOR_APPROVED', 'MAYOR_REJECTED'].includes(event.action_type)
      )
    );
  const legacyAdminReview =
    status === 'pending_admin' || routeStatus === 'proposed';

  const pipelineSteps: PipelineStep[] = [
    {
      key: 'submission',
      title: 'Submission',
      subtitle: 'Document received',
      state: 'complete',
      detail: 'Received',
      timestamp: submittedAt,
    },
  ];

  if (initialOfficeRole) {
    const initialOfficeIsFinal = finalOfficeRole === initialOfficeRole;
    const initialOfficeRejected =
      status === 'declined_by_office'
      || (status === 'declined_by_mayor' && initialOfficeRole === 'mayor_office');
    const initialOfficeIsActive =
      (status === 'returned_for_requirements' || status === 'pending_office')
        && selectedOfficeRole === initialOfficeRole
      || status === 'pending_mayor' && initialOfficeRole === 'mayor_office';
    const initialOfficeCompleted =
      status === 'completed'
      || tourismInvolved
      || routeForDisplay.length > 0
      || status === 'pending_mayor' && initialOfficeRole !== 'mayor_office'
      || status === 'pending_admin';
    const initialOfficeDetail = status === 'returned_for_requirements' && initialOfficeIsActive
      ? 'Waiting for submitter'
      : status === 'completed' && initialOfficeIsFinal
        ? 'Final decision recorded'
        : initialOfficeRejected
          ? 'Declined'
          : tourismForwarded || status === 'pending_approver' && Boolean(initialOfficeRole)
            ? 'Forwarded to Tourism Office'
            : initialOfficeIsActive && initialOfficeIsFinal
              ? 'Reviewing for final decision'
              : initialOfficeIsActive
                ? 'Reviewing submission'
                : initialOfficeCompleted
                  ? 'Review completed'
                  : 'Directly routed by submitter';
    pipelineSteps.push({
      key: 'initial-destination',
      title: 'Selected office',
      subtitle: OFFICE_CONFIG[initialOfficeRole].label,
      officeRole: initialOfficeRole,
      state: initialOfficeRejected
        ? 'rejected'
        : initialOfficeCompleted
          ? 'complete'
          : initialOfficeIsActive
            ? 'active'
            : 'pending',
      detail: initialOfficeDetail,
      timestamp: eventTime(
        'OFFICE_FINAL_DECISION',
        'MAYOR_APPROVED',
        'MAYOR_REJECTED',
        'SUBMITTED',
        'OFFICE_ROUTE_STEP_ASSIGNED'
      ),
    });
  } else if (tourismOfficeWasSelected) {
    const tourismReviewPending = status === 'pending' || status === 'pending_approver';
    pipelineSteps.push({
      key: 'initial-destination-tourism',
      title: 'Selected destination',
      subtitle: TOURISM_OFFICE_LABEL,
      state: declined && status === 'declined_by_approver'
        ? 'rejected'
        : tourismReviewPending
          ? 'active'
          : 'complete',
      detail: tourismReviewPending
        ? 'Tourism Office reviewing the request'
        : status === 'completed'
          ? 'Tourism Office approved and completed the request'
          : declined
            ? 'Declined'
            : routeForDisplay.length > 0
              ? 'Forwarded to assigned municipal offices'
              : 'Tourism Office review completed',
      timestamp: eventTime(
        'SUBMISSION_ROUTED_TO_TOURISM_OFFICER',
        'TOURISM_OFFICER_ASSIGNMENTS_CREATED',
        'TOURISM_OFFICE_APPROVED',
        'WORKFLOW_COMPLETED'
      ),
    });
  }

  if (!tourismOfficeWasSelected) {
    if (tourismInvolved) {
      pipelineSteps.push({
        key: 'tourism-officer',
        title: 'Tourism Office',
        subtitle: 'Review and routing',
        state: status === 'pending_approver'
          ? 'active'
          : status === 'declined_by_approver'
            ? 'rejected'
            : 'complete',
        detail: status === 'pending_approver'
          ? 'Reviewing forwarded submission'
          : status === 'declined_by_approver'
            ? 'Declined'
            : 'Reviewed and routed',
        timestamp: eventTime(
          'OFFICE_FORWARDED_TO_TOURISM_OFFICER',
          'TOURISM_OFFICER_ASSIGNMENTS_CREATED',
          'TOURISM_OFFICER_ASSIGNMENTS_COMPLETED'
        ),
      });
    }
  }

  for (const step of routeForDisplay) {
    if (!isOfficeRole(step.office_role)) continue;
    const stepIsActive = step.status === 'in_progress';
    const stepIsRejected = step.status === 'rejected';
    const waitingOnSubmitter =
      status === 'returned_for_requirements'
      && stepIsActive
      && !!step.requirements_requested_at;
    const isFinalOffice = finalOfficeRole === step.office_role;
    const finalDecisionActive = isFinalOffice
      && status === 'pending_office'
      && selectedOfficeRole === step.office_role
      && step.status === 'approved';
    const responsibility = step.responsibility
      && step.responsibility in OFFICE_RESPONSIBILITIES
      ? OFFICE_RESPONSIBILITIES[step.responsibility as OfficeResponsibility]
      : 'Office assignment';

    pipelineSteps.push({
      key: `office-${step.sequence_number}-${step.office_role}`,
      title: OFFICE_CONFIG[step.office_role].label,
      subtitle: responsibility,
      officeRole: step.office_role,
      state: status === 'completed' && isFinalOffice
        ? 'complete'
        : stepIsRejected
          ? 'rejected'
          : finalDecisionActive || stepIsActive
            ? 'active'
            : step.status === 'approved'
              ? 'complete'
              : 'pending',
      detail: waitingOnSubmitter
        ? 'Waiting for submitter'
        : status === 'completed' && isFinalOffice
          ? 'Final decision recorded'
          : finalDecisionActive
            ? 'Final decision in progress'
            : step.status === 'approved'
              ? 'Assignment complete'
              : stepIsRejected
                ? 'Declined'
                : stepIsActive
                  ? 'Under review'
                  : 'Awaiting review',
      timestamp: step.decided_at ?? step.started_at,
    });
  }

  if (mayorInvolved && !routeForDisplay.some((step) => step.office_role === 'mayor_office')) {
    pipelineSteps.push({
      key: 'mayor-office-review',
      title: OFFICE_CONFIG.mayor_office.label,
      subtitle: 'Final review',
      officeRole: 'mayor_office',
      state: status === 'pending_mayor'
        ? 'active'
        : status === 'declined_by_mayor'
          ? 'rejected'
          : 'complete',
      detail: status === 'pending_mayor'
        ? 'Final decision in progress'
        : status === 'declined_by_mayor'
          ? 'Declined'
          : 'Final decision recorded',
      timestamp: eventTime('MAYOR_APPROVED', 'MAYOR_REJECTED'),
    });
  }

  if (legacyAdminReview) {
    pipelineSteps.push({
      key: 'legacy-admin',
      title: 'Legacy administrative review',
      subtitle: 'Existing submission route',
      state: 'active',
      detail: 'Awaiting administrator review',
      timestamp: routeFinalizedAt,
    });
  }

  const representedOfficeRoles = new Set(
    pipelineSteps.map((step) => step.officeRole).filter((value): value is OfficeRole => Boolean(value))
  );
  if (finalOfficeRole && !representedOfficeRoles.has(finalOfficeRole)) {
    const finalDecisionIsActive =
      status === 'pending_office' && selectedOfficeRole === finalOfficeRole;
    pipelineSteps.push({
      key: 'final-decision-office',
      title: OFFICE_CONFIG[finalOfficeRole].label,
      subtitle: 'Final decision',
      officeRole: finalOfficeRole,
      state: status === 'completed'
        ? 'complete'
        : status === 'declined_by_office' || status === 'declined_by_mayor'
          ? 'rejected'
          : finalDecisionIsActive || status === 'returned_for_requirements'
            ? 'active'
            : 'pending',
      detail: status === 'completed'
        ? 'Final decision recorded'
        : finalDecisionIsActive
          ? 'Final decision in progress'
          : status === 'returned_for_requirements'
            ? 'Waiting for submitter response'
            : declined
              ? 'Not reached'
              : 'Awaiting final decision',
      timestamp: eventTime('OFFICE_FINAL_DECISION', 'WORKFLOW_COMPLETED', 'FINAL_AUTHORIZATION'),
    });
  }

  const statusLabel = getSubmissionStatusLabel(status);
  const compact = variant === 'compact';

  return (
    <section
      aria-label="Visual multi-hop routing pipeline"
      className={
        compact
          ? 'w-full rounded-xl border border-warm-border/80 bg-sidebar/40 px-3 py-3'
          : 'mb-4 rounded-2xl border border-warm-border bg-card p-5 shadow-sm max-md:p-4'
      }
    >
      <div className={`flex flex-wrap items-center justify-between gap-3 ${compact ? 'mb-2' : 'mb-5'}`}>
        <div>
          <p className={`${compact ? 'text-[9px]' : 'text-[11px]'} font-semibold uppercase tracking-[0.12em] text-muted-text`}>
            {compact ? 'Routing pipeline' : 'Visual multi-hop routing pipeline'}
          </p>
          {!compact && (
            <h2 className="mt-1 text-sm font-semibold text-warm-text">
              Document progress
            </h2>
          )}
        </div>
        {!compact && statusLabel && (
          <span
            className={`rounded-full px-3 py-1.5 text-[11px] font-medium ${
              status === 'completed'
                ? 'bg-approved-bg text-approved-text'
                : isDeclined(status)
                  ? 'bg-rejected-bg text-rejected-text'
                  : 'bg-pending-bg text-pending-text'
            }`}
          >
            {statusLabel}
          </span>
        )}
      </div>

      {routeLoadFailed && (
        <p
          role="status"
          className={`rounded-xl border border-pending-bg bg-pending-bg/40 px-3 py-2 text-xs text-pending-text ${compact ? 'mb-2' : 'mb-4'}`}
        >
          The office route could not be loaded. Refresh the page to try again.
        </p>
      )}

      <ol className={`flex snap-x gap-0 overflow-x-auto ${compact ? 'pb-1' : 'pb-2'}`}>
        {pipelineSteps.map((step, index) => {
          const icon =
            step.state === 'complete'
              ? '✓'
              : step.state === 'active'
                ? '◷'
                : step.state === 'rejected'
                  ? '×'
                  : step.state === 'skipped'
                    ? '–'
                    : String(index + 1);
          const stateStyles =
            step.state === 'complete'
              ? 'border-approved-text bg-approved-text text-white'
              : step.state === 'active'
                ? 'animate-pulse border-review-text bg-review-text text-white ring-4 ring-review-bg motion-reduce:animate-none'
                : step.state === 'rejected'
                  ? 'border-rejected-text bg-rejected-text text-white'
                  : 'border-warm-border bg-sidebar text-muted-text';
          const previousStep = pipelineSteps[index - 1];
          const timestamp = formatTimestamp(step.timestamp);

          return (
            <li
              key={step.key}
              className={`flex snap-start flex-col items-center text-center ${
                compact ? 'min-w-28 flex-1 sm:min-w-32' : 'min-w-36 flex-1 sm:min-w-40'
              }`}
            >
              <div className="flex w-full items-center">
                <span
                  className={`h-1 flex-1 ${
                    index === 0
                      ? 'bg-transparent'
                      : previousStep?.state === 'complete'
                        ? 'bg-approved-text'
                        : 'bg-warm-border'
                  }`}
                  aria-hidden="true"
                />
                <span
                  className={`flex shrink-0 items-center justify-center rounded-full border-2 font-semibold ${
                    compact ? 'h-7 w-7 text-[10px]' : 'h-10 w-10 text-sm'
                  } ${stateStyles}`}
                  aria-label={`${step.title}: ${step.state}`}
                >
                  {icon}
                </span>
                <span
                  className={`h-1 flex-1 ${
                    index === pipelineSteps.length - 1
                      ? 'bg-transparent'
                      : step.state === 'complete'
                        ? 'bg-approved-text'
                        : 'bg-warm-border'
                  }`}
                  aria-hidden="true"
                />
              </div>
              <h3 className={`font-semibold text-warm-text ${compact ? 'mt-2 text-[10px]' : 'mt-3 text-xs'}`}>{step.title}</h3>
              <p className={`mt-1 leading-snug text-muted-text ${compact ? 'max-w-28 text-[9px] sm:max-w-32' : 'max-w-36 text-[10px] sm:max-w-40'}`}>
                {step.subtitle}
              </p>
              <p
                className={`${compact ? 'mt-1 text-[9px]' : 'mt-2 text-[10px]'} font-medium ${
                  step.state === 'complete'
                    ? 'text-approved-text'
                    : step.state === 'active'
                      ? 'text-review-text'
                      : step.state === 'rejected'
                        ? 'text-rejected-text'
                        : 'text-muted-text'
                }`}
              >
                {step.detail ?? step.state[0].toUpperCase() + step.state.slice(1)}
              </p>
              {!compact && timestamp && (
                <time
                  dateTime={step.timestamp ?? undefined}
                  className="mt-1 text-[9px] text-muted-text"
                >
                  {timestamp}
                </time>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
