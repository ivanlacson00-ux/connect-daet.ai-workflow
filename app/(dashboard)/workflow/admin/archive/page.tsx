'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const fonts = {
  serif: 'font-serif italic',
  mono: 'font-mono uppercase tracking-[0.15em] text-[10px]',
};

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

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').toUpperCase();
}

export default function ArchiveRegistryPage() {
  const supabase = createClient();
  const [records, setRecords] = useState<ArchivedSubmission[]>([]);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);

  const fetchArchives = useCallback(async () => {
    setLoading(true);
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

  const filteredRecords = useMemo(() => records.filter((record) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query
      || record.file_name.toLowerCase().includes(query)
      || record.tracking_number?.toLowerCase().includes(query)
      || record.profiles?.email.toLowerCase().includes(query);
    const archivedDate = record.archived_at.slice(0, 10);
    const matchesFrom = !fromDate || archivedDate >= fromDate;
    const matchesTo = !toDate || archivedDate <= toDate;
    return matchesSearch && matchesFrom && matchesTo;
  }), [fromDate, records, search, toDate]);

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
    <div className="space-y-10 pb-20">
      <header className="border-b-4 border-gray-900 pb-8">
        <h1 className={`${fonts.serif} text-7xl font-light leading-none tracking-tight`}>Archive Registry</h1>
        <div className="mt-4 flex items-center justify-between">
          <p className={`${fonts.mono} font-bold text-blue-600`}>Secure Records // Administrator View</p>
          <p className={`${fonts.mono} text-gray-400`}>{filteredRecords.length} Archived Records</p>
        </div>
      </header>

      <section className="space-y-4 border-2 border-gray-900 bg-white p-6">
        <label className={`${fonts.mono} block font-bold`}>Search_Archive</label>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="File name, tracking number, or requester email"
          className="w-full border-2 border-gray-900 p-4 font-mono text-sm outline-none focus:border-blue-600"
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className={`${fonts.mono} flex flex-col gap-2`}>
            Archived_From
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="border-2 border-gray-900 p-3 font-mono text-xs normal-case tracking-normal" />
          </label>
          <label className={`${fonts.mono} flex flex-col gap-2`}>
            Archived_To
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="border-2 border-gray-900 p-3 font-mono text-xs normal-case tracking-normal" />
          </label>
        </div>
      </section>

      <section className="overflow-x-auto border-2 border-gray-900 bg-white">
        <table className="w-full text-left">
          <thead className={`${fonts.mono} bg-gray-900 text-white`}>
            <tr>
              <th className="p-4">Document</th>
              <th className="p-4">Requester</th>
              <th className="p-4">Workflow Status</th>
              <th className="p-4">Archived</th>
              <th className="p-4">Retention Until</th>
              <th className="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-gray-900">
            {loading ? (
              <tr><td colSpan={6} className="p-16 text-center font-mono">Loading_Archive...</td></tr>
            ) : filteredRecords.length === 0 ? (
              <tr><td colSpan={6} className="p-16 text-center font-mono text-gray-400">No_Archived_Records_Found</td></tr>
            ) : filteredRecords.map((record) => (
              <tr key={record.id} className="hover:bg-blue-50/30">
                <td className="p-4">
                  <Link href={`/workflow/admin/submissions/${record.id}`} className="font-bold underline decoration-blue-500/40 underline-offset-4">
                    {record.file_name}
                  </Link>
                  <p className="mt-1 font-mono text-[10px] text-blue-600">{record.tracking_number || 'TRACKING PENDING'}</p>
                  <p className="mt-1 font-mono text-[10px] text-gray-400">{record.category || 'GENERAL'} // {record.file_type || 'UNKNOWN TYPE'}</p>
                </td>
                <td className="p-4 text-xs font-bold">{record.profiles?.email || 'Requester unavailable'}</td>
                <td className="p-4 font-mono text-xs">{statusLabel(record.status)}</td>
                <td className="p-4 font-mono text-xs">{new Date(record.archived_at).toLocaleDateString()}</td>
                <td className="p-4 font-mono text-xs">{record.retention_until ? new Date(record.retention_until).toLocaleDateString() : 'Not specified'}</td>
                <td className="p-4 text-right">
                  <button onClick={() => restoreRecord(record)} disabled={restoring === record.id} className="border-2 border-black bg-white px-3 py-2 font-mono text-[10px] font-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50">
                    {restoring === record.id ? 'RESTORING...' : 'RESTORE'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
