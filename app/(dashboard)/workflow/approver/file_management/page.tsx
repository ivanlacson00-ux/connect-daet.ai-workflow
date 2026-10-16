'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSubmissions } from '@/hooks/useSubmissions';

const fonts = {
  serif: 'font-serif',
};

// ─── Status groups ───────────────────────────────────────────────────────────
// Approving a file passes it to the admin, so 'pending_admin' counts as approved here
const QUEUE_STATUSES = ['pending', 'pending_approver'];
const APPROVED_STATUSES = ['pending_admin', 'approved', 'completed'];
const DECLINED_STATUSES = ['declined_by_approver', 'declined_by_admin', 'rejected'];

type FilterStatus = 'all' | 'pending' | 'approved' | 'declined';

const FILTERS: { value: FilterStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Needs review' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
];

const matchesFilter = (status: string, filter: FilterStatus) => {
  const s = (status || '').toLowerCase();
  switch (filter) {
    case 'pending':
      return QUEUE_STATUSES.includes(s);
    case 'approved':
      return APPROVED_STATUSES.includes(s);
    case 'declined':
      return DECLINED_STATUSES.includes(s);
    default:
      return true;
  }
};

// ─── Status Stamp (same styles as the other dashboards) ──────────────────────
function StatusStamp({ status }: { status: string }) {
  const getDisplayConfig = () => {
    const s = (status || '').toLowerCase();
    if (APPROVED_STATUSES.includes(s)) return { label: 'Approved', styles: 'bg-approved-bg text-approved-text' };
    if (DECLINED_STATUSES.includes(s)) return { label: 'Declined', styles: 'bg-rejected-bg text-rejected-text' };
    if (QUEUE_STATUSES.includes(s)) return { label: 'Pending', styles: 'bg-pending-bg text-pending-text' };
    return { label: s.replaceAll('_', ' ') || 'Unknown', styles: 'bg-sidebar text-muted-text' };
  };

  const config = getDisplayConfig();

  return (
    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium ${config.styles}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {config.label}
    </div>
  );
}

export default function ApproverSubmissionsPage() {
  const [filter, setFilter] = useState<FilterStatus>('all');
  const { submissions, loading } = useSubmissions();

  const filterCounts = useMemo(() => {
    const counts: Record<FilterStatus, number> = { all: submissions.length, pending: 0, approved: 0, declined: 0 };
    submissions.forEach(sub => {
      if (matchesFilter(sub.status, 'pending')) counts.pending++;
      else if (matchesFilter(sub.status, 'approved')) counts.approved++;
      else if (matchesFilter(sub.status, 'declined')) counts.declined++;
    });
    return counts;
  }, [submissions]);

  const filteredSubmissions = useMemo(
    () => submissions.filter(sub => matchesFilter(sub.status, filter)),
    [submissions, filter]
  );

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-8 max-md:mb-5">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Approver workspace
        </p>
        <h1 className={`${fonts.serif} text-[32px] leading-tight text-warm-text max-md:text-[26px]`}>File registry</h1>
        <p className="mt-2 text-xs text-muted-text max-md:mt-1.5">Every submission, including ones you've already reviewed.</p>
      </div>

      {/* List header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-warm-text">Submissions</h2>
          <span className="rounded-md bg-sidebar px-2 py-1 text-[10px] font-medium text-muted-text">{filteredSubmissions.length}</span>
        </div>
        <span className="text-[11px] text-muted-text max-md:hidden">All submitters</span>
      </div>

      {/* Filter pills (scroll inside their own row on mobile) */}
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
        {FILTERS.map(f => {
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              aria-pressed={active}
              className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-xs font-medium transition-colors max-md:h-11 ${
                active
                  ? 'border-clay bg-clay text-white'
                  : 'border-warm-border bg-card text-warm-text hover:bg-sidebar'
              }`}
            >
              {f.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? 'bg-white/25 text-white' : 'bg-sidebar text-muted-text'}`}>
                {filterCounts[f.value]}
              </span>
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
          <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Syncing records...
        </div>
      ) : (
        <div className="space-y-3">
          {submissions.length === 0 ? (
            <div className="rounded-2xl border border-warm-border bg-card py-20 text-center">
              <p className={`${fonts.serif} text-2xl text-warm-text`}>No submissions yet</p>
              <p className="mt-2 text-xs text-muted-text">New submissions will appear here for review.</p>
            </div>
          ) : filteredSubmissions.length === 0 ? (
            <div className="rounded-2xl border border-warm-border bg-card py-16 text-center">
              <p className={`${fonts.serif} text-2xl text-warm-text`}>Nothing here</p>
              <p className="mt-2 text-xs text-muted-text">
                No {FILTERS.find(f => f.value === filter)?.label.toLowerCase()} submissions.
              </p>
              <button
                onClick={() => setFilter('all')}
                className="mt-5 inline-flex h-10 items-center rounded-full border border-warm-border px-5 text-xs font-medium text-warm-text transition-colors hover:bg-sidebar max-md:h-11"
              >
                Show all
              </button>
            </div>
          ) : (
            filteredSubmissions.map(sub => {
              const needsReview = matchesFilter(sub.status, 'pending');
              const ext = sub.file_name?.split('.').at(-1)?.slice(0, 3);

              return (
                <article
                  key={sub.id}
                  className="group flex flex-col gap-5 rounded-2xl border border-warm-border bg-card px-5 py-5 transition-colors hover:border-[#d9cabb] sm:flex-row sm:items-center sm:justify-between max-md:gap-3 max-md:px-3.5 max-md:py-3.5"
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-sidebar text-muted-text">
                      <span className="text-lg leading-4" aria-hidden="true">▤</span>
                      <span className="mt-1 text-[8px] font-semibold uppercase">{ext || 'File'}</span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-warm-text group-hover:text-clay">
                        {sub.file_name || 'Untitled file'}
                      </h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-text">
                        <span>{String(sub.id).slice(0, 7).toUpperCase()}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">From {sub.profiles?.email ?? 'unknown submitter'}</span>
                        <span aria-hidden="true">·</span>
                        <span>Uploaded {new Date(sub.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end max-md:w-full max-md:flex-col max-md:items-stretch">
                    <div className="max-md:self-start">
                      <StatusStamp status={sub.status} />
                    </div>
                    <Link
                      href={`/workflow/approver/file_management/${sub.id}`}
                      className="inline-flex h-10 items-center gap-2 rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text max-md:h-11 max-md:w-full max-md:justify-center"
                    >
                      {needsReview ? 'Review file' : 'View entry'} <span aria-hidden="true">→</span>
                    </Link>
                  </div>
                </article>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}