'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getWorkflowTiming } from '@/lib/workflow/timing';

// ─── Styles ──────────────────────────────────────────────────────────────────
const fonts = {
  serif: 'font-serif',
};

const fieldClasses =
  'h-11 w-full rounded-full border border-warm-border bg-card px-4 text-xs text-warm-text caret-current outline-none transition-colors focus:border-clay';

interface SubmissionReportRow {
  id: string;
  tracking_number: string | null;
  file_name: string;
  category: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  current_stage_due_at: string | null;
  current_responsible_role: string | null;
  auditLogs: {
    action_type: string;
    created_at: string;
    profiles?: { full_name: string | null; email: string; role: string } | null;
  }[];
}

const statusLabels: Record<string, string> = {
  pending: 'Under verification',
  pending_approver: 'Under verification',
  pending_admin: 'Pending approval',
  approved: 'Approved',
  completed: 'Completed',
  declined_by_approver: 'Returned for correction',
  declined_by_admin: 'Rejected',
};

const getStatusClasses = (status: string) => {
  const s = (status || '').toLowerCase();
  if (s === 'pending' || s === 'pending_approver') return 'bg-pending-bg text-pending-text';
  if (s === 'pending_admin') return 'bg-review-bg text-review-text';
  if (s === 'approved' || s === 'completed') return 'bg-approved-bg text-approved-text';
  if (s.includes('declined') || s === 'rejected') return 'bg-rejected-bg text-rejected-text';
  return 'bg-sidebar text-muted-text';
};

// ─── Small building blocks ───────────────────────────────────────────────────
function StatCard({ label, value, alert = false }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 max-md:p-3.5 ${alert ? 'border-rejected-bg bg-rejected-bg/50' : 'border-warm-border bg-card'}`}>
      <p className="mb-2 text-[11px] font-medium text-muted-text">{label}</p>
      <p className={`${fonts.serif} text-[32px] leading-none max-md:text-[26px] ${alert ? 'text-rejected-text' : 'text-warm-text'}`}>{value}</p>
    </div>
  );
}

function BreakdownCard({
  title,
  entries,
  emptyText,
}: {
  title: string;
  entries: [string, number][];
  emptyText?: string;
}) {
  return (
    <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
      <p className="mb-4 text-xs font-semibold text-warm-text">{title}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-text">{emptyText || 'No data'}</p>
      ) : (
        <div className="divide-y divide-warm-border">
          {entries.map(([name, count]) => (
            <div key={name} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="truncate text-xs text-warm-text">{name}</span>
              <span className="rounded-md bg-sidebar px-2 py-1 text-[10px] font-semibold text-muted-text">{count}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ReportsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SubmissionReportRow[]>([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    setError(null);

    const { data, error: queryError } = await supabase
      .from('workflow_submissions')
      .select('id, tracking_number, file_name, category, status, created_at, updated_at, current_stage_due_at, current_responsible_role, workflow_audit_logs(action_type, created_at, profiles:action_by(full_name, email, role))')
      .order('created_at', { ascending: false });

    if (queryError) {
      setError(queryError.message);
      setRows([]);
    } else {
      setRows((data || []).map((row) => ({
        ...row,
        auditLogs: (row.workflow_audit_logs || []).map((log) => ({
          ...log,
          profiles: Array.isArray(log.profiles) ? log.profiles[0] || null : log.profiles,
        })),
      })));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    const createdDate = row.created_at.slice(0, 10);
    return (!fromDate || createdDate >= fromDate) && (!toDate || createdDate <= toDate);
  }), [fromDate, rows, toDate]);

  const counts = useMemo(() => filteredRows.reduce<Record<string, number>>((result, row) => {
    result[row.status] = (result[row.status] || 0) + 1;
    return result;
  }, {}), [filteredRows]);

  const averageProcessingHours = useMemo(() => {
    const completed = filteredRows.filter((row) => row.status === 'completed');
    if (completed.length === 0) return null;
    const totalHours = completed.reduce((total, row) => {
      return total + (new Date(row.updated_at).getTime() - new Date(row.created_at).getTime()) / 3600000;
    }, 0);
    return totalHours / completed.length;
  }, [filteredRows]);

  const averageStageHours = useMemo(() => {
    const completed = filteredRows.filter((row) => row.status === 'completed');
    if (completed.length === 0) return { verification: null, approval: null, completion: null };

    let verificationTotal = 0;
    let approvalTotal = 0;
    let completionTotal = 0;
    let verificationCount = 0;
    let approvalCount = 0;
    let completionCount = 0;

    completed.forEach((row) => {
      const submitted = row.auditLogs.find((log) => log.action_type === 'SUBMITTED');
      const verified = row.auditLogs.find((log) => log.action_type === 'VERIFICATION_PASSED');
      const approved = row.auditLogs.find((log) => log.action_type === 'FINAL_APPROVAL');
      const completedEvent = row.auditLogs.find((log) => log.action_type === 'WORKFLOW_COMPLETED');
      if (submitted && verified) {
        verificationTotal += (new Date(verified.created_at).getTime() - new Date(submitted.created_at).getTime()) / 3600000;
        verificationCount += 1;
      }
      if (verified && approved) {
        approvalTotal += (new Date(approved.created_at).getTime() - new Date(verified.created_at).getTime()) / 3600000;
        approvalCount += 1;
      }
      if (approved && completedEvent) {
        completionTotal += (new Date(completedEvent.created_at).getTime() - new Date(approved.created_at).getTime()) / 3600000;
        completionCount += 1;
      }
    });

    return {
      verification: verificationCount ? verificationTotal / verificationCount : null,
      approval: approvalCount ? approvalTotal / approvalCount : null,
      completion: completionCount ? completionTotal / completionCount : null,
    };
  }, [filteredRows]);

  // Overdue rows are computed once and reused for both the count and the stage breakdown
  const overdueRows = useMemo(
    () => filteredRows.filter((row) => getWorkflowTiming(row).state === 'overdue'),
    [filteredRows]
  );

  const overdueByStage = useMemo(() => overdueRows.reduce<Record<string, number>>((result, row) => {
    const stage = row.status === 'pending' || row.status === 'pending_approver'
      ? 'Verification'
      : row.status === 'pending_admin'
        ? 'Approval'
        : 'Completion';
    result[stage] = (result[stage] || 0) + 1;
    return result;
  }, {}), [overdueRows]);

  const categoryCounts = useMemo(() => filteredRows.reduce<Record<string, number>>((result, row) => {
    const category = row.category || 'General';
    result[category] = (result[category] || 0) + 1;
    return result;
  }, {}), [filteredRows]);

  const personnelCounts = useMemo(() => filteredRows
    .flatMap((row) => row.auditLogs
      .filter((log) => ['VERIFICATION_PASSED', 'FINAL_APPROVAL', 'WORKFLOW_COMPLETED'].includes(log.action_type))
      .map((log) => log.profiles?.full_name || log.profiles?.email || 'Unknown personnel'))
    .reduce<Record<string, number>>((result, name) => {
      result[name] = (result[name] || 0) + 1;
      return result;
    }, {}), [filteredRows]);

  const exportCsv = () => {
    const header = ['Tracking Number', 'Document', 'Status', 'Submitted At', 'Last Updated', 'Audit Events'];
    const lines = filteredRows.map((row) => [
      row.tracking_number || '',
      row.file_name,
      statusLabels[row.status] || row.status,
      row.created_at,
      row.updated_at,
      row.auditLogs.length,
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
    const csv = [header.join(','), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `workflow-report-${fromDate || 'all'}-${toDate || 'all'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const formatHours = (value: number | null) => (value === null ? 'N/A' : `${value.toFixed(1)} h`);

  const reportCards = [
    { label: 'Total submissions', value: filteredRows.length },
    { label: 'Under verification', value: (counts.pending || 0) + (counts.pending_approver || 0) },
    { label: 'Pending approval', value: counts.pending_admin || 0 },
    { label: 'Completed', value: counts.completed || 0 },
    { label: 'Rejected / returned', value: (counts.declined_by_admin || 0) + (counts.declined_by_approver || 0) },
    { label: 'Average processing', value: formatHours(averageProcessingHours) },
    { label: 'Avg verification', value: formatHours(averageStageHours.verification) },
    { label: 'Avg approval', value: formatHours(averageStageHours.approval) },
    { label: 'Avg completion', value: formatHours(averageStageHours.completion) },
    { label: 'Overdue', value: overdueRows.length, alert: overdueRows.length > 0 },
  ];

  const hasDateFilter = !!fromDate || !!toDate;

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-8 max-md:mb-5">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Admin workspace
        </p>
        <h1 className={`${fonts.serif} text-[32px] leading-tight text-warm-text max-md:text-[26px]`}>Reports</h1>
        <p className="mt-2 text-xs text-muted-text max-md:mt-1.5">
          Workflow analytics. Covering <span className="text-warm-text">{filteredRows.length}</span> submissions.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 max-md:mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="report-from" className="mb-1.5 block text-[11px] font-medium text-muted-text">From</label>
            <input id="report-from" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className={fieldClasses} />
          </div>
          <div>
            <label htmlFor="report-to" className="mb-1.5 block text-[11px] font-medium text-muted-text">To</label>
            <input id="report-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className={fieldClasses} />
          </div>
          <div className="flex items-end gap-3 sm:col-span-2 max-md:flex-col max-md:items-stretch">
            <button
              onClick={exportCsv}
              disabled={loading || filteredRows.length === 0}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:opacity-50 sm:flex-none"
            >
              Export CSV
            </button>
            {hasDateFilter && (
              <button
                onClick={() => { setFromDate(''); setToDate(''); }}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-full border border-warm-border px-6 text-xs font-medium text-warm-text transition-colors hover:bg-sidebar sm:flex-none"
              >
                Clear dates
              </button>
            )}
          </div>
        </div>
        {error && (
          <p className="mt-3 rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text">
            Could not load the report: {error}
          </p>
        )}
      </div>

      {/* Stat cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {reportCards.map((card) => (
          <StatCard key={card.label} label={card.label} value={card.value} alert={card.alert} />
        ))}
      </div>

      {/* Breakdowns */}
      <div className="mb-8 grid grid-cols-1 gap-3 lg:grid-cols-3 max-md:mb-5">
        <BreakdownCard title="Overdue by stage" entries={Object.entries(overdueByStage)} emptyText="No overdue records" />
        <BreakdownCard title="Volume by category" entries={Object.entries(categoryCounts)} emptyText="No submissions" />
        <BreakdownCard title="Actions by personnel" entries={Object.entries(personnelCounts)} emptyText="No personnel actions" />
      </div>

      {/* Report list header */}
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-warm-text">Submission report</h2>
        <span className="rounded-md bg-sidebar px-2 py-1 text-[10px] font-medium text-muted-text">{filteredRows.length}</span>
      </div>

      {/* Report table */}
      {loading ? (
        <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
          <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Loading report...
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-2xl border border-warm-border bg-card py-16 text-center">
          <p className={`${fonts.serif} text-2xl text-warm-text`}>Nothing here</p>
          <p className="mt-2 text-xs text-muted-text">No records found for this date range.</p>
          {hasDateFilter && (
            <button
              onClick={() => { setFromDate(''); setToDate(''); }}
              className="mt-5 inline-flex h-10 items-center rounded-full border border-warm-border px-5 text-xs font-medium text-warm-text transition-colors hover:bg-sidebar max-md:h-11"
            >
              Clear dates
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-warm-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-warm-border bg-sidebar text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">
                  <th className="px-5 py-3 max-md:px-3.5">Tracking number</th>
                  <th className="px-5 py-3 max-md:px-3.5">Document</th>
                  <th className="px-5 py-3 max-md:px-3.5">Stage</th>
                  <th className="px-5 py-3 max-md:px-3.5">Submitted</th>
                  <th className="px-5 py-3 max-md:px-3.5">Updated</th>
                  <th className="px-5 py-3 text-right max-md:px-3.5">Audit events</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-border">
                {filteredRows.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-sidebar/50">
                    <td className="whitespace-nowrap px-5 py-4 text-[11px] font-semibold text-clay max-md:px-3.5">
                      {row.tracking_number || 'Tracking pending'}
                    </td>
                    <td className="max-w-[260px] px-5 py-4 max-md:px-3.5">
                      <p className="truncate text-sm font-semibold text-warm-text">{row.file_name}</p>
                    </td>
                    <td className="px-5 py-4 max-md:px-3.5">
                      <span className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-medium ${getStatusClasses(row.status)}`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                        {statusLabels[row.status] || row.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-[11px] text-muted-text max-md:px-3.5">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-[11px] text-muted-text max-md:px-3.5">
                      {new Date(row.updated_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-4 text-right max-md:px-3.5">
                      <span className="rounded-md bg-sidebar px-2 py-1 text-[10px] font-semibold text-muted-text">{row.auditLogs.length}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}