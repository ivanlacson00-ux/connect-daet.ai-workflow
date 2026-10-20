'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSubmissions } from '@/hooks/useSubmissions';
import { getWorkflowTiming, workflowTimingClasses } from '@/lib/workflow/timing';

// ─── Styles ──────────────────────────────────────────────────────────────────
const fonts = {
  serif: 'font-serif',
};

type FilterStatus = 'all' | 'pending' | 'approved' | 'declined';

const CATEGORIES = ['General', 'Tourism', 'Events', 'Marketing'];

const STATUS_FILTERS: { value: FilterStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
];

// "Pending" looks specifically for items waiting on the admin.
// "Approved" includes completed files, since completing is the step after approval.
const matchesStatus = (status: string, filter: FilterStatus) => {
  const s = status.toLowerCase();
  switch (filter) {
    case 'pending':
      return s === 'pending_admin';
    case 'approved':
      return s === 'approved' || s === 'completed';
    case 'declined':
      return s.includes('declined');
    default:
      return true;
  }
};

const fieldClasses =
  'h-11 w-full rounded-full border border-warm-border bg-card px-4 text-xs text-warm-text outline-none transition-colors focus:border-clay';

// ─── Status Stamp ────────────────────────────────────────────────────────────
function StatusStamp({ status }: { status: string }) {
  const getDisplayConfig = () => {
    const s = status?.toLowerCase();

    // Admin stage logic
    if (s === 'pending_admin') return { label: 'Pending approval', styles: 'bg-review-bg text-review-text' };
    if (s === 'completed') return { label: 'Completed', styles: 'bg-approved-bg text-approved-text' };
    if (s.includes('approved')) return { label: 'Approved', styles: 'bg-approved-bg text-approved-text' };
    if (s.includes('declined')) return { label: 'Declined', styles: 'bg-rejected-bg text-rejected-text' };

    // Default / stage 01
    return { label: 'Under verification', styles: 'bg-pending-bg text-pending-text' };
  };

  const config = getDisplayConfig();

  return (
    <div className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-medium ${config.styles}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {config.label}
    </div>
  );
}

export default function SubmissionsPage() {
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [fileTypeFilter, setFileTypeFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const { submissions, loading } = useSubmissions();

  const fileTypes = useMemo(
    () => [...new Set(submissions.map((s) => s.file_type).filter(Boolean))],
    [submissions]
  );

  // Everything except the status pills, so each pill can show its own count
  const baseFiltered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
    const to = toDate ? new Date(`${toDate}T23:59:59.999`) : null;

    return submissions.filter((sub) => {
      const matchesSearch = !query
        || sub.file_name.toLowerCase().includes(query)
        || sub.tracking_number?.toLowerCase().includes(query)
        || sub.profiles?.email?.toLowerCase().includes(query);
      if (!matchesSearch) return false;

      const createdDate = new Date(sub.created_at);
      return (
        (categoryFilter === 'all' || (sub.category || 'General') === categoryFilter) &&
        (fileTypeFilter === 'all' || sub.file_type === fileTypeFilter) &&
        (!from || createdDate >= from) &&
        (!to || createdDate <= to)
      );
    });
  }, [submissions, searchQuery, categoryFilter, fileTypeFilter, fromDate, toDate]);

  const statusCounts = useMemo(() => {
    const counts: Record<FilterStatus, number> = { all: baseFiltered.length, pending: 0, approved: 0, declined: 0 };
    baseFiltered.forEach((sub) => {
      (['pending', 'approved', 'declined'] as const).forEach((key) => {
        if (matchesStatus(sub.status, key)) counts[key]++;
      });
    });
    return counts;
  }, [baseFiltered]);

  const filteredSubmissions = useMemo(
    () => baseFiltered.filter((sub) => matchesStatus(sub.status, filter)),
    [baseFiltered, filter]
  );

  const hasActiveFilters =
    filter !== 'all' || !!searchQuery || categoryFilter !== 'all' || fileTypeFilter !== 'all' || !!fromDate || !!toDate;

  const clearFilters = () => {
    setFilter('all');
    setSearchQuery('');
    setCategoryFilter('all');
    setFileTypeFilter('all');
    setFromDate('');
    setToDate('');
  };

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-8 max-md:mb-5">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Admin workspace
        </p>
        <h1 className={`${fonts.serif} text-[32px] leading-tight text-warm-text max-md:text-[26px]`}>Master logs</h1>
        <p className="mt-2 text-xs text-muted-text max-md:mt-1.5">
          Global archive and final review. Displaying <span className="text-warm-text">{filteredSubmissions.length}</span> records.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-4 space-y-3">
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          aria-label="Search by file name, tracking number or requester"
          placeholder="Search by tracking number, document name or requester email"
          className="h-12 w-full rounded-full border border-warm-border bg-card px-5 text-sm text-warm-text outline-none transition-colors placeholder:text-muted-text/60 focus:border-clay max-md:h-11"
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Category" className={fieldClasses}>
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={fileTypeFilter} onChange={(event) => setFileTypeFilter(event.target.value)} aria-label="File type" className={fieldClasses}>
            <option value="all">All file types</option>
            {fileTypes.map((fileType) => (
              <option key={fileType} value={fileType}>{fileType}</option>
            ))}
          </select>
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label="From upload date" className={fieldClasses} />
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} aria-label="To upload date" className={fieldClasses} />
        </div>

        {/* Status pills (scroll inside their own row on mobile) */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
          {STATUS_FILTERS.map((f) => {
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
                  {statusCounts[f.value]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* List header */}
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-warm-text">Archive index</h2>
        <span className="rounded-md bg-sidebar px-2 py-1 text-[10px] font-medium text-muted-text">{filteredSubmissions.length}</span>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
          <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Syncing records...
        </div>
      ) : filteredSubmissions.length === 0 ? (
        <div className="rounded-2xl border border-warm-border bg-card py-16 text-center">
          <p className={`${fonts.serif} text-2xl text-warm-text`}>Nothing here</p>
          <p className="mt-2 text-xs text-muted-text">No submissions match your search or filters.</p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="mt-5 inline-flex h-10 items-center rounded-full border border-warm-border px-5 text-xs font-medium text-warm-text transition-colors hover:bg-sidebar max-md:h-11"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSubmissions.map((sub) => {
            const timing = getWorkflowTiming(sub);

            return (
              <article
                key={sub.id}
                className="group flex flex-col gap-5 rounded-2xl border border-warm-border bg-card px-5 py-5 transition-colors hover:border-[#d9cabb] sm:flex-row sm:items-center sm:justify-between max-md:gap-3 max-md:px-3.5 max-md:py-3.5"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-sidebar text-muted-text">
                    <span className="text-lg leading-4" aria-hidden="true">▤</span>
                    <span className="mt-1 text-[8px] font-semibold uppercase">
                      {sub.file_type?.split('/').at(-1)?.slice(0, 3) || 'Doc'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-warm-text group-hover:text-clay">{sub.file_name}</h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-text">
                      <span>{sub.tracking_number || 'Tracking pending'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">From {sub.profiles?.email ?? '—'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{new Date(sub.created_at).toLocaleDateString()}</span>
                      {timing.responsible && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Responsible: {timing.responsible}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:justify-end max-md:w-full max-md:flex-col max-md:items-stretch">
                  <div className="flex flex-col items-start gap-1.5 sm:items-end max-md:self-start">
                    <StatusStamp status={sub.status} />
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium ${workflowTimingClasses(timing.state)}`}>
                      {timing.label}
                    </span>
                  </div>
                  <Link
                    href={`/workflow/admin/submissions/${sub.id}`}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text max-md:h-11 max-md:w-full max-md:justify-center"
                  >
                    Manage entry <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}