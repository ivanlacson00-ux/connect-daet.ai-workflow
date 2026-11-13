'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useWorkflowRole } from '@/lib/workflow/role-context';
import {
  getWorkflowDocumentTypeLabel,
  getOfficeFileManagementPath,
  OFFICE_CONFIG,
  type OfficeRole,
} from '@/lib/workflow/offices';
import {
  matchesOfficeDashboardFilter,
  type OfficeDashboardFilter,
} from '@/lib/workflow/office-dashboard';
import { getSubmissionStatusLabel } from '@/lib/workflow/status';
import {
  ASSIGNMENT_TONE_CLASSES,
  describeAssignmentState,
  summarizeAssignment,
} from '@/lib/workflow/assignments';

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
  initial_destination_role: string | null;
  officeRecord: {
    status: string;
    comments: string | null;
    decided_at: string | null;
    completed_at: string | null;
  } | null;
  consultedRecord: {
    office_role: string;
    status: string;
    outcome: string | null;
  } | null;
}

type Filter = OfficeDashboardFilter;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All assigned documents' },
  { key: 'needs_action', label: 'Needs action' },
  { key: 'waiting_on_office', label: 'Waiting on another office' },
  { key: 'changes_requested', label: 'Changes Requested' },
  { key: 'completed', label: 'Completed submissions' },
  { key: 'returned', label: 'Returned' },
  { key: 'withdrawn', label: 'Withdrawn' },
  { key: 'processed', label: 'Processed by this office' },
];

function statusLabel(status: string, assignment = false) {
  if (assignment && status === 'pending') return 'Pending assignment';
  if (assignment && status === 'in_progress') return 'In Progress';
  return getSubmissionStatusLabel(status);
}

export default function OfficeDashboard({
  role,
  view,
}: {
  role: OfficeRole;
  view: 'dashboard' | 'file-management';
}) {
  const office = OFFICE_CONFIG[role];
  const viewerRole = useWorkflowRole();
  const officePath = getOfficeFileManagementPath(role);
  const adminOfficeQuery = viewerRole === 'system_admin' ? `?office=${role}` : '';
  const officeQueuePath = `${officePath}${adminOfficeQuery}`;
  const officeSubmissionPath = (submissionId: string) =>
    `${officePath}/${submissionId}${adminOfficeQuery}`;
  const supabase = useMemo(() => createClient(), []);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
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
      office_role: string;
      assigned_by_role: string | null;
      status: string;
      outcome: string | null;
      comments: string | null;
      decided_at: string | null;
      completed_at: string | null;
    }[] = [];

    if (planIds.length > 0) {
      const { data: steps, error: stepsError } = await supabase
        .from('workflow_routing_steps')
        .select('routing_plan_id, office_role, assigned_by_role, status, outcome, comments, decided_at, completed_at')
        .or(`office_role.eq.${role},assigned_by_role.eq.${role}`)
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
      { status: string; comments: string | null; decided_at: string | null; completed_at: string | null; version: number }
    >();
    // Assignments this office gave to another office (latest per submission).
    const consultedRecords = new Map<
      string,
      { office_role: string; status: string; outcome: string | null; version: number }
    >();
    for (const step of routeSteps) {
      const plan = planById.get(step.routing_plan_id);
      if (!plan) continue;

      if (step.office_role !== role) {
        const consulted = consultedRecords.get(plan.submission_id);
        if (!consulted || plan.version > consulted.version) {
          consultedRecords.set(plan.submission_id, {
            office_role: step.office_role,
            status: step.status,
            outcome: step.outcome,
            version: plan.version,
          });
        }
        continue;
      }

      const existing = officeRecords.get(plan.submission_id);
      if (!existing || plan.version > existing.version) {
        officeRecords.set(plan.submission_id, {
          status: step.status,
          comments: step.comments,
          decided_at: step.decided_at,
          completed_at: step.completed_at,
          version: plan.version,
        });
      }
    }
    const activeRouteSubmissionIds = routeSteps
      .filter((step) => step.status === 'pending' || step.status === 'in_progress')
      .map((step) => planById.get(step.routing_plan_id))
      .filter((plan): plan is NonNullable<typeof plan> => Boolean(plan?.is_current))
      .map((plan) => plan.submission_id);

    let currentAssignmentsQuery = supabase
      .from('workflow_submissions')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(200);
    currentAssignmentsQuery = currentAssignmentsQuery.eq('selected_office_role', role);
    const { data: currentAssignments, error: assignmentsError } = await currentAssignmentsQuery;

    if (assignmentsError) {
      console.error('Office dashboard assignments load failed:', assignmentsError.message);
      setError('Could not load this office’s documents. Please try again.');
      setLoading(false);
      return;
    }

    const submissionIds = Array.from(new Set([
      ...officeRecords.keys(),
      ...consultedRecords.keys(),
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
      .select('id, tracking_number, file_name, file_type, category, other_document_type, status, created_at, selected_office_role, initial_destination_role')
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
      const consultedRecord = consultedRecords.get(submission.id);
      return {
        ...submission,
        consultedRecord: consultedRecord && ['in_process', 'changes_requested'].includes(submission.status)
          ? {
              office_role: consultedRecord.office_role,
              status: consultedRecord.status,
              outcome: consultedRecord.outcome,
            }
          : null,
        officeRecord: officeRecord
          ? {
              status: officeRecord.status,
              comments: officeRecord.comments,
              decided_at: officeRecord.decided_at,
              completed_at: officeRecord.completed_at,
            }
          : submission.selected_office_role === role && submission.status === 'completed'
              ? { status: 'completed', comments: null, decided_at: null, completed_at: null }
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
      return matchesSearch && matchesOfficeDashboardFilter(submission, filter, role);
    });
  }, [filter, role, search, submissions]);

  const needsReview = submissions.filter((submission) =>
    matchesOfficeDashboardFilter(submission, 'needs_action', role)
  ).length;
  const completed = submissions.filter((submission) =>
    matchesOfficeDashboardFilter(submission, 'completed', role)
  ).length;
  const recentActionItems = submissions
    .filter((submission) => matchesOfficeDashboardFilter(submission, 'needs_action', role))
    .slice(0, 5);

  return (
    <div className="w-full">
      <header className="mb-8">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text">
          <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Office workspace
        </p>
        <h1 className="font-serif text-[32px] leading-tight text-warm-text max-md:text-[26px]">
          {view === 'dashboard' ? `${office.label} dashboard` : 'File management'}
        </h1>
        <p className="mt-2 text-xs text-muted-text">
          {view === 'dashboard'
            ? 'Review your office workload and continue processing documents that need action.'
            : 'Search, filter, and review documents routed to or processed by your office.'}
        </p>
      </header>

      {view === 'dashboard' ? (
        <>
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              { label: 'Needs action', value: needsReview, hint: 'Responsible submissions and active assignments' },
              { label: 'Completed', value: completed, hint: 'Finished submissions' },
              { label: 'In office history', value: submissions.length, hint: 'Current and previously routed documents' },
            ].map((stat) => (
              <section key={stat.label} className="rounded-2xl border border-warm-border bg-card p-5">
                <h2 className="text-xs font-medium text-muted-text">{stat.label}</h2>
                <p className="mt-3 font-serif text-[34px] leading-none text-warm-text">{stat.value}</p>
                <p className="mt-3 text-[11px] text-muted-text">{stat.hint}</p>
              </section>
            ))}
          </div>

          <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:px-3.5">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-warm-text">Needs your attention</h2>
                <p className="mt-1 text-[11px] text-muted-text">The next submissions and assignments to process.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void fetchSubmissions()}
                  disabled={loading}
                  className="h-10 rounded-full border border-warm-border bg-card px-4 text-xs font-medium text-warm-text hover:bg-sidebar disabled:opacity-50"
                >
                  {loading ? 'Refreshing...' : 'Refresh'}
                </button>
                <Link
                  href={officeQueuePath}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-clay px-4 text-xs font-semibold text-white transition-colors hover:bg-warm-text"
                >
                  File management <span className="ml-2" aria-hidden="true">→</span>
                </Link>
              </div>
            </div>

            {error ? (
              <div role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-4 text-xs text-rejected-text">
                <p>{error}</p>
                <button type="button" onClick={() => void fetchSubmissions()} className="mt-3 font-semibold underline">
                  Retry
                </button>
              </div>
            ) : loading ? (
              <p className="rounded-xl bg-sidebar px-4 py-6 text-xs text-muted-text">Loading your office overview...</p>
            ) : recentActionItems.length === 0 ? (
              <div className="rounded-xl bg-sidebar px-4 py-8 text-center">
                <p className="font-serif text-xl text-warm-text">You’re all caught up</p>
                <p className="mt-2 text-xs text-muted-text">There are no submissions or assignments requiring action right now.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentActionItems.map((submission) => {
                  return (
                    <article
                      key={submission.id}
                      className="flex flex-col gap-3 rounded-xl border border-warm-border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-warm-text">{submission.file_name}</h3>
                        <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-text">
                          <span>{submission.tracking_number || 'Tracking number pending'}</span>
                          <span aria-hidden="true">·</span>
                          <span>{getWorkflowDocumentTypeLabel(submission.category, submission.other_document_type)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{new Date(submission.created_at).toLocaleDateString()}</span>
                        </p>
                        {submission.officeRecord && (
                          <p className="mt-1 text-[11px] text-muted-text">
                            This office: {statusLabel(submission.officeRecord.status, true)}
                          </p>
                        )}
                        {submission.consultedRecord && (
                          <p className="mt-1 text-[11px] font-semibold text-clay">
                            {summarizeAssignment(submission.consultedRecord)}
                          </p>
                        )}
                      </div>
                      <Link
                        href={officeSubmissionPath(submission.id)}
                        className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text"
                      >
                        View
                      </Link>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : (
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
                  filter === item.key ? 'border-clay bg-clay text-white' : 'border-warm-border bg-card text-warm-text hover:bg-sidebar'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {error ? (
            <div role="alert" className="rounded-2xl border border-rejected-bg bg-rejected-bg/50 px-5 py-6 text-xs text-rejected-text">
              <p>{error}</p>
              <button type="button" onClick={() => void fetchSubmissions()} className="mt-3 font-semibold underline">
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
                const processedAt = submission.officeRecord?.completed_at
                  ?? submission.officeRecord?.decided_at;
                return (
                  <article
                    key={submission.id}
                    className="grid grid-cols-1 gap-4 rounded-2xl border border-warm-border bg-card px-5 py-4 sm:grid-cols-12"
                  >
                    <div className="min-w-0 sm:col-span-7">
                      <h3 className="truncate text-sm font-semibold text-warm-text">{submission.file_name}</h3>
                      <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-text">
                        <span>{submission.tracking_number || 'Tracking number pending'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{getWorkflowDocumentTypeLabel(submission.category, submission.other_document_type)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{new Date(submission.created_at).toLocaleDateString()}</span>
                      </p>
                      {submission.officeRecord
                        && ['approved', 'completed', 'returned', 'withdrawn'].includes(submission.officeRecord.status)
                        && (
                          <p className="mt-2 text-[11px] text-muted-text">
                            Processed
                            {processedAt ? ` on ${new Date(processedAt).toLocaleDateString()}` : ''}
                            {submission.officeRecord.comments ? ` · ${submission.officeRecord.comments}` : ''}
                          </p>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 sm:col-span-5 sm:justify-end">
                      <span className="rounded-full bg-sidebar px-3 py-1.5 text-[11px] font-medium capitalize text-muted-text">
                        Submission: {statusLabel(submission.status)}
                      </span>
                      {submission.officeRecord && (
                        <span className="rounded-full bg-sidebar px-3 py-1.5 text-[11px] font-medium capitalize text-muted-text">
                          This office: {statusLabel(submission.officeRecord.status, true)}
                        </span>
                      )}
                      {submission.consultedRecord && (
                        <span className={`rounded-full px-3 py-1.5 text-[11px] font-medium ${ASSIGNMENT_TONE_CLASSES[describeAssignmentState(submission.consultedRecord).tone]}`}>
                          {summarizeAssignment(submission.consultedRecord)}
                        </span>
                      )}
                      <Link
                        href={officeSubmissionPath(submission.id)}
                        className="inline-flex h-10 items-center justify-center rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text"
                      >
                        View
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
