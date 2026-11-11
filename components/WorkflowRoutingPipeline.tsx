import {
  OFFICE_CONFIG,
  OFFICE_RESPONSIBILITIES,
  TOURISM_OFFICE_LABEL,
  TOURISM_OFFICE_ROLE,
  isOfficeRole,
  type OfficeRole,
  type OfficeResponsibility,
} from '@/lib/workflow/offices';
import { getSubmissionStatusLabel as getFriendlyStatusLabel } from '@/lib/workflow/status';

type PipelineState = 'complete' | 'active' | 'pending' | 'rejected' | 'skipped';

interface PipelineRouteStep {
  sequence_number: number;
  office_role: string;
  status: string;
  responsibility?: OfficeResponsibility | string;
  assignment_source?: string;
  started_at?: string | null;
  decided_at?: string | null;
  completed_at?: string | null;
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
  const isMvpStatus = [
    'submitted',
    'in_process',
    'changes_requested',
    'returned',
    'withdrawn',
    'completed',
  ].includes(status);
  if (isMvpStatus) {
    const responsibleRoleCandidate = selectedOfficeRole ?? initialDestinationRole ?? null;
    const responsibleRole = isOfficeRole(responsibleRoleCandidate) ? responsibleRoleCandidate : null;
    const responsibleOffice = responsibleRole ? OFFICE_CONFIG[responsibleRole].label : 'Not assigned';
    const mvpSteps = [
      {
        key: 'submitted',
        title: 'Submitted',
        detail: formatTimestamp(submittedAt) ?? 'Submission received',
        state: 'complete' as const,
      },
      {
        key: 'responsible-office',
        title: 'Responsible office',
        detail: status === 'submitted'
          ? `${responsibleOffice} — awaiting receipt`
          : status === 'returned'
            ? `${responsibleOffice} — returned to submitter`
            : `${responsibleOffice} — ${getFriendlyStatusLabel(status)}`,
        state: status === 'withdrawn'
          ? 'skipped' as const
          : status === 'submitted'
            ? 'active' as const
            : 'complete' as const,
      },
      ...[...routeSteps]
        .sort((first, second) => first.sequence_number - second.sequence_number)
        .filter((step): step is PipelineRouteStep & { office_role: OfficeRole } => isOfficeRole(step.office_role))
        .map((step) => ({
          key: `assignment-${step.sequence_number}-${step.office_role}`,
          title: `Recommendation assignment ${step.sequence_number}`,
          detail: `${OFFICE_CONFIG[step.office_role].label} — ${
            step.status === 'pending' || step.status === 'in_progress'
              ? 'Pending'
              : step.status === 'completed'
                ? 'Completed'
                : step.status === 'returned'
                  ? 'Returned to responsible office'
                  : step.status === 'withdrawn'
                    ? 'Withdrawn'
                    : step.status.replaceAll('_', ' ')
          }`,
          state: step.status === 'completed' || step.status === 'approved'
            ? 'complete' as const
            : step.status === 'withdrawn' || step.status === 'returned' || step.status === 'skipped'
              ? 'skipped' as const
              : step.status === 'in_progress'
                ? 'active' as const
                : 'pending' as const,
        })),
      {
        key: 'completion',
        title: 'Submission status',
        detail: getFriendlyStatusLabel(status),
        state: status === 'completed'
          ? 'complete' as const
          : status === 'withdrawn'
            ? 'skipped' as const
            : status === 'submitted'
              ? 'pending' as const
              : 'active' as const,
      },
    ];

    return (
      <section
        aria-label="Submission workflow"
        className={variant === 'compact'
          ? 'w-full rounded-xl border border-warm-border/80 bg-sidebar/40 px-3 py-3'
          : 'mb-4 rounded-2xl border border-warm-border bg-card p-5 shadow-sm max-md:p-4'}
      >
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">
          {variant === 'compact' ? 'Workflow' : 'Submission workflow'}
        </p>
        <ol className="space-y-2">
          {mvpSteps.map((step, index) => (
            <li key={step.key} className="flex items-start gap-3 rounded-xl border border-warm-border bg-card/70 px-3 py-2.5">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                step.state === 'complete'
                  ? 'bg-approved-bg text-approved-text'
                  : step.state === 'active'
                    ? 'bg-review-bg text-review-text'
                    : step.state === 'skipped'
                      ? 'bg-sidebar text-muted-text'
                      : 'bg-pending-bg text-pending-text'
              }`}>
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold text-warm-text">{step.title}</span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-text">{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    );
  }

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
  const routeForDisplay: PipelineRouteStep[] = routeSteps.length
    ? [...routeSteps].sort(
        (first, second) =>
          first.sequence_number - second.sequence_number
          || first.office_role.localeCompare(second.office_role)
      )
    : [];
  const activeAssignments = routeForDisplay.some((step) => step.status === 'in_progress');
  const allAssignmentsComplete = routeForDisplay.length > 0
    && routeForDisplay.every((step) => step.status === 'completed' || step.status === 'approved');
  const legacyAdminReview =
    !initialOfficeRole
    && (status === 'pending_admin' || routeStatus === 'proposed');

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
    const officeHasReceived = tourismForwarded || routeForDisplay.length > 0 || status === 'completed';
    const officeIsActive =
      status === 'pending_office'
      && selectedOfficeRole === initialOfficeRole
      && !activeAssignments;
    pipelineSteps.push({
      key: 'initial-destination',
      title: 'Selected office',
      subtitle: OFFICE_CONFIG[initialOfficeRole].label,
      state: declined && !routeForDisplay.length
        ? 'rejected'
        : status === 'completed' || officeHasReceived
          ? 'complete'
          : officeIsActive || status === 'returned_for_requirements'
            ? 'active'
            : 'pending',
      detail: status === 'completed'
        ? 'Processing closed'
        : status === 'returned_for_requirements'
          ? 'Waiting for submitter'
          : officeHasReceived
            ? 'Reviewed'
            : officeIsActive
              ? 'Reviewing submission'
              : 'Directly routed by submitter',
      timestamp: eventTime('SUBMITTED', 'OFFICE_ROUTE_STEP_ASSIGNED'),
    });
  } else if (tourismOfficeWasSelected) {
    pipelineSteps.push({
      key: 'initial-destination-tourism',
      title: 'Selected destination',
      subtitle: TOURISM_OFFICE_LABEL,
      state: declined && !routeForDisplay.length
        ? 'rejected'
        : status === 'pending_approver'
          ? 'active'
          : 'complete',
      detail: status === 'pending_approver'
        ? 'Tourism Officer review and municipal-office selection'
        : finalOfficeRole
          ? `Responsible office: ${OFFICE_CONFIG[finalOfficeRole].label}`
          : 'Tourism Officer review completed',
      timestamp: eventTime('SUBMISSION_ROUTED_TO_TOURISM_OFFICER', 'TOURISM_OFFICER_ASSIGNMENTS_CREATED'),
    });
  }

  const tourismInvolved =
    status === 'pending_approver'
    || tourismForwarded
    || routeForDisplay.some((step) => step.assignment_source === 'tourism_officer');
  if (!tourismOfficeWasSelected) {
    pipelineSteps.push({
      key: 'tourism-officer',
      title: 'Tourism Officer',
      subtitle: 'Optional review',
      state: status === 'pending_approver'
        ? 'active'
        : tourismInvolved
          ? 'complete'
          : 'skipped',
      detail: status === 'pending_approver'
        ? 'Reviewing forwarded submission'
        : tourismInvolved
          ? 'Reviewed; additional assignments created'
          : 'Not involved',
      timestamp: eventTime(
        'OFFICE_FORWARDED_TO_TOURISM_OFFICER',
        'TOURISM_OFFICER_ASSIGNMENTS_CREATED'
      ),
    });
  }

  if (routeForDisplay.length > 0) {
    for (const step of routeForDisplay) {
      if (!isOfficeRole(step.office_role)) continue;
      const stepIsActive = step.status === 'in_progress';
      const stepIsRejected = step.status === 'rejected';
      const waitingOnSubmitter =
        status === 'returned_for_requirements'
        && stepIsActive
        && !!step.requirements_requested_at;
      const responsibility = step.responsibility
        && step.responsibility in OFFICE_RESPONSIBILITIES
        ? OFFICE_RESPONSIBILITIES[step.responsibility as OfficeResponsibility]
        : 'Office assignment';

      pipelineSteps.push({
        key: `office-${step.sequence_number}-${step.office_role}`,
        title: `Additional office ${step.sequence_number}`,
        subtitle: `${OFFICE_CONFIG[step.office_role].label} — ${responsibility}`,
        state: stepIsRejected
          ? 'rejected'
          : step.status === 'skipped'
            ? 'skipped'
            : step.status === 'completed' || step.status === 'approved'
              ? 'complete'
              : stepIsActive
                ? 'active'
                : 'pending',
        detail: waitingOnSubmitter
          ? 'Waiting for submitter'
          : step.status === 'completed' || step.status === 'approved'
            ? 'Assignment complete'
            : step.status === 'rejected'
              ? 'Declined'
              : stepIsActive
                ? 'Under review'
                : step.status === 'skipped'
                  ? 'Skipped'
                  : 'Pending',
        timestamp: step.completed_at ?? step.decided_at ?? step.started_at,
      });
    }
  } else {
    const additionalAssignmentsPending = status === 'pending_approver';
    pipelineSteps.push({
      key: 'additional-offices',
      title: 'Additional offices',
      subtitle: 'Tourism Officer assignments',
      state: additionalAssignmentsPending ? 'pending' : 'skipped',
      detail: additionalAssignmentsPending
        ? 'No additional assignments yet'
        : 'None assigned',
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

  const finalOfficeIsActive =
    status === 'pending_office'
    && finalOfficeRole !== null
    && selectedOfficeRole === finalOfficeRole
    && (!routeForDisplay.length || allAssignmentsComplete);
  pipelineSteps.push({
    key: 'completion',
    title: 'Submission closure',
    subtitle: finalOfficeRole
      ? `${OFFICE_CONFIG[finalOfficeRole].label} responsible office`
      : tourismOfficeWasSelected
        ? 'Municipal office designated by Tourism Officer'
      : legacyAdminReview
        ? 'Existing administrator route'
        : 'Authorized office decision-maker',
    state: status === 'completed'
      ? 'complete'
      : declined
        ? 'skipped'
        : finalOfficeIsActive || status === 'returned_for_requirements'
          ? 'active'
          : 'pending',
    detail: status === 'completed'
      ? 'Processing closed'
      : status === 'returned_for_requirements'
        ? 'Waiting for submitter response'
        : finalOfficeIsActive
          ? 'Ready for office to close'
          : declined
            ? 'Not reached'
            : 'Pending',
    timestamp: eventTime('WORKFLOW_COMPLETED', 'OFFICE_FINAL_DECISION', 'FINAL_AUTHORIZATION'),
  });

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
