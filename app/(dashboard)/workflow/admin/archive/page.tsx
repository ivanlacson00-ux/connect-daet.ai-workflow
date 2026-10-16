'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

// ─── Styles ──────────────────────────────────────────────────────────────────
const fonts = {
  serif: 'font-serif',
};

const fieldClasses =
  'h-11 w-full rounded-full border border-warm-border bg-card px-4 text-xs text-warm-text caret-current outline-none transition-colors focus:border-clay';

type ArchivedSubmission = {
  id: string;
  tracking_number: string | null;
  file_name: string;
  file_type: string;
  status: string;
  category: string | null;
  created_at: string;
  archived_at: string;
  retention_until: string | null;
  profiles: { email: string } | null;
};

// ─── Status Stamp ────────────────────────────────────────────────────────────
function StatusStamp({ status }: { status: string }) {
  const s = (status || '').toLowerCase();

  const config =
    s === 'pending_admin'
      ? { label: 'Pending approval', styles: 'bg-review-bg text-review-text' }
      : s === 'completed'
        ? { label: 'Completed', styles: 'bg-approved-bg text-approved-text' }
        : s.includes('approved')
          ? { label: 'Approved', styles: 'bg-approved-bg text-approved-text' }
          : s.includes('declined') || s === 'rejected'
            ? { label: 'Declined', styles: 'bg-rejected-bg text-rejected-text' }
            : s === 'pending' || s === 'pending_approver'
              ? { label: 'Under verification', styles: 'bg-pending-bg text-pending-text' }
              : { label: s.replaceAll('_', ' ') || 'Unknown', styles: 'bg-sidebar text-muted-text' };

  return (
    <div className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-medium capitalize ${config.styles}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {config.label}
    </div>
  );
}

export default function ArchiveRegistryPage() {
  const supabase = useMemo(() => createClient(), []);
  const [records, setRecords] = useState<ArchivedSubmission[]>([]);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);

  const fetchArchives = useCallback(async () => {
    const { data, error } = await supabase
      .from('workflow_submissions')
      .select('id, tracking_number, file_name, file_type, status, category, created_at, archived_at, retention_until, profiles:user_id(email)')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false });

    if (error) {
      console.error('Archive registry fetch failed:', error.message);
      setRecords([]);
    } else {
      setRecords((data || []).map((record) => ({
        ...record,
        profiles: Array.isArray(record.profiles) ? record.profiles[0] || null : record.profiles,
      })) as ArchivedSubmission[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchArchives();
  }, [fetchArchives]);

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();

    return records.filter((record) => {
      const matchesSearch = !query
        || record.file_name.toLowerCase().includes(query)
        || record.tracking_number?.toLowerCase().includes(query)
        || record.profiles?.email?.toLowerCase().includes(query);
      const archivedDate = record.archived_at.slice(0, 10);
      const matchesFrom = !fromDate || archivedDate >= fromDate;
      const matchesTo = !toDate || archivedDate <= toDate;
      return matchesSearch && matchesFrom && matchesTo;
    });
  }, [fromDate, records, search, toDate]);

  const hasActiveFilters = !!search || !!fromDate || !!toDate;

  const clearFilters = () => {
    setSearch('');
    setFromDate('');
    setToDate('');
  };

  const restoreRecord = async (record: ArchivedSubmission) => {
    setRestoring(record.id);
    const { error } = await supabase.rpc('set_workflow_submission_archive', {
      target_submission_id: record.id,
      should_archive: false,
      retention_date: null,
    });
    if (error) {
      console.error('Archive restore failed:', error.message);
    } else {
      await fetchArchives();
    }
    setRestoring(null);
  };

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-8 max-md:mb-5">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Admin workspace
        </p>
        <h1 className={`${fonts.serif} text-[32px] leading-tight text-warm-text max-md:text-[26px]`}>Archive registry</h1>
        <p className="mt-2 text-xs text-muted-text max-md:mt-1.5">
          Secure records. Displaying <span className="text-warm-text">{filteredRecords.length}</span> archived records.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-4 space-y-3">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search by file name, tracking number or requester"
          placeholder="Search by tracking number, document name or requester email"
          className="h-12 w-full rounded-full border border-warm-border bg-card px-5 text-sm text-warm-text caret-current outline-none transition-colors placeholder:text-muted-text/60 focus:border-clay max-md:h-11"
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="archived-from" className="mb-1.5 block text-[11px] font-medium text-muted-text">
              Archived from
            </label>
            <input id="archived-from" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className={fieldClasses} />
          </div>
          <div>
            <label htmlFor="archived-to" className="mb-1.5 block text-[11px] font-medium text-muted-text">
              Archived to
            </label>
            <input id="archived-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className={fieldClasses} />
          </div>
        </div>
      </div>

      {/* List header */}
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-warm-text">Archived records</h2>
        <span className="rounded-md bg-sidebar px-2 py-1 text-[10px] font-medium text-muted-text">{filteredRecords.length}</span>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
          <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Loading archive...
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="rounded-2xl border border-warm-border bg-card py-16 text-center">
          <p className={`${fonts.serif} text-2xl text-warm-text`}>Nothing here</p>
          <p className="mt-2 text-xs text-muted-text">No archived records found.</p>
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
          {filteredRecords.map((record) => (
            <article
              key={record.id}
              className="group flex flex-col gap-5 rounded-2xl border border-warm-border bg-card px-5 py-5 transition-colors hover:border-[#d9cabb] sm:flex-row sm:items-center sm:justify-between max-md:gap-3 max-md:px-3.5 max-md:py-3.5"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-sidebar text-muted-text">
                  <span className="text-lg leading-4" aria-hidden="true">▤</span>
                  <span className="mt-1 text-[8px] font-semibold uppercase">
                    {record.file_type?.split('/').at(-1)?.slice(0, 3) || 'Doc'}
                  </span>
                </div>
                <div className="min-w-0">
                  <Link
                    href={`/workflow/admin/submissions/${record.id}`}
                    className="block truncate text-sm font-semibold text-warm-text transition-colors group-hover:text-clay"
                  >
                    {record.file_name}
                  </Link>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-text">
                    <span>{record.tracking_number || 'Tracking pending'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{record.category || 'General'}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">From {record.profiles?.email || 'Requester unavailable'}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-text">
                    <span>Archived {new Date(record.archived_at).toLocaleDateString()}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Retention until {record.retention_until ? new Date(record.retention_until).toLocaleDateString() : 'not specified'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:justify-end max-md:w-full max-md:flex-col max-md:items-stretch">
                <div className="max-md:self-start">
                  <StatusStamp status={record.status} />
                </div>
                <button
                  onClick={() => restoreRecord(record)}
                  disabled={restoring === record.id}
                  className="inline-flex h-10 items-center justify-center rounded-full border border-warm-border px-5 text-xs font-semibold text-warm-text transition-colors hover:bg-sidebar disabled:opacity-50 max-md:h-11 max-md:w-full"
                >
                  {restoring === record.id ? 'Restoring...' : 'Restore'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}