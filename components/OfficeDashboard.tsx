'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  getWorkflowDocumentTypeLabel,
  OFFICE_CONFIG,
  type OfficeRole,
} from '@/lib/workflow/offices';
import WorkflowRoutingPipeline from '@/components/WorkflowRoutingPipeline';
import { useRoutePreviews } from '@/lib/workflow/useRoutePreviews';

interface Submission {
  id: string;
  tracking_number: string | null;
  file_name: string;
  file_type: string | null;
  category: string | null;
  other_document_type: string | null;
  status: string;
  created_at: string;
  selected_office_role: string | null;
  officeRecord: {
    status: string;
    comments: string | null;
    decided_at: string | null;
  } | null;
}

type Filter = 'all' | 'needs_review' | 'with_mayor' | 'completed' | 'rejected' | 'processed';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All assigned documents' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'with_mayor', label: 'With Mayor' },
  { key: 'completed', label: 'Completed' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'processed', label: 'Processed by this office' },
];

function matchesFilter(submission: Submission, filter: Filter, role: OfficeRole) {
  switch (filter) {
    case 'needs_review':
      return submission.status === 'pending_office'
        && (submission.selected_office_role === role
          || submission.officeRecord?.status === 'in_progress');
    case 'with_mayor':
      return submission.status === 'pending_mayor'
        || (role === 'mayor_office'
          && submission.status === 'pending_office'
          && submission.selected_office_role === role);
    case 'completed':
      return submission.status === 'completed';
    case 'rejected':
      return submission.status.startsWith('declined_by_');
    case 'processed':
      return submission.officeRecord?.status === 'approved'
        || submission.officeRecord?.status === 'rejected';
    default:
      return true;
  }
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ');
}

export default function OfficeDashboard({ role }: { role: OfficeRole }) {
  const office = OFFICE_CONFIG[role];
  const supabase = useMemo(() => createClient(), []);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const routesBySubmission = useRoutePreviews(submissions);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchSubmissions = useCallback(async () => {
    const { data: plans, error: plansError } = await supabase
      .from('workflow_routing_plans')
      .select('id, submission_id, version, is_current')
      .in('status', ['finalized', 'superseded'])
      .order('created_at', { ascending: false })
      .limit(500);

    if (plansError) {
      console.error('Office route history load failed:', plansError.message);
      setError('Could not load this office’s document history. Please try again.');
      setLoading(false);
      return;
    }
    setError('');

    const planById = new Map((plans ?? []).map((plan) => [plan.id, plan]));
    const planIds = (plans ?? []).map((plan) => plan.id);
    let routeSteps: {
      routing_plan_id: string;
      status: string;
      comments: string | null;
      decided_at: string | null;
    }[] = [];

    if (planIds.length > 0) {
      const { data: steps, error: stepsError } = await supabase
        .from('workflow_routing_steps')
        .select('routing_plan_id, status, comments, decided_at')
        .eq('office_role', role)
        .neq('status', 'skipped')
        .in('routing_plan_id', planIds);

      if (stepsError) {
        console.error('Office route steps load failed:', stepsError.message);
        setError('Could not load this office’s processing history. Please try again.');
        setLoading(false);
        return;
      }

      routeSteps = steps ?? [];
    }

    const officeRecords = new Map<
      string,
      { status: string; comments: string | null; decided_at: string | null; version: number }
    >();
    for (const step of routeSteps) {
      const plan = planById.get(step.routing_plan_id);
      if (!plan) continue;

      const existing = officeRecords.get(plan.submission_id);
      if (!existing || plan.version > existing.version) {
        officeRecords.set(plan.submission_id, {
          status: step.status,
          comments: step.comments,
          decided_at: step.decided_at,
          version: plan.version,
        });
      }
    }
    const activeRouteSubmissionIds = routeSteps
      .filter((step) => step.status === 'in_progress')
      .map((step) => planById.get(step.routing_plan_id))
      .filter((plan): plan is NonNullable<typeof plan> => Boolean(plan?.is_current))
      .map((plan) => plan.submission_id);

    let currentAssignmentsQuery = supabase
      .from('workflow_submissions')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(200);
    currentAssignmentsQuery = role === 'mayor_office'
      ? currentAssignmentsQuery.or('selected_office_role.eq.mayor_office,status.eq.pending_mayor')
      : currentAssignmentsQuery.eq('selected_office_role', role);
    const { data: currentAssignments, error: assignmentsError } = await currentAssignmentsQuery;

    if (assignmentsError) {
      console.error('Office dashboard assignments load failed:', assignmentsError.message);
      setError('Could not load this office’s documents. Please try again.');
      setLoading(false);
      return;
    }

    const submissionIds = Array.from(new Set([
      ...officeRecords.keys(),
      ...activeRouteSubmissionIds,
      ...(currentAssignments ?? []).map((submission) => submission.id),
    ]));

    if (submissionIds.length === 0) {
      setSubmissions([]);
      setLoading(false);
      return;
    }

    const { data, error: fetchError } = await supabase
      .from('workflow_submissions')
      .select('id, tracking_number, file_name, file_type, category, other_document_type, status, created_at, selected_office_role')
      .in('id', submissionIds)
      .order('created_at', { ascending: false })
      .limit(200);

    if (fetchError) {
      console.error('Office dashboard history load failed:', fetchError.message);
      setError('Could not load this office’s documents. Please try again.');
      setLoading(false);
      return;
    }

    setSubmissions((data ?? []).map((submission) => {
      const officeRecord = officeRecords.get(submission.id);
      const isCurrentlyAssigned =
        submission.status === 'pending_office'
        && (submission.selected_office_role === role
          || officeRecord?.status === 'in_progress');
      const isMayorFinalReview =
        role === 'mayor_office' && submission.status === 'pending_mayor';
      return {
        ...submission,
        officeRecord: officeRecord
          ? {
              status: officeRecord.status,
              comments: officeRecord.comments,
              decided_at: officeRecord.decided_at,
            }
          : isCurrentlyAssigned || isMayorFinalReview
            ? { status: 'in_progress', comments: null, decided_at: null }
            : null,
      };
    }));
    setLoading(false);
  }, [role, supabase]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void fetchSubmissions();
    });
    return () => {
      active = false;
    };
  }, [fetchSubmissions]);

  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') void fetchSubmissions();
    };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [fetchSubmissions]);

  const filteredSubmissions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return submissions.filter((submission) => {
      const matchesSearch =
        !query ||
        submission.file_name.toLowerCase().includes(query) ||
        (submission.tracking_number ?? '').toLowerCase().includes(query) ||
        (submission.category ?? '').toLowerCase().includes(query);
      return matchesSearch && matchesFilter(submission, filter, role);
    });
  }, [filter, role, search, submissions]);

  const needsReview = submissions.filter((submission) =>
    matchesFilter(submission, 'needs_review', role)
  ).length;
  const completed = submissions.filter((submission) =>
    matchesFilter(submission, 'completed', role)
  ).length;

  return (
    <div className="w-full">
      <header className="mb-8">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text">
          <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Office workspace
        </p>
        <h1 className="font-serif text-[32px] leading-tight text-warm-text max-md:text-[26px]">
          {office.label}
        </h1>
        <p className="mt-2 text-xs text-muted-text">
          Review documents routed to your office, leave feedback, and send them to the
          next station.
        </p>
      </header>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {[
          { label: 'Needs review', value: needsReview, hint: 'Waiting for office feedback' },
          { label: 'Completed', value: completed, hint: 'Finished submissions' },
        ].map((stat) => (
          <section
            key={stat.label}
            className="rounded-2xl border border-warm-border bg-card p-5"
          >
            <h2 className="text-xs font-medium text-muted-text">{stat.label}</h2>
            <p className="mt-3 font-serif text-[34px] leading-none text-warm-text">
              {stat.value}
            </p>
            <p className="mt-3 text-[11px] text-muted-text">{stat.hint}</p>
          </section>
        ))}
      </div>

      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-warm-text">Office document history</h2>
            <span className="rounded-md bg-sidebar px-2 py-1 text-[10px] font-medium text-muted-text">
              {filteredSubmissions.length}
            </span>
          </div>
          <label className="sr-only" htmlFor="office-search">Search documents</label>
          <input
            id="office-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, tracking number, or category"
            className="h-10 w-full rounded-full border border-warm-border bg-card px-4 text-xs text-warm-text outline-none focus:border-clay sm:max-w-sm"
          />
          <button
            type="button"
            onClick={() => void fetchSubmissions()}
            disabled={loading}
            className="h-10 shrink-0 rounded-full border border-warm-border bg-card px-4 text-xs font-medium text-warm-text hover:bg-sidebar disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              aria-pressed={filter === item.key}
              className={`h-10 shrink-0 rounded-full border px-4 text-xs font-medium transition-colors ${
                filter === item.key
                  ? 'border-clay bg-clay text-white'
                  : 'border-warm-border bg-card text-warm-text hover:bg-sidebar'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="rounded-2xl border border-rejected-bg bg-rejected-bg/50 px-5 py-6 text-xs text-rejected-text">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void fetchSubmissions()}
              className="mt-3 font-semibold underline"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
            Loading office documents...
          </div>
        ) : filteredSubmissions.length === 0 ? (
          <div className="rounded-2xl border border-warm-border bg-card py-16 text-center">
            <p className="font-serif text-2xl text-warm-text">No documents found</p>
            <p className="mt-2 text-xs text-muted-text">
              Documents assigned to this office, including past processing records, will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSubmissions.map((submission) => {
              const isMayorFinalReview = role === 'mayor_office' && submission.status === 'pending_mayor';
              const canReview =
                (submission.status === 'pending_office' && submission.selected_office_role === role)
                || isMayorFinalReview;
              return (
                <article
                  key={submission.id}
                  className="grid grid-cols-1 gap-4 rounded-2xl border border-warm-border bg-card px-5 py-4 sm:grid-cols-12"
                >
                  <div className="min-w-0 sm:col-span-7">
                    <h3 className="truncate text-sm font-semibold text-warm-text">
                      {submission.file_name}
                    </h3>
                    <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-text">
                      <span>{submission.tracking_number || 'Tracking number pending'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{getWorkflowDocumentTypeLabel(
                        submission.category,
                        submission.other_document_type
                      )}</span>
                      <span aria-hidden="true">·</span>
                      <span>{new Date(submission.created_at).toLocaleDateString()}</span>
                    </p>
                    {submission.officeRecord
                      && ['approved', 'rejected'].includes(submission.officeRecord.status)
                      && (
                        <p className="mt-2 text-[11px] text-muted-text">
                          Processed
                          {submission.officeRecord.decided_at
                            ? ` on ${new Date(submission.officeRecord.decided_at).toLocaleDateString()}`
                            : ''}
                          {submission.officeRecord.comments
                            ? ` · ${submission.officeRecord.comments}`
                            : ''}
                        </p>
                      )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 sm:col-span-5 sm:justify-end">
                    <span className="rounded-full bg-sidebar px-3 py-1.5 text-[11px] font-medium capitalize text-muted-text">
                      Submission: {statusLabel(submission.status)}
                    </span>
                    {submission.officeRecord && (
                      <span className="rounded-full bg-sidebar px-3 py-1.5 text-[11px] font-medium capitalize text-muted-text">
                        This office: {statusLabel(submission.officeRecord.status)}
                      </span>
                    )}
                    <Link
                      href={`/workflow/approver/file_management/${submission.id}`}
                      className="inline-flex h-10 items-center justify-center rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text"
                    >
                      {canReview
                        ? isMayorFinalReview ? 'Final review' : 'Review document'
                        : 'View document'}
                    </Link>
                  </div>
                  <div className="sm:col-span-12">
                    <WorkflowRoutingPipeline
                      variant="compact"
                      submissionStatus={submission.status}
                      submittedAt={submission.created_at}
                      routeSteps={routesBySubmission[submission.id]?.steps ?? []}
                      routeStatus={routesBySubmission[submission.id]?.status ?? null}
                      routeFinalizedAt={routesBySubmission[submission.id]?.finalizedAt}
                      selectedOfficeRole={submission.selected_office_role}
                      initialDestinationRole={routesBySubmission[submission.id]?.initialDestinationRole}
                      finalDecisionOfficeRole={routesBySubmission[submission.id]?.finalDecisionOfficeRole}
                      auditEvents={routesBySubmission[submission.id]?.auditEvents ?? []}
                      routeLoadFailed={routesBySubmission[submission.id]?.loadFailed ?? false}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
