'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getWorkflowTiming } from '@/lib/workflow/timing';

const fonts = {
  serif: 'font-serif italic',
  mono: 'font-mono uppercase tracking-[0.15em] text-[10px]',
};

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
  pending: 'Under Verification',
  pending_approver: 'Under Verification',
  pending_admin: 'Pending Approval',
  approved: 'Approved',
  completed: 'Completed',
  declined_by_approver: 'Returned for Correction',
  declined_by_admin: 'Rejected',
};

export default function ReportsPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<SubmissionReportRow[]>([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
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

  const overdueCount = useMemo(
    () => filteredRows.filter((row) => getWorkflowTiming(row).state === 'overdue').length,
    [filteredRows]
  );

  const overdueByStage = useMemo(() => filteredRows
    .filter((row) => getWorkflowTiming(row).state === 'overdue')
    .reduce<Record<string, number>>((result, row) => {
      const stage = row.status === 'pending' || row.status === 'pending_approver'
        ? 'Verification'
        : row.status === 'pending_admin'
          ? 'Approval'
          : 'Completion';
      result[stage] = (result[stage] || 0) + 1;
      return result;
    }, {}), [filteredRows]);

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
    const header = ['Tracking Number', 'Document', 'Status', 'Submitted At', 'Last Updated'];
    const lines = filteredRows.map((row) => [
      row.tracking_number || '',
      row.file_name,
      statusLabels[row.status] || row.status,
      row.created_at,
      row.updated_at,
      row.auditLogs.length,
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
    const csv = [header.concat('Audit Events').join(','), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `workflow-report-${fromDate || 'all'}-${toDate || 'all'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const reportCards = [
    { label: 'Total Submissions', value: filteredRows.length },
    { label: 'Under Verification', value: (counts.pending || 0) + (counts.pending_approver || 0) },
    { label: 'Pending Approval', value: counts.pending_admin || 0 },
    { label: 'Completed', value: counts.completed || 0 },
    { label: 'Rejected / Returned', value: (counts.declined_by_admin || 0) + (counts.declined_by_approver || 0) },
    { label: 'Average Processing', value: averageProcessingHours === null ? 'N/A' : `${averageProcessingHours.toFixed(1)} h` },
    { label: 'Avg Verification', value: averageStageHours.verification === null ? 'N/A' : `${averageStageHours.verification.toFixed(1)} h` },
    { label: 'Avg Approval', value: averageStageHours.approval === null ? 'N/A' : `${averageStageHours.approval.toFixed(1)} h` },
    { label: 'Avg Completion', value: averageStageHours.completion === null ? 'N/A' : `${averageStageHours.completion.toFixed(1)} h` },
    { label: 'Overdue', value: overdueCount },
  ];

  return (
    <div className="space-y-10 pb-20">
      <header className="border-b-4 border-gray-900 pb-8">
        <h1 className={`${fonts.serif} text-7xl font-light leading-none tracking-tight`}>Reports</h1>
        <p className={`${fonts.mono} mt-4 text-blue-600 font-bold`}>Workflow Analytics // Administrator View</p>
      </header>

      <section className="bg-white border-2 border-gray-900 p-6 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className={`${fonts.mono} flex flex-col gap-2`}>
            From
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="border-2 border-gray-900 px-3 py-2 font-mono text-sm normal-case tracking-normal" />
          </label>
          <label className={`${fonts.mono} flex flex-col gap-2`}>
            To
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="border-2 border-gray-900 px-3 py-2 font-mono text-sm normal-case tracking-normal" />
          </label>
          <button onClick={exportCsv} disabled={loading || filteredRows.length === 0} className={`${fonts.mono} bg-blue-600 text-white border-2 border-blue-900 px-5 py-2 font-black disabled:opacity-40`}>
            Export_CSV
          </button>
        </div>
        {error && <p className="font-mono text-sm text-red-600">Report_Error: {error}</p>}
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-3 gap-5">
        {reportCards.map((card) => (
          <div key={card.label} className="bg-[#001f3f] border-4 border-blue-900 p-5 text-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <p className={`${fonts.mono} text-gray-400 mb-2`}>{card.label}</p>
            <p className="text-4xl font-black">{card.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="bg-white border-2 border-gray-900 p-5">
          <h2 className={`${fonts.mono} font-black mb-4`}>Overdue_By_Stage</h2>
          {Object.entries(overdueByStage).length === 0 ? <p className="font-mono text-xs text-gray-400">No overdue records</p> : Object.entries(overdueByStage).map(([stage, count]) => (
            <div key={stage} className="flex justify-between border-b border-gray-200 py-2 font-mono text-xs">
              <span>{stage}</span><strong>{count}</strong>
            </div>
          ))}
        </div>
        <div className="bg-white border-2 border-gray-900 p-5">
          <h2 className={`${fonts.mono} font-black mb-4`}>Volume_By_Category</h2>
          {Object.entries(categoryCounts).map(([category, count]) => (
            <div key={category} className="flex justify-between border-b border-gray-200 py-2 font-mono text-xs">
              <span>{category}</span><strong>{count}</strong>
            </div>
          ))}
        </div>
        <div className="bg-white border-2 border-gray-900 p-5">
          <h2 className={`${fonts.mono} font-black mb-4`}>Actions_By_Personnel</h2>
          {Object.entries(personnelCounts).length === 0 ? <p className="font-mono text-xs text-gray-400">No personnel actions</p> : Object.entries(personnelCounts).map(([name, count]) => (
            <div key={name} className="flex justify-between border-b border-gray-200 py-2 font-mono text-xs">
              <span className="truncate pr-2">{name}</span><strong>{count}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border-2 border-gray-900 overflow-x-auto">
        <div className="p-4 border-b-2 border-gray-900">
          <h2 className={`${fonts.mono} font-black`}>Submission_Report // {filteredRows.length} Records</h2>
        </div>
        <table className="w-full text-left">
          <thead className={`${fonts.mono} bg-gray-900 text-white`}>
            <tr>
              <th className="p-4">Tracking Number</th>
              <th className="p-4">Document</th>
              <th className="p-4">Stage</th>
              <th className="p-4">Submitted</th>
              <th className="p-4">Updated</th>
              <th className="p-4">Audit Events</th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-gray-900">
            {loading ? (
              <tr><td colSpan={6} className="p-12 text-center font-mono">Loading_Report...</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={6} className="p-12 text-center font-mono text-gray-400">No_Records_Found</td></tr>
            ) : filteredRows.map((row) => (
              <tr key={`${row.tracking_number}-${row.created_at}`}>
                <td className="p-4 font-mono text-blue-600">{row.tracking_number || 'TRACKING PENDING'}</td>
                <td className="p-4 font-bold">{row.file_name}</td>
                <td className="p-4 font-mono text-xs uppercase">{statusLabels[row.status] || row.status}</td>
                <td className="p-4 font-mono text-xs">{new Date(row.created_at).toLocaleString()}</td>
                <td className="p-4 font-mono text-xs">{new Date(row.updated_at).toLocaleString()}</td>
                <td className="p-4 font-mono text-xs">{row.auditLogs.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
