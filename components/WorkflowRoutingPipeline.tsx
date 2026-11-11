import { getSubmissionStatusLabel as getFriendlyStatusLabel } from '@/lib/workflow/status';
import {
  buildRoutingPipelineSteps,
  type RoutingPipelineAuditEvent,
  type RoutingPipelineRouteStep,
} from '@/lib/workflow/routing-pipeline';

interface WorkflowRoutingPipelineProps {
  submissionStatus: string;
  submittedAt: string;
  routeSteps: RoutingPipelineRouteStep[];
  routeStatus: string | null;
  routeFinalizedAt?: string | null;
  selectedOfficeRole?: string | null;
  initialDestinationRole?: string | null;
  finalDecisionOfficeRole?: string | null;
  auditEvents: RoutingPipelineAuditEvent[];
  routeLoadFailed?: boolean;
  variant?: 'full' | 'compact';
}

const formatTimestamp = (timestamp?: string | null) => {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const isDeclined = (status: string) => status.startsWith('declined') || status === 'rejected';

export default function WorkflowRoutingPipeline({
  submissionStatus,
  submittedAt,
  routeSteps,
  selectedOfficeRole,
  initialDestinationRole,
  finalDecisionOfficeRole,
  auditEvents,
  routeLoadFailed = false,
  variant = 'full',
}: WorkflowRoutingPipelineProps) {
  const status = submissionStatus.toLowerCase();
  const pipelineSteps = buildRoutingPipelineSteps({
    submissionStatus: status,
    submittedAt,
    routeSteps,
    selectedOfficeRole,
    initialDestinationRole,
    finalDecisionOfficeRole,
    auditEvents,
  });
  const statusLabel = getFriendlyStatusLabel(status);
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

      <ol
        dir="ltr"
        className={`flex w-max min-w-full snap-x justify-start gap-0 overflow-x-auto ${compact ? 'pb-1' : 'pb-2'}`}
      >
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
                  : step.isPlaceholder
                    ? 'border-gray-300 bg-gray-100 text-gray-400'
                    : 'border-warm-border bg-sidebar text-muted-text';
          const previousStep = pipelineSteps[index - 1];
          const timestamp = formatTimestamp(step.timestamp);

          return (
            <li
              key={step.key}
              className={`flex snap-start flex-none flex-col items-center text-center ${
                compact ? 'w-28 sm:w-32' : 'w-36 sm:w-40'
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
              <h3 className={`font-semibold ${step.isPlaceholder ? 'text-gray-400' : 'text-warm-text'} ${compact ? 'mt-2 text-[10px]' : 'mt-3 text-xs'}`}>{step.title}</h3>
              <p className={`mt-1 leading-snug ${step.isPlaceholder ? 'text-gray-400' : 'text-muted-text'} ${compact ? 'max-w-28 text-[9px] sm:max-w-32' : 'max-w-36 text-[10px] sm:max-w-40'}`}>
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
                        : step.isPlaceholder
                          ? 'text-gray-400'
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
