'use client';

import { useEffect, useRef } from 'react';
import { getSubmissionStatusLabel as getFriendlyStatusLabel } from '@/lib/workflow/status';
import {
  buildRoutingPipeline,
  isDeclinedStatus,
  type RoutingPipelineAuditEvent,
  type RoutingPipelineRouteStep,
  type RoutingPipelineState,
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

const formatTimestamp = (timestamp: string | null | undefined, compact: boolean) => {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return compact
    ? date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const NODE_STYLES: Record<RoutingPipelineState, string> = {
  complete: 'border-approved-text bg-approved-text text-white',
  active: 'border-clay bg-clay text-white ring-4 ring-clay-soft',
  attention: 'border-pending-text bg-pending-bg text-pending-text ring-4 ring-pending-bg/60',
  rejected: 'border-rejected-text bg-rejected-text text-white',
  skipped: 'border-warm-border bg-sidebar text-muted-text',
  pending: 'border-warm-border bg-card text-muted-text',
};

const DETAIL_STYLES: Record<RoutingPipelineState, string> = {
  complete: 'text-approved-text',
  active: 'text-clay',
  attention: 'text-pending-text',
  rejected: 'text-rejected-text',
  skipped: 'text-muted-text',
  pending: 'text-muted-text',
};

const NODE_ICONS: Record<RoutingPipelineState, string> = {
  complete: '✓',
  active: '●',
  attention: '!',
  rejected: '×',
  skipped: '–',
  pending: '',
};

const STATE_NAMES: Record<RoutingPipelineState, string> = {
  complete: 'done',
  active: 'current step',
  attention: 'needs attention',
  rejected: 'rejected',
  skipped: 'stopped',
  pending: 'not reached',
};

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
  const { steps, whereabouts, whereaboutsState } = buildRoutingPipeline({
    submissionStatus: status,
    submittedAt,
    routeSteps,
    selectedOfficeRole,
    initialDestinationRole,
    finalDecisionOfficeRole,
    auditEvents,
  });
  const compact = variant === 'compact';
  const statusLabel = getFriendlyStatusLabel(status);
  // The current step is the last one still in progress or waiting; otherwise the final step.
  const currentIndex = (() => {
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      if (['active', 'attention'].includes(steps[index].state)) return index;
    }
    return steps.length - 1;
  })();

  // Keep the current step visible in narrow cards without scrolling the page.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const scroller = scrollerRef.current;
    const current = currentRef.current;
    if (!scroller || !current) return;
    const overflow = current.offsetLeft + current.offsetWidth - scroller.clientWidth;
    if (overflow > 0) scroller.scrollLeft = overflow + 16;
  }, [steps.length, currentIndex]);

  return (
    <section
      aria-label="Submission route"
      className={
        compact
          ? 'w-full min-w-0 rounded-xl border border-warm-border/80 bg-sidebar/40 px-3 py-3'
          : 'mb-4 min-w-0 rounded-2xl border border-warm-border bg-card p-5 shadow-sm max-md:p-4'
      }
    >
      <div className={`flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 ${compact ? 'mb-2.5' : 'mb-5'}`}>
        <div className="min-w-0">
          <p className={`${compact ? 'text-[9px]' : 'text-[11px]'} font-semibold uppercase tracking-[0.12em] text-muted-text`}>
            Route
          </p>
          <p
            role="status"
            className={`mt-0.5 flex items-center gap-1.5 font-semibold ${compact ? 'text-[11px]' : 'text-sm'} ${DETAIL_STYLES[whereaboutsState]}`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${whereaboutsState === 'active' ? 'animate-pulse motion-reduce:animate-none' : ''}`}
            />
            <span className="min-w-0">
              <span className="font-medium text-muted-text">Now: </span>
              {whereabouts}
            </span>
          </p>
        </div>
        {!compact && statusLabel && (
          <span
            className={`rounded-full px-3 py-1.5 text-[11px] font-medium ${
              status === 'completed' || status === 'approved'
                ? 'bg-approved-bg text-approved-text'
                : isDeclinedStatus(status)
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

      <div ref={scrollerRef} className="overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
        <ol dir="ltr" className={`flex w-max min-w-full justify-start ${compact ? 'pb-1' : 'pb-2'}`}>
          {steps.map((step, index) => {
            const isCurrent = index === currentIndex;
            const timestamp = formatTimestamp(step.timestamp, compact);
            const reached = index <= currentIndex;
            return (
              <li
                key={step.key}
                ref={isCurrent ? currentRef : undefined}
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex flex-none flex-col items-center text-center ${compact ? 'w-28 sm:w-32' : 'w-36 sm:w-40'}`}
              >
                <div className="flex w-full items-center" aria-hidden="true">
                  <span
                    className={`h-0.5 flex-1 ${
                      index === 0
                        ? 'bg-transparent'
                        : reached
                          ? 'bg-approved-text/70'
                          : 'border-t-2 border-dashed border-warm-border bg-transparent'
                    }`}
                  />
                  <span
                    className={`flex shrink-0 items-center justify-center rounded-full border-2 font-bold ${
                      compact ? 'h-6 w-6 text-[10px]' : 'h-9 w-9 text-sm'
                    } ${NODE_STYLES[step.state]}`}
                  >
                    {NODE_ICONS[step.state]}
                  </span>
                  <span
                    className={`h-0.5 flex-1 ${
                      index === steps.length - 1
                        ? 'bg-transparent'
                        : index < currentIndex
                          ? 'bg-approved-text/70'
                          : 'border-t-2 border-dashed border-warm-border bg-transparent'
                    }`}
                  />
                </div>
                <h3
                  className={`max-w-full px-1 font-semibold leading-snug ${
                    isCurrent ? 'text-warm-text' : 'text-warm-text/85'
                  } ${compact ? 'mt-1.5 text-[10px]' : 'mt-2.5 text-xs'}`}
                >
                  {step.title}
                  <span className="sr-only">, {STATE_NAMES[step.state]}</span>
                </h3>
                <p className={`mt-0.5 max-w-full px-1 leading-snug text-muted-text ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
                  {step.subtitle}
                </p>
                {step.detail && (
                  <p className={`max-w-full px-1 font-semibold leading-snug ${compact ? 'mt-0.5 text-[9px]' : 'mt-1 text-[10px]'} ${DETAIL_STYLES[step.state]}`}>
                    {step.detail}
                  </p>
                )}
                {timestamp && (
                  <time
                    dateTime={step.timestamp ?? undefined}
                    className={`text-muted-text ${compact ? 'mt-0.5 text-[9px]' : 'mt-1 text-[9px]'}`}
                  >
                    {timestamp}
                  </time>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
