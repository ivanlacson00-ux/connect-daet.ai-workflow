'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import FilePreview, { downloadFile, getFileUrl } from '@/components/FilePreview';

// ─── Styles & Fonts ──────────────────────────────────────────────────────────
const fonts = {
  serif: "font-serif",
  mono: "font-sans text-xs",
};

interface Submission {
  id: string;
  file_name: string;
  file_url: string;
  file_path?: string | null;
  file_size: number;
  file_type: string;
  status: string;
  category?: string;
  approver_comments: string;
  admin_comments: string;
  created_at: string;
  updated_at: string;
}

// ─── Status groups ───────────────────────────────────────────────────────────
// Add any other status values from your database to these lists
const PENDING_STATUSES = ['pending', 'pending_approver', 'pending_admin'];
const COMPLETED_STATUSES = ['approved', 'completed'];
const REJECTED_STATUSES = ['declined_by_approver', 'declined_by_admin', 'rejected'];

// ─── Filters ─────────────────────────────────────────────────────────────────
type Filter = 'all' | 'pending' | 'completed' | 'rejected';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'completed', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const matchesFilter = (status: string, filter: Filter) => {
  const s = (status || '').toLowerCase();
  switch (filter) {
    case 'pending':
      return PENDING_STATUSES.includes(s);
    case 'completed':
      return COMPLETED_STATUSES.includes(s);
    case 'rejected':
      return REJECTED_STATUSES.includes(s);
    default:
      return true;
  }
};

// ─── Status Stamp (Synced Unified Logic) ─────────────────────────────────────
function StatusStamp({ status }: { status: string }) {
  const getDisplayConfig = () => {
    switch ((status || '').toLowerCase()) {
      case 'pending':
      case 'pending_approver':
        return { label: 'Pending', styles: 'bg-pending-bg text-pending-text' };
      case 'pending_admin':
        return { label: 'Under review', styles: 'bg-review-bg text-review-text' };
      case 'approved':
      case 'completed':
        return { label: 'Approved', styles: 'bg-approved-bg text-approved-text' };
      case 'declined_by_approver':
      case 'declined_by_admin':
      case 'rejected':
        return { label: 'Rejected', styles: 'bg-rejected-bg text-rejected-text' };
      default:
        return { label: status?.replaceAll('_', ' ') || 'Unknown', styles: 'bg-sidebar text-muted-text' };
    }
  };

  const config = getDisplayConfig();

  return (
    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium ${config.styles}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {config.label}
    </div>
  );
}

// ─── Individual Card Component ───────────────────────────────────────────────
function SubmissionCard({ sub, onPreview }: { sub: Submission; onPreview: (s: Submission) => void }) {
  const router = useRouter();
  const isRejected = matchesFilter(sub.status, 'rejected');

  return (
    <article className="group flex flex-col gap-5 rounded-2xl border border-warm-border bg-card px-5 py-5 transition-colors hover:border-[#d9cabb] sm:flex-row sm:items-center sm:justify-between max-md:gap-3 max-md:px-3.5 max-md:py-3.5">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-sidebar text-muted-text">
          <span className="text-lg leading-4" aria-hidden="true">▤</span>
          <span className="mt-1 text-[8px] font-semibold uppercase">{sub.file_type?.split('/').at(-1)?.slice(0, 3) || 'File'}</span>
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-warm-text group-hover:text-clay">{sub.file_name}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-text">
            <span>{sub.id.slice(0, 7).toUpperCase()}</span>
            <span aria-hidden="true">·</span>
            <span>Uploaded {new Date(sub.created_at).toLocaleDateString()}</span>
            <span aria-hidden="true">·</span>
            <span>{(sub.file_size / 1024).toFixed(1)} KB</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end max-md:w-full max-md:flex-col max-md:items-stretch">
        <div className="max-md:self-start">
          <StatusStamp status={sub.status} />
        </div>
        <button
          onClick={() => onPreview(sub)}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-warm-border px-4 text-xs font-medium text-warm-text transition-colors hover:bg-sidebar max-md:h-11 max-md:w-full max-md:justify-center"
        >
          <span aria-hidden="true">⌕</span> Preview
        </button>
        <button
          onClick={() => router.push(`/workflow/user/file_registry/${sub.id}`)}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text max-md:h-11 max-md:w-full max-md:justify-center"
        >
          View full log <span aria-hidden="true">→</span>
        </button>
      </div>

      {/* Rejection Feedback Panel */}
      {isRejected && (sub.approver_comments || sub.admin_comments) && (
        <div className="mt-5 rounded-xl border border-rejected-bg bg-rejected-bg/50 p-5">
          <div className="mb-2 text-xs font-semibold text-rejected-text">Official feedback</div>
          <p className="font-serif text-base leading-relaxed text-warm-text">
            "{sub.admin_comments || sub.approver_comments}"
          </p>
        </div>
      )}
    </article>
  );
}

// ─── Main Dashboard Page ─────────────────────────────────────────────────────
export default function WorkflowDashboard() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [previewFile, setPreviewFile] = useState<Submission | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  // Stable client so fetchAll doesn't re-run every render
  const supabase = useMemo(() => createClient(), []);

  const fetchAll = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);
    if (!user) return;

    const { data, error } = await supabase
      .from('workflow_submissions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) setSubmissions(data);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Close preview with Escape
  useEffect(() => {
    if (!previewFile) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewFile(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewFile]);

  // Dynamic Dashboard Stats
  const stats = useMemo(() => {
    const cleared = submissions.filter(s => matchesFilter(s.status, 'completed')).length;
    return [
      { label: 'Logged Files', value: submissions.length },
      { label: 'Cleared', value: cleared },
      { label: 'Reward Bal', value: `${cleared * 50} pts` },
    ];
  }, [submissions]);

  // Filter counts + filtered list
  const filterCounts = useMemo(() => {
    const counts: Record<Filter, number> = { all: submissions.length, pending: 0, completed: 0, rejected: 0 };
    submissions.forEach(s => {
      if (matchesFilter(s.status, 'pending')) counts.pending++;
      else if (matchesFilter(s.status, 'completed')) counts.completed++;
      else if (matchesFilter(s.status, 'rejected')) counts.rejected++;
    });
    return counts;
  }, [submissions]);

  const filteredSubmissions = useMemo(
    () => submissions.filter(s => matchesFilter(s.status, filter)),
    [submissions, filter]
  );

  return (
    <div className="w-full">
      <div>
        <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-center max-md:mb-5 max-md:gap-3">
          <div>
            <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2"><span className="h-1.5 w-1.5 rounded-full bg-clay" /> Your workspace</p>
            <h1 className={`${fonts.serif} text-[32px] leading-tight text-warm-text max-md:text-[26px]`}>My submissions</h1>
            <p className="mt-2 text-xs text-muted-text max-md:mt-1.5">Signed in as <span className="text-warm-text">{user?.email}</span></p>
          </div>
          <a
            href="/workflow/user/upload"
            className="inline-flex h-11 items-center justify-center gap-2 self-start rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text sm:self-auto max-md:w-full max-md:self-stretch"
          >
            <span className="text-lg font-normal leading-none" aria-hidden="true">+</span> New submission
          </a>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 max-md:mb-6 max-md:gap-3">
          {stats.map((stat, index) => (
            <div key={stat.label} className="min-h-39.5 rounded-2xl border border-warm-border bg-card p-5 max-md:min-h-0 max-md:p-3.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-muted-text">{stat.label === 'Reward Bal' ? 'Reward balance' : stat.label === 'Logged Files' ? 'Logged files' : stat.label}</h2>
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-base ${index === 1 ? 'bg-approved-bg text-approved-text' : index === 2 ? 'bg-sidebar text-pending-text' : 'bg-clay-soft text-clay'}`} aria-hidden="true">
                  {index === 1 ? '✓' : index === 2 ? '♧' : '▤'}
                </span>
              </div>
              <p className={`${fonts.serif} mt-3 text-[34px] leading-none text-warm-text max-md:mt-2 max-md:text-[27px]`}>{stat.value}</p>
              <p className="mt-3 text-[11px] text-muted-text max-md:mt-1.5">{index === 0 ? 'All your submitted documents' : index === 1 ? 'Reviewed and approved' : 'Earned for approved submissions'}</p>
            </div>
          ))}
        </div>

        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-warm-text">Recent submissions</h2>
            <span className="rounded-md bg-sidebar px-2 py-1 text-[10px] font-medium text-muted-text">{filteredSubmissions.length}</span>
          </div>
          <span className="text-[11px] text-muted-text max-md:hidden">All submissions</span>
        </div>

        {/* Filter pills (scroll inside their own row on mobile) */}
        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
          {FILTERS.map(f => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={active}
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-xs font-medium transition-colors max-md:h-11 ${
                  active
                    ? 'border-clay bg-clay text-white'
                    : 'border-warm-border bg-card text-warm-text hover:bg-sidebar'
                }`}
              >
                {f.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? 'bg-white/25 text-white' : 'bg-sidebar text-muted-text'}`}>
                  {filterCounts[f.key]}
                </span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
            <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Syncing records...
          </div>
        ) : (
          <div className="space-y-3">
            {submissions.length === 0 ? (
              <div className="rounded-2xl border border-warm-border bg-card py-20 text-center">
                <p className={`${fonts.serif} text-2xl text-warm-text`}>No submissions yet</p>
                <p className="mt-2 text-xs text-muted-text">Your submitted documents will appear here.</p>
              </div>
            ) : filteredSubmissions.length === 0 ? (
              <div className="rounded-2xl border border-warm-border bg-card py-16 text-center">
                <p className={`${fonts.serif} text-2xl text-warm-text`}>Nothing here</p>
                <p className="mt-2 text-xs text-muted-text">No {FILTERS.find(f => f.key === filter)?.label.toLowerCase()} submissions.</p>
                <button
                  onClick={() => setFilter('all')}
                  className="mt-5 inline-flex h-10 items-center rounded-full border border-warm-border px-5 text-xs font-medium text-warm-text transition-colors hover:bg-sidebar max-md:h-11"
                >
                  Show all
                </button>
              </div>
            ) : (
              filteredSubmissions.map(sub => (
                <SubmissionCard key={sub.id} sub={sub} onPreview={setPreviewFile} />
              ))
            )}
          </div>
        )}
      </div>

      {previewFile && (
        <div className="fixed inset-0 z-100 flex flex-col bg-warm-text/75 backdrop-blur-sm animate-in fade-in duration-300 max-md:bg-card max-md:backdrop-blur-none">
          <div className="flex min-h-16 items-center justify-between border-b border-warm-border bg-card px-4 py-3 sm:px-8">
            <div className="flex min-w-0 flex-col">
              <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">Document preview</span>
              <h2 className="max-w-[55vw] truncate text-sm font-semibold text-warm-text">{previewFile.file_name}</h2>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-4">
              <button
                onClick={async () => {
                  const url = await getFileUrl(supabase, previewFile);
                  await downloadFile(url, previewFile.file_name);
                }}
                aria-label="Download preview file"
                className="rounded-full border border-warm-border px-4 py-2 text-[11px] font-medium text-warm-text transition-colors hover:bg-sidebar max-md:flex max-md:h-11 max-md:w-11 max-md:items-center max-md:justify-center max-md:border-0 max-md:p-0"
              >
                <svg className="hidden max-md:block" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3" />
                </svg>
                <span className="max-md:sr-only">Download</span>
              </button>
              <button
                onClick={() => setPreviewFile(null)}
                aria-label="Close preview"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-text transition-colors hover:bg-sidebar hover:text-warm-text max-md:h-11 max-md:w-11"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center overflow-hidden bg-cream p-3 sm:p-8 max-md:bg-card max-md:p-0">
            <div className="relative flex h-full w-full max-w-6xl items-center justify-center overflow-hidden rounded-xl border border-warm-border bg-card shadow-xl max-md:max-w-none max-md:rounded-none max-md:border-0 max-md:shadow-none">
              <FilePreview file={previewFile} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}