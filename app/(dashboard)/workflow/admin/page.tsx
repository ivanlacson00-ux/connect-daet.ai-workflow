'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import FilePreview from '@/components/FilePreview';
import WorkflowRoutingPipeline from '@/components/WorkflowRoutingPipeline';
import { getWorkflowDocumentTypeLabel } from '@/lib/workflow/offices';
import { createClient } from '@/lib/supabase/client';
import { useRoutePreviews } from '@/lib/workflow/useRoutePreviews';

type Role =
  | 'submitter'
  | 'tourism_officer'
  | 'system_admin'
  | 'municipal_treasurer'
  | 'mayor_office'
  | 'sangguniang_bayan';

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  created_at: string;
}

interface Submission {
  id: string;
  user_id: string;
  tracking_number: string | null;
  file_name: string;
  file_url: string;
  file_path: string | null;
  file_type: string | null;
  file_size: number | null;
  category: string | null;
  other_document_type: string | null;
  status: string;
  description: string | null;
  purpose: string | null;
  requested_action: string | null;
  intended_recipient: string | null;
  selected_office_role: string | null;
  created_at: string;
}

const PAGE_SIZE = 500;

const ROLE_GROUPS: { role: Role; label: string }[] = [
  { role: 'submitter', label: 'Submitters' },
  { role: 'tourism_officer', label: 'Tourism Officers' },
  { role: 'municipal_treasurer', label: "Municipal Treasurer's Office" },
  { role: 'mayor_office', label: "Mayor's Office" },
  { role: 'sangguniang_bayan', label: 'Sangguniang Bayan Office' },
  { role: 'system_admin', label: 'System Administrators' },
];

const ROLE_STYLES: Record<Role, string> = {
  submitter: 'bg-sidebar text-muted-text',
  tourism_officer: 'bg-review-bg text-review-text',
  municipal_treasurer: 'bg-approved-bg text-approved-text',
  mayor_office: 'bg-pending-bg text-pending-text',
  sangguniang_bayan: 'bg-rejected-bg text-rejected-text',
  system_admin: 'bg-clay-soft text-clay',
};

function StatusStamp({ status }: { status: string }) {
  const value = status.toLowerCase();
  const config = value.includes('declined') || value === 'rejected'
    ? { label: 'Declined', styles: 'bg-rejected-bg text-rejected-text' }
    : value === 'completed'
      ? { label: 'Completed', styles: 'bg-approved-bg text-approved-text' }
      : value.includes('approved')
        ? { label: 'Approved', styles: 'bg-approved-bg text-approved-text' }
        : value === 'returned_for_requirements'
          ? { label: 'Returned for requirements', styles: 'bg-pending-bg text-pending-text' }
          : value.startsWith('pending')
            ? { label: value.replaceAll('_', ' '), styles: 'bg-review-bg text-review-text' }
            : { label: value.replaceAll('_', ' ') || 'Unknown', styles: 'bg-sidebar text-muted-text' };

  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-medium capitalize ${config.styles}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {config.label}
    </span>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const label = ROLE_GROUPS.find((group) => group.role === role)?.label ?? role;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium ${ROLE_STYLES[role]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

async function fetchAllProfiles(supabase: ReturnType<typeof createClient>) {
  const profiles: Profile[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load user accounts: ${error.message}`);

    const page = (data ?? []) as Profile[];
    profiles.push(...page);
    if (page.length < PAGE_SIZE) return profiles;
  }
}

async function fetchAllSubmissions(supabase: ReturnType<typeof createClient>) {
  const submissions: Submission[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('workflow_submissions')
      .select('id, user_id, tracking_number, file_name, file_url, file_path, file_type, file_size, category, other_document_type, status, description, purpose, requested_action, intended_recipient, selected_office_role, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load submitted documents: ${error.message}`);

    const page = (data ?? []) as Submission[];
    submissions.push(...page);
    if (page.length < PAGE_SIZE) return submissions;
  }
}

export default function AdminDashboard() {
  const supabase = useMemo(() => createClient(), []);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [previewSubmission, setPreviewSubmission] = useState<Submission | null>(null);
  const routesBySubmission = useRoutePreviews(submissions);

  const fetchMonitoringData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [nextProfiles, nextSubmissions] = await Promise.all([
        fetchAllProfiles(supabase),
        fetchAllSubmissions(supabase),
      ]);
      setProfiles(nextProfiles);
      setSubmissions(nextSubmissions);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load monitoring data.';
      console.error('Admin monitoring refresh failed:', message);
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void fetchMonitoringData();
    const profilesChannel = supabase
      .channel('admin-monitoring-profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, fetchMonitoringData)
      .subscribe();
    const submissionsChannel = supabase
      .channel('admin-monitoring-submissions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_submissions' }, fetchMonitoringData)
      .subscribe();

    return () => {
      void supabase.removeChannel(profilesChannel);
      void supabase.removeChannel(submissionsChannel);
    };
  }, [fetchMonitoringData, supabase]);

  const profilesById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles]
  );
  const pendingCount = submissions.filter((submission) =>
    ['pending', 'pending_approver', 'pending_admin', 'pending_office', 'pending_mayor', 'returned_for_requirements']
      .includes(submission.status.toLowerCase())
  ).length;
  const completedCount = submissions.filter((submission) => submission.status.toLowerCase() === 'completed').length;
  const statCards = [
    { label: 'Accounts monitored', value: profiles.length, hint: 'All registered roles', icon: '♧', styles: 'bg-clay-soft text-clay' },
    { label: 'Submitted documents', value: submissions.length, hint: 'Across the system', icon: '▤', styles: 'bg-review-bg text-review-text' },
    { label: 'In progress', value: pendingCount, hint: 'Awaiting a workflow step', icon: '◷', styles: 'bg-pending-bg text-pending-text' },
    { label: 'Completed', value: completedCount, hint: 'Finished workflow requests', icon: '✓', styles: 'bg-approved-bg text-approved-text' },
  ];

  return (
    <div className="w-full">
      <header className="mb-8 max-md:mb-5">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Admin workspace
        </p>
        <h1 className="font-serif text-[32px] leading-tight text-warm-text max-md:text-[26px]">System monitoring</h1>
        <p className="mt-2 text-xs text-muted-text">Monitor accounts by role and track every submitted document.</p>
      </header>

      {loadError && (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs text-rejected-text">
          <span>{loadError}</span>
          <button type="button" onClick={() => void fetchMonitoringData()} className="font-semibold underline">Retry</button>
        </div>
      )}

      <section aria-label="System totals" className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 max-md:mb-6 max-md:gap-3">
        {statCards.map((card) => (
          <article key={card.label} className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-muted-text">{card.label}</h2>
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-base ${card.styles}`} aria-hidden="true">{card.icon}</span>
            </div>
            <p className="mt-3 font-serif text-[34px] leading-none text-warm-text max-md:mt-2 max-md:text-[27px]">{loading ? '—' : card.value}</p>
            <p className="mt-3 text-[11px] text-muted-text max-md:mt-1.5">{card.hint}</p>
          </article>
        ))}
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-warm-text">Submitted documents</h2>
            <p className="mt-1 text-[11px] text-muted-text">Preview the file and review the submitter’s description and request details.</p>
          </div>
          <Link href="/workflow/admin/submissions" className="text-xs font-semibold text-clay underline underline-offset-4">
            Open full file registry
          </Link>
        </div>

        {loading && submissions.length === 0 ? (
          <div className="rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">Loading submitted documents...</div>
        ) : submissions.length === 0 ? (
          <div className="rounded-2xl border border-warm-border bg-card py-14 text-center">
            <p className="font-serif text-2xl text-warm-text">No submissions yet</p>
            <p className="mt-2 text-xs text-muted-text">New user documents will appear here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {submissions.map((submission) => {
              const profile = profilesById.get(submission.user_id);
              return (
                <article key={submission.id} className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-warm-text">{submission.file_name}</h3>
                      <p className="mt-1 text-[11px] text-muted-text">
                        {submission.tracking_number || 'Tracking pending'} · {profile?.full_name || profile?.email || 'Unknown submitter'} · {new Date(submission.created_at).toLocaleDateString()}
                      </p>
                      <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-warm-text">
                        {submission.description || 'No description provided.'}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {profile && <RoleBadge role={profile.role} />}
                        <StatusStamp status={submission.status} />
                        {submission.category && (
                          <span className="text-[11px] text-muted-text">
                            {getWorkflowDocumentTypeLabel(
                              submission.category,
                              submission.other_document_type
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2 max-sm:w-full max-sm:flex-col">
                      <button
                        type="button"
                        onClick={() => setPreviewSubmission(submission)}
                        className="inline-flex h-10 items-center justify-center rounded-full border border-warm-border px-4 text-xs font-semibold text-warm-text transition-colors hover:bg-sidebar max-sm:w-full"
                      >
                        Preview file
                      </button>
                      <Link
                        href={`/workflow/admin/submissions/${submission.id}`}
                        className="inline-flex h-10 items-center justify-center rounded-full bg-clay px-4 text-xs font-semibold text-white transition-colors hover:bg-warm-text max-sm:w-full"
                      >
                        Full record
                      </Link>
                    </div>
                  </div>
                  <div className="mt-4">
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

      {previewSubmission && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center bg-warm-text/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submission-preview-title"
        >
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-warm-border bg-card shadow-xl">
            <header className="flex items-center justify-between gap-4 border-b border-warm-border px-5 py-4">
              <div className="min-w-0">
                <h2 id="submission-preview-title" className="truncate text-sm font-semibold text-warm-text">{previewSubmission.file_name}</h2>
                <p className="mt-1 text-[11px] text-muted-text">
                  {profilesById.get(previewSubmission.user_id)?.email || 'Unknown submitter'} · {previewSubmission.tracking_number || 'Tracking pending'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewSubmission(null)}
                aria-label="Close document preview"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg text-muted-text hover:bg-sidebar"
              >
                ×
              </button>
            </header>
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="min-h-80 rounded-xl border border-warm-border bg-white p-3">
                <FilePreview file={previewSubmission} />
              </div>
              <aside className="space-y-4 text-xs">
                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted-text">Status</p>
                  <StatusStamp status={previewSubmission.status} />
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted-text">Description</p>
                  <p className="whitespace-pre-wrap break-words leading-relaxed text-warm-text">{previewSubmission.description || 'No description provided.'}</p>
                </div>
                {previewSubmission.purpose && (
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-muted-text">Purpose</p>
                    <p className="whitespace-pre-wrap break-words leading-relaxed text-warm-text">{previewSubmission.purpose}</p>
                  </div>
                )}
                {previewSubmission.requested_action && (
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-muted-text">Requested action</p>
                    <p className="whitespace-pre-wrap break-words leading-relaxed text-warm-text">{previewSubmission.requested_action}</p>
                  </div>
                )}
                {previewSubmission.intended_recipient && (
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-muted-text">Intended recipient</p>
                    <p className="whitespace-pre-wrap break-words leading-relaxed text-warm-text">{previewSubmission.intended_recipient}</p>
                  </div>
                )}
                <Link
                  href={`/workflow/admin/submissions/${previewSubmission.id}`}
                  className="inline-flex h-10 w-full items-center justify-center rounded-full bg-clay px-4 text-xs font-semibold text-white"
                >
                  Open full record
                </Link>
              </aside>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
