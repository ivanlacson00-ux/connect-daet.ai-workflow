'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type EmailStatus =
  | 'queued'
  | 'processing'
  | 'accepted'
  | 'delivered'
  | 'bounced'
  | 'failed'
  | 'complained';

interface EmailRecord {
  id: string;
  recipient_email: string;
  subject: string;
  status: EmailStatus;
  attempts: number;
  created_at: string;
  sent_at: string | null;
  accepted_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  next_attempt_at: string | null;
  last_error: string | null;
  is_retryable: boolean;
}

interface EmailAttempt {
  id: string;
  attempt_number: number;
  outcome: string;
  provider_message_id: string | null;
  error_message: string | null;
  created_at: string;
}

const statuses: EmailStatus[] = [
  'queued',
  'processing',
  'accepted',
  'delivered',
  'bounced',
  'failed',
  'complained',
];
const emptyCounts: Record<EmailStatus, number> = {
  queued: 0,
  processing: 0,
  accepted: 0,
  delivered: 0,
  bounced: 0,
  failed: 0,
  complained: 0,
};

const fieldClasses =
  'h-11 w-full rounded-xl border border-warm-border bg-card px-4 text-xs text-warm-text outline-none transition-colors focus:border-clay';

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function statusClasses(status: EmailStatus) {
  if (status === 'delivered' || status === 'accepted') return 'bg-approved-bg text-approved-text';
  if (status === 'failed' || status === 'bounced' || status === 'complained') {
    return 'bg-rejected-bg text-rejected-text';
  }
  if (status === 'processing') return 'bg-review-bg text-review-text';
  return 'bg-pending-bg text-pending-text';
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
      <p className="mb-2 text-[11px] font-medium text-muted-text">{label}</p>
      <p className="font-serif text-[32px] leading-none text-warm-text max-md:text-[26px]">{value}</p>
    </div>
  );
}

export default function EmailMonitoringPage() {
  const supabase = useMemo(() => createClient(), []);
  const [records, setRecords] = useState<EmailRecord[]>([]);
  const [counts, setCounts] = useState<Record<EmailStatus, number>>(emptyCounts);
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
    const normalizedSearch = search.trim();
    let query = supabase
      .from('workflow_email_outbox')
      .select(
        'id, recipient_email, subject, status, attempts, created_at, sent_at, accepted_at, delivered_at, failed_at, next_attempt_at, last_error, is_retryable'
      )
      .order('created_at', { ascending: false })
      .limit(50);

    if (filterStatus !== 'all') query = query.eq('status', filterStatus);
    if (normalizedSearch) query = query.ilike('recipient_email', `%${normalizedSearch}%`);

    const [listResult, ...countResults] = await Promise.all([
      query,
      ...statuses.map((status) =>
        supabase
          .from('workflow_email_outbox')
          .select('id', { count: 'exact', head: true })
          .eq('status', status)
      ),
      supabase
        .from('workflow_email_outbox')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'queued')
        .gt('attempts', 0),
    ]);

    if (listResult.error) {
      setError(listResult.error.message);
      setRecords([]);
    } else {
      setRecords((listResult.data ?? []) as EmailRecord[]);
    }

    setCounts((currentCounts) => {
      const nextCounts = { ...currentCounts };
      statuses.forEach((status, index) => {
        const result = countResults[index];
        if (result.error) {
          console.error(`Could not count ${status} emails:`, result.error.message);
        } else {
          nextCounts[status] = result.count ?? 0;
        }
      });
      return nextCounts;
    });
    const retryCount = countResults[statuses.length];
    if (retryCount.error) {
      console.error('Could not count pending email retries:', retryCount.error.message);
      setPendingRetries(0);
    } else {
      setPendingRetries(retryCount.count ?? 0);
    }
    setLoading(false);
  }, [filterStatus, search, supabase]);

  useEffect(() => {
    void fetchEmails();
  }, [fetchEmails]);

  const total = useMemo(
    () => statuses.reduce((sum, status) => sum + counts[status], 0),
    [counts]
  );

  const loadAttempts = async (recordId: string) => {
    setExpandedId(recordId);
    setAttemptsLoading(true);
    setAttempts([]);
    const { data, error: attemptError } = await supabase
      .from('workflow_email_attempts')
      .select('id, attempt_number, outcome, provider_message_id, error_message, created_at')
      .eq('outbox_id', recordId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (attemptError) {
      setError(`Could not load processing attempts: ${attemptError.message}`);
    } else {
      setAttempts((data ?? []) as EmailAttempt[]);
    }
    setAttemptsLoading(false);
  };

  const retryEmail = async (record: EmailRecord) => {
    if (!window.confirm(`Queue this failed email to ${record.recipient_email} for another attempt?`)) {
      return;
    }
    setRetryingId(record.id);
    setNotice('');
    const { data, error: retryError } = await supabase.rpc(
      'retry_workflow_email_job',
      { target_email_id: record.id }
    );
    if (retryError) {
      setError(`Could not retry email: ${retryError.message}`);
    } else if (data !== true) {
      setError('This email is no longer eligible for retry.');
    } else {
      setNotice('Email queued for another attempt.');
      await fetchEmails();
    }
    setRetryingId(null);
  };

  return (
    <div className="w-full">
      <header className="mb-8 max-md:mb-5">
        <p className="mb-3 text-[11px] font-medium text-muted-text">Admin workspace</p>
        <h1 className="font-serif text-[32px] leading-tight text-warm-text max-md:text-[26px]">
          Email monitoring
        </h1>
        <p className="mt-2 text-xs text-muted-text">
          Delivery status, retry history, and recipient-level search. Email bodies are not shown.
        </p>
      </header>

      <section aria-label="Email totals" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total" value={total} />
        <StatCard label="Queued" value={counts.queued} />
        <StatCard label="Pending retries" value={pendingRetries} />
        <StatCard label="Processing" value={counts.processing} />
        <StatCard label="Accepted" value={counts.accepted} />
        <StatCard label="Delivered" value={counts.delivered} />
        <StatCard label="Failed" value={counts.failed} />
        <StatCard label="Bounced" value={counts.bounced} />
        <StatCard label="Complaints" value={counts.complained} />
      </section>

      <section className="mb-5 grid gap-3 rounded-2xl border border-warm-border bg-card p-4 sm:grid-cols-[1fr_220px_auto]">
        <label className="sr-only" htmlFor="email-search">Search recipient email</label>
        <input
          id="email-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search recipient email"
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
          {statuses.map((status) => (
            <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
          ))}
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

      {notice && (
        <p role="status" className="mb-4 rounded-xl border border-approved-bg bg-approved-bg/50 px-4 py-3 text-xs text-approved-text">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs text-rejected-text">
          {error}
        </p>
      )}

      {loading ? (
        <div className="rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
          Loading email records...
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-2xl border border-warm-border bg-card py-16 text-center">
          <p className="font-serif text-2xl text-warm-text">No email records found</p>
          <p className="mt-2 text-xs text-muted-text">Try another recipient or status filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((record) => (
            <article key={record.id} className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase ${statusClasses(record.status)}`}>
                      {record.status}
                    </span>
                    <span className="text-[10px] text-muted-text">Attempts: {record.attempts}</span>
                  </div>
                  <p className="mt-3 break-all text-xs font-semibold text-warm-text">{record.recipient_email}</p>
                  <p className="mt-1 break-words text-xs text-muted-text">{record.subject}</p>
                  {record.last_error && (
                    <p className="mt-2 break-words text-xs text-rejected-text">{record.last_error}</p>
                  )}
                  <dl className="mt-3 grid gap-x-5 gap-y-1 text-[10px] text-muted-text sm:grid-cols-2 xl:grid-cols-4">
                    <div><dt className="inline font-semibold">Created: </dt><dd className="inline">{formatDate(record.created_at)}</dd></div>
                    <div><dt className="inline font-semibold">Accepted: </dt><dd className="inline">{formatDate(record.accepted_at || record.sent_at)}</dd></div>
                    <div><dt className="inline font-semibold">Delivered: </dt><dd className="inline">{formatDate(record.delivered_at)}</dd></div>
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
                  {record.status === 'failed' && record.is_retryable && (
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
                  <h2 className="mb-3 text-xs font-semibold text-warm-text">Processing attempts</h2>
                  {attemptsLoading ? (
                    <p className="text-xs text-muted-text">Loading attempts...</p>
                  ) : attempts.length === 0 ? (
                    <p className="text-xs text-muted-text">No attempt records found.</p>
                  ) : (
                    <div className="space-y-2">
                      {attempts.map((attempt) => (
                        <div key={attempt.id} className="rounded-xl bg-sidebar px-3 py-3 text-[11px]">
                          <div className="flex flex-wrap justify-between gap-2">
                            <span className="font-semibold text-warm-text">
                              Attempt {attempt.attempt_number} · {attempt.outcome.replaceAll('_', ' ')}
                            </span>
                            <span className="text-muted-text">{formatDate(attempt.created_at)}</span>
                          </div>
                          {attempt.error_message && <p className="mt-1 break-words text-rejected-text">{attempt.error_message}</p>}
                          {attempt.provider_message_id && (
                            <p className="mt-1 break-all text-muted-text">Provider message: {attempt.provider_message_id}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
          <p className="px-1 text-[10px] text-muted-text">
            Showing up to 50 matching records. Counts cover all email records.
          </p>
        </div>
      )}
    </div>
  );
}
