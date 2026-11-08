import { OFFICE_CONFIG, isOfficeRole, type OfficeRole } from '@/lib/workflow/offices';

type PipelineState = 'complete' | 'active' | 'pending' | 'rejected' | 'skipped';

interface PipelineRouteStep {
  sequence_number: number;
  office_role: string;
  status: string;
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

  const approverRejected = status === 'declined_by_approver';
  const adminRejected = status === 'declined_by_admin';
  const officeRejected = status === 'declined_by_office' || status === 'declined_by_mayor';
  const hasPassedApprover =
    !!routeStatus ||
    [
      'pending_admin',
      'pending_office',
      'pending_mayor',
      'returned_for_requirements',
      'approved',
      'completed',
      'declined_by_admin',
      'declined_by_office',
      'declined_by_mayor',
    ].includes(status);
  const hasFinalizedRoute = routeStatus === 'finalized';
  const routeIsProposed = routeStatus === 'proposed';
  const isLegacyRoute = !routeStatus && isOfficeRole(selectedOfficeRole ?? null);

  const pipelineSteps: PipelineStep[] = [
    {
      key: 'submission',
      title: 'Submission',
      subtitle: 'Document received',
      state: 'complete',
      detail: 'Received',
      timestamp: submittedAt,
    },
    {
      key: 'approver',
      title: 'Approver review',
      subtitle: approverRejected
        ? 'Request declined'
        : hasPassedApprover
          ? 'Route proposed'
          : 'Initial review',
      state: approverRejected
        ? 'rejected'
        : hasPassedApprover
          ? 'complete'
          : status === 'pending' || status === 'pending_approver'
            ? 'active'
            : 'pending',
      timestamp: eventTime('ROUTE_PROPOSED', 'APPROVER_REJECTED', 'STAGE_1_AUTHORIZED'),
    },
    {
      key: 'admin-route',
      title: 'Administrator',
      subtitle: adminRejected
        ? 'Route declined'
        : hasFinalizedRoute
          ? 'Route finalized'
          : routeIsProposed || status === 'pending_admin'
            ? 'Review proposed route'
            : 'Route approval',
      state: adminRejected
        ? 'rejected'
        : hasFinalizedRoute
          ? 'complete'
          : routeIsProposed || status === 'pending_admin'
            ? 'active'
            : approverRejected || officeRejected || status === 'completed'
              ? 'skipped'
              : 'pending',
      timestamp: routeFinalizedAt ?? eventTime('ROUTE_FINALIZED', 'OFFICE_ROUTE_FINALIZED'),
    },
  ];

  const routeForDisplay: PipelineRouteStep[] = routeSteps.length
    ? [...routeSteps].sort((first, second) => first.sequence_number - second.sequence_number)
    : isLegacyRoute
      ? [{
          sequence_number: 1,
          office_role: selectedOfficeRole as OfficeRole,
          status:
            status === 'pending_office' || status === 'pending_mayor'
              ? 'in_progress'
              : status === 'completed' || status === 'approved'
                ? 'approved'
                : status === 'declined_by_office' || status === 'declined_by_mayor'
                  ? 'rejected'
                  : 'pending',
        }]
      : [];

  let earlierOfficeRejected = false;
  for (const step of routeForDisplay) {
    if (!isOfficeRole(step.office_role)) continue;
    const stepIsRejected =
      step.status === 'rejected' || (officeRejected && step.status === 'in_progress');
    const stepIsSkipped =
      approverRejected ||
      adminRejected ||
      earlierOfficeRejected ||
      step.status === 'skipped';
    const stepIsComplete = step.status === 'approved';
    const stepIsActive = step.status === 'in_progress';
    const waitingOnSubmitter =
      status === 'returned_for_requirements' &&
      stepIsActive &&
      !!step.requirements_requested_at;

    pipelineSteps.push({
      key: `office-${step.sequence_number}-${step.office_role}`,
      title: `Office ${step.sequence_number}`,
      subtitle: OFFICE_CONFIG[step.office_role].label,
      state: stepIsRejected
        ? 'rejected'
        : stepIsSkipped
          ? 'skipped'
        : stepIsComplete
          ? 'complete'
          : stepIsActive && hasFinalizedRoute
            ? 'active'
            : 'pending',
      detail: waitingOnSubmitter
        ? 'Waiting for submitter'
        : step.status === 'approved'
          ? 'Approved'
          : step.status === 'rejected'
            ? 'Declined'
            : routeIsProposed
              ? 'Awaiting route approval'
              : step.status === 'in_progress'
                ? 'Under review'
                : step.status === 'skipped'
                  ? 'Skipped'
                  : 'Pending',
      timestamp: step.decided_at ?? step.started_at,
    });
    earlierOfficeRejected ||= stepIsRejected;
  }

  if (routeForDisplay.length === 0) {
    pipelineSteps.push({
      key: 'offices',
      title: 'Municipal offices',
      subtitle: 'Office route',
      state: approverRejected || adminRejected ? 'skipped' : 'pending',
      detail: routeIsProposed
        ? 'Awaiting route approval'
        : status === 'pending_office' || status === 'pending_mayor'
          ? 'Route details unavailable'
          : 'Route not yet defined',
    });
  }

  pipelineSteps.push({
    key: 'completion',
    title: 'Final decision',
    subtitle: 'Administrator completion',
    state:
      status === 'completed'
        ? 'complete'
        : status === 'approved' ||
            (status === 'pending_admin' &&
              hasFinalizedRoute &&
              routeForDisplay.length > 0 &&
              routeForDisplay.every((step) => step.status === 'approved'))
          ? 'active'
          : isDeclined(status)
            ? 'skipped'
            : 'pending',
    detail:
      status === 'completed'
        ? 'Request completed'
        : status === 'approved'
          ? 'Ready to complete'
          : status === 'pending_admin' &&
              hasFinalizedRoute &&
              routeForDisplay.length > 0 &&
              routeForDisplay.every((step) => step.status === 'approved')
            ? 'Awaiting final decision'
            : isDeclined(status)
              ? 'Not reached'
              : 'Pending',
    timestamp: eventTime('WORKFLOW_COMPLETED', 'FINAL_AUTHORIZATION'),
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
                ? 'border-blue-600 bg-blue-600 text-white ring-4 ring-blue-100'
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
                      ? 'text-blue-700'
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
