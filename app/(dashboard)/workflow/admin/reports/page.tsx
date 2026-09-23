'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const fonts = {
  serif: 'font-serif italic',
  mono: 'font-mono uppercase tracking-[0.15em] text-[10px]',
};

interface SubmissionReportRow {
  tracking_number: string | null;
  file_name: string;
  status: string;
  created_at: string;
  updated_at: string;
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
      .select('tracking_number, file_name, status, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (queryError) {
      setError(queryError.message);
      setRows([]);
    } else {
      setRows(data || []);
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

  const exportCsv = () => {
    const header = ['Tracking Number', 'Document', 'Status', 'Submitted At', 'Last Updated'];
    const lines = filteredRows.map((row) => [
      row.tracking_number || '',
      row.file_name,
      statusLabels[row.status] || row.status,
      row.created_at,
      row.updated_at,
    ].map((value) => `"${value.replaceAll('"', '""')}"`).join(','));
    const csv = [header.join(','), ...lines].join('\r\n');
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
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-gray-900">
            {loading ? (
              <tr><td colSpan={5} className="p-12 text-center font-mono">Loading_Report...</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={5} className="p-12 text-center font-mono text-gray-400">No_Records_Found</td></tr>
            ) : filteredRows.map((row) => (
              <tr key={`${row.tracking_number}-${row.created_at}`}>
                <td className="p-4 font-mono text-blue-600">{row.tracking_number || 'TRACKING PENDING'}</td>
                <td className="p-4 font-bold">{row.file_name}</td>
                <td className="p-4 font-mono text-xs uppercase">{statusLabels[row.status] || row.status}</td>
                <td className="p-4 font-mono text-xs">{new Date(row.created_at).toLocaleString()}</td>
                <td className="p-4 font-mono text-xs">{new Date(row.updated_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
