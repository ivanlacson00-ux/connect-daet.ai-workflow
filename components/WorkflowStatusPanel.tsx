import { getOfficeLabel, describeAssignmentState } from '@/lib/workflow/assignments';
import { isOfficeRole } from '@/lib/workflow/offices';

export interface WorkflowStatusStep {
  id: string;
  routing_plan_id: string;
  office_role: string;
  status: string;
  outcome: string | null;
  assigned_at: string | null;
  started_at: string | null;
  decided_at: string | null;
  completed_at: string | null;
}

interface WorkflowStatusPanelProps {
  submissionId: string;
  submissionStatus: string;
  responsibleOfficeRole: string | null;
  receivedAt?: string | null;
  currentRoutePlanId: string | null;
  steps: WorkflowStatusStep[];
  finalDecisionOfficeRole?: string | null;
  finalDecidedAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  completedAt?: string | null;
  routeError?: string | null;
}

const toneClasses = {
  waiting: 'bg-pending-bg text-pending-text',
  positive: 'bg-approved-bg text-approved-text',
  caution: 'bg-pending-bg text-pending-text',
  negative: 'bg-rejected-bg text-rejected-text',
  muted: 'bg-sidebar text-muted-text',
} as const;

export default function WorkflowStatusPanel({
  submissionId,
  submissionStatus,
  responsibleOfficeRole,
  receivedAt,
  currentRoutePlanId,
  steps,
  finalDecisionOfficeRole,
  finalDecidedAt,
  approvedAt,
  rejectedAt,
  completedAt,
  routeError,
}: WorkflowStatusPanelProps) {
  const completed = submissionStatus === 'completed' || submissionStatus === 'approved';
  const rejected = submissionStatus === 'rejected' || submissionStatus.includes('declined');
  const withdrawn = submissionStatus === 'withdrawn';
  const activeSteps = steps.filter((step) =>
    step.routing_plan_id === currentRoutePlanId
    && (step.status === 'pending' || step.status === 'in_progress')
  );
  const history = steps
    .filter((step) => step.status !== 'skipped')
    .map((step) => ({
      id: step.id,
      officeRole: step.office_role,
      ...describeAssignmentState(step),
      timestamp: step.completed_at ?? step.decided_at ?? step.started_at ?? step.assigned_at,
      sortTimestamp: step.completed_at ?? step.decided_at ?? step.started_at ?? step.assigned_at ?? '',
    }));

  const decisionOfficeRole = isOfficeRole(finalDecisionOfficeRole ?? null)
    ? finalDecisionOfficeRole
    : isOfficeRole(responsibleOfficeRole)
      ? responsibleOfficeRole
      : null;
  if ((completed || rejected) && decisionOfficeRole) {
    const timestamp = finalDecidedAt
      ?? (rejected ? rejectedAt : submissionStatus === 'approved' ? approvedAt : completedAt)
      ?? completedAt
      ?? null;
    history.push({
      id: `final-decision-${submissionId}`,
      officeRole: decisionOfficeRole,
      label: rejected
        ? 'Final decision: Rejected'
        : submissionStatus === 'approved'
          ? 'Final decision: Approved'
          : 'Submission completed',
      tone: rejected ? 'negative' : 'positive',
      timestamp,
      sortTimestamp: timestamp ?? '',
    });
  }
  history.sort((first, second) => first.sortTimestamp.localeCompare(second.sortTimestamp));

  return (
    <section
      aria-labelledby={`submitter-workflow-status-${submissionId}`}
      className="overflow-hidden rounded-2xl border border-warm-border bg-card"
      role="status"
    >
      <header className="border-b border-warm-border px-5 py-4">
        <h2 id={`submitter-workflow-status-${submissionId}`} className="text-sm font-bold text-warm-text">
          Workflow status
        </h2>
        <p className="mt-0.5 text-[10px] text-muted-text">
          See which office is handling your submission and the actions recorded so far.
        </p>
      </header>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">Responsible office</p>
          <p className="mt-1 text-xs font-semibold text-warm-text">
            {responsibleOfficeRole ? getOfficeLabel(responsibleOfficeRole) : 'Not assigned'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">Currently handling</p>
          {routeError ? (
            <p className="mt-1 text-xs text-rejected-text">{routeError}</p>
          ) : activeSteps.length > 0 ? (
            <ul className="mt-1 space-y-1.5">
              {activeSteps.map((step) => (
                <li key={step.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                  <span className="font-semibold text-warm-text">{getOfficeLabel(step.office_role)}</span>
                  <span className="text-[10px] font-medium text-pending-text">
                    {step.status === 'pending' ? 'Awaiting start' : 'Under review'}
                  </span>
                </li>
              ))}
            </ul>
          ) : completed || rejected || withdrawn ? (
            <p className="mt-1 text-xs font-medium text-muted-text">No active office assignment</p>
          ) : submissionStatus === 'changes_requested' || submissionStatus === 'returned' ? (
            <p className="mt-1 text-xs font-semibold text-warm-text">Waiting for your response</p>
          ) : submissionStatus === 'submitted' && !receivedAt ? (
            <p className="mt-1 text-xs font-semibold text-warm-text">
              Awaiting receipt by {responsibleOfficeRole ? getOfficeLabel(responsibleOfficeRole) : 'the responsible office'}
            </p>
          ) : (
            <p className="mt-1 text-xs font-semibold text-warm-text">
              {responsibleOfficeRole ? getOfficeLabel(responsibleOfficeRole) : 'Responsible office'} can continue processing
            </p>
          )}
        </div>
        {history.length > 0 && (
          <div className="border-t border-warm-border pt-4 sm:col-span-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">
              Office actions and decisions
            </p>
            <ol className="mt-2 divide-y divide-warm-border">
              {history.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1.5 py-3 first:pt-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs font-semibold text-warm-text">{getOfficeLabel(entry.officeRole)}</span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${toneClasses[entry.tone]}`}>
                      {entry.label}
                    </span>
                  </div>
                  {entry.timestamp && (
                    <time dateTime={entry.timestamp} className="shrink-0 text-[10px] text-muted-text">
                      {new Date(entry.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </time>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
