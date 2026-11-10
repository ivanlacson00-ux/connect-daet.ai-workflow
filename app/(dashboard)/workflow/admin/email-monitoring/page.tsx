'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type EmailStatus = 'queued' | 'processing' | 'accepted' | 'delivered' | 'failed';
type EmailRecord = {
  id: string;
  recipient_email: string | null;
  title: string;
  tracking_number: string | null;
  status: EmailStatus;
  attempt_count: number;
  created_at: string;
  next_attempt_at: string | null;
  last_error: string | null;
  provider_message_id: string | null;
  completed_at: string | null;
};
type EmailAttempt = {
  id: string;
  outcome: string;
  attempted_at: string;
  safe_error_metadata: Record<string, unknown>;
};
type EmailCounts = Record<EmailStatus, number>;

const statuses: EmailStatus[] = ['queued', 'processing', 'accepted', 'delivered', 'failed'];
const emptyCounts: EmailCounts = {
  queued: 0,
  processing: 0,
  accepted: 0,
  delivered: 0,
  failed: 0,
};
const fieldClasses =
  'h-11 w-full rounded-xl border border-warm-border bg-card px-4 text-xs text-warm-text outline-none transition-colors focus:border-clay';

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

function statusClasses(status: EmailStatus) {
  if (status === 'delivered' || status === 'accepted') return 'bg-approved-bg text-approved-text';
  if (status === 'failed') return 'bg-rejected-bg text-rejected-text';
  if (status === 'processing') return 'bg-review-bg text-review-text';
  return 'bg-pending-bg text-pending-text';
}

async function readJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body
      ? String(body.error)
      : 'Request failed.';
    throw new Error(message);
  }
  return body as T;
}

export default function EmailMonitoringPage() {
  const [records, setRecords] = useState<EmailRecord[]>([]);
  const [counts, setCounts] = useState<EmailCounts>(emptyCounts);
  const [pendingRetries, setPendingRetries] = useState(0);
  const [filterStatus, setFilterStatus] = useState<EmailStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<EmailAttempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = filterStatus === 'all' ? '' : `?status=${encodeURIComponent(filterStatus)}`;
      const result = await readJson<{
        records: EmailRecord[];
        counts: EmailCounts;
        pendingRetries: number;
      }>(await fetch(`/api/admin/notification-deliveries${query}`, { cache: 'no-store' }));
      setRecords(result.records);
      setCounts(result.counts);
      setPendingRetries(result.pendingRetries);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Email monitoring data could not be loaded.');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    void fetchEmails();
  }, [fetchEmails]);

  const total = useMemo(
    () => statuses.reduce((sum, status) => sum + counts[status], 0),
    [counts]
  );
  const visibleRecords = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return records.filter((record) =>
      !normalized
      || (record.recipient_email ?? '').toLowerCase().includes(normalized)
      || record.title.toLowerCase().includes(normalized)
      || (record.tracking_number ?? '').toLowerCase().includes(normalized)
    );
  }, [records, search]);

  const loadAttempts = async (recordId: string) => {
    setExpandedId(recordId);
    setAttemptsLoading(true);
    setAttempts([]);
    setError('');
    try {
      const result = await readJson<{ attempts: EmailAttempt[] }>(
        await fetch(`/api/admin/notification-deliveries?attempts=${encodeURIComponent(recordId)}`, {
          cache: 'no-store',
        })
      );
      setAttempts(result.attempts);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load delivery attempts.');
    } finally {
      setAttemptsLoading(false);
    }
  };

  const retryEmail = async (record: EmailRecord) => {
    if (!window.confirm(`Queue another attempt for ${record.recipient_email ?? 'this recipient'}?`)) return;
    setRetryingId(record.id);
    setNotice('');
    setError('');
    try {
      const result = await readJson<{ queued: boolean }>(await fetch('/api/admin/notification-deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryId: record.id }),
      }));
      if (!result.queued) {
        setError('This email is no longer eligible for retry.');
        return;
      }
      setNotice('Email queued for another attempt.');
      await fetchEmails();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : 'Email retry could not be completed.');
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="w-full">
      <header className="mb-8 max-md:mb-5">
        <p className="mb-3 text-[11px] font-medium text-muted-text">Admin workspace</p>
        <h1 className="font-serif text-[32px] leading-tight text-warm-text max-md:text-[26px]">
          Email monitoring
        </h1>
        <p className="mt-2 text-xs text-muted-text">
          Clean-schema notification delivery history and retry status. Email bodies are not shown.
        </p>
      </header>

      <section aria-label="Email totals" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-2xl border border-warm-border bg-card p-5">
          <p className="mb-2 text-[11px] font-medium text-muted-text">Total</p>
          <p className="font-serif text-[32px] leading-none text-warm-text">{total}</p>
        </div>
        {statuses.map((status) => (
          <div key={status} className="rounded-2xl border border-warm-border bg-card p-5">
            <p className="mb-2 text-[11px] font-medium capitalize text-muted-text">{status}</p>
            <p className="font-serif text-[32px] leading-none text-warm-text">{counts[status]}</p>
          </div>
        ))}
        <div className="rounded-2xl border border-warm-border bg-card p-5">
          <p className="mb-2 text-[11px] font-medium text-muted-text">Pending retries</p>
          <p className="font-serif text-[32px] leading-none text-warm-text">{pendingRetries}</p>
        </div>
      </section>

      <section className="mb-5 grid gap-3 rounded-2xl border border-warm-border bg-card p-4 sm:grid-cols-[1fr_220px_auto]">
        <label className="sr-only" htmlFor="email-search">Search recipient, title, or reference</label>
        <input
          id="email-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search recipient, title, or reference"
          className={fieldClasses}
        />
        <label className="sr-only" htmlFor="email-status">Filter by status</label>
        <select
          id="email-status"
          value={filterStatus}
          onChange={(event) => setFilterStatus(event.target.value as EmailStatus | 'all')}
          className={fieldClasses}
        >
          <option value="all">All statuses</option>
          {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button
          type="button"
          onClick={() => void fetchEmails()}
          disabled={loading}
          className="h-11 rounded-xl border border-warm-border px-4 text-xs font-semibold text-warm-text hover:bg-sidebar disabled:opacity-50"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </section>

      {notice && <p role="status" className="mb-4 rounded-xl border border-approved-bg bg-approved-bg/50 px-4 py-3 text-xs text-approved-text">{notice}</p>}
      {error && <p role="alert" className="mb-4 rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs text-rejected-text">{error}</p>}

      {loading ? (
        <div className="rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">Loading email records...</div>
      ) : visibleRecords.length === 0 ? (
        <div className="rounded-2xl border border-warm-border bg-card py-16 text-center">
          <p className="font-serif text-2xl text-warm-text">No email records found</p>
          <p className="mt-2 text-xs text-muted-text">Try another search or status filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRecords.map((record) => (
            <article key={record.id} className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase ${statusClasses(record.status)}`}>{record.status}</span>
                    <span className="text-[10px] text-muted-text">Attempts: {record.attempt_count}</span>
                  </div>
                  <p className="mt-3 break-all text-xs font-semibold text-warm-text">{record.recipient_email ?? 'Recipient email unavailable'}</p>
                  <p className="mt-1 break-words text-xs text-muted-text">{record.title}</p>
                  {record.tracking_number && <p className="mt-1 text-[10px] text-muted-text">Reference: {record.tracking_number}</p>}
                  {record.last_error && <p className="mt-2 break-words text-xs text-rejected-text">{record.last_error}</p>}
                  <dl className="mt-3 grid gap-x-5 gap-y-1 text-[10px] text-muted-text sm:grid-cols-2 xl:grid-cols-3">
                    <div><dt className="inline font-semibold">Created: </dt><dd className="inline">{formatDate(record.created_at)}</dd></div>
                    <div><dt className="inline font-semibold">Completed: </dt><dd className="inline">{formatDate(record.completed_at)}</dd></div>
                    <div><dt className="inline font-semibold">Next retry: </dt><dd className="inline">{formatDate(record.next_attempt_at)}</dd></div>
                  </dl>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => expandedId === record.id ? setExpandedId(null) : void loadAttempts(record.id)}
                    className="h-9 rounded-xl border border-warm-border px-3 text-[11px] font-semibold text-warm-text hover:bg-sidebar"
                  >
                    {expandedId === record.id ? 'Hide attempts' : 'View attempts'}
                  </button>
                  {record.status === 'failed' && record.attempt_count < 6 && (
                    <button
                      type="button"
                      onClick={() => void retryEmail(record)}
                      disabled={retryingId === record.id}
                      className="h-9 rounded-xl bg-clay px-3 text-[11px] font-semibold text-white hover:bg-warm-text disabled:opacity-50"
                    >
                      {retryingId === record.id ? 'Queuing...' : 'Retry email'}
                    </button>
                  )}
                </div>
              </div>
              {expandedId === record.id && (
                <div className="mt-4 border-t border-warm-border pt-4">
                  <h2 className="mb-3 text-xs font-semibold text-warm-text">Delivery attempts</h2>
                  {attemptsLoading ? (
                    <p className="text-xs text-muted-text">Loading attempts...</p>
                  ) : attempts.length === 0 ? (
                    <p className="text-xs text-muted-text">No attempt records found.</p>
                  ) : (
                    <div className="space-y-2">
                      {attempts.map((attempt) => (
                        <div key={attempt.id} className="rounded-xl bg-sidebar px-3 py-3 text-[11px]">
                          <div className="flex flex-wrap justify-between gap-2">
                            <span className="font-semibold text-warm-text">{attempt.outcome.replaceAll('_', ' ')}</span>
                            <span className="text-muted-text">{formatDate(attempt.attempted_at)}</span>
                          </div>
                          {Object.keys(attempt.safe_error_metadata).length > 0 && (
                            <p className="mt-1 break-words text-rejected-text">
                              {JSON.stringify(attempt.safe_error_metadata)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
          <p className="px-1 text-[10px] text-muted-text">Showing up to 50 matching records for the selected status.</p>
        </div>
      )}
    </div>
  );
}
