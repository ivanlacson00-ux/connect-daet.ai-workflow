'use client';

import { useState } from 'react';
import { useSubmissions } from '@/hooks/useSubmissions';
import Link from 'next/link';

const fonts = {
  serif: "font-serif italic",
  mono: "font-mono uppercase tracking-[0.15em] text-[10px]",
};

type FilterStatus = 'all' | 'pending' | 'approved' | 'declined';

// ─── Status Stamp Component ──────────────────────────────────────────────────
function StatusStamp({ status }: { status: string }) {
  const getDisplayConfig = () => {
    const s = status?.toLowerCase();
    
    // For Approvers, pending_admin means they have already done their part
    if (s === 'pending_admin') return { label: 'PENDING APPROVAL', color: 'text-blue-600', bg: 'bg-blue-50' };
    if (s === 'completed') return { label: 'COMPLETED', color: 'text-green-700', bg: 'bg-green-100' };
    if (s.includes('approved')) return { label: 'APPROVED', color: 'text-green-600', bg: 'bg-green-50' };
    if (s.includes('declined')) return { label: 'DECLINED', color: 'text-red-600', bg: 'bg-red-50' };
    
    // Standard pending status means it's sitting in the Approver's inbox
    return { label: 'UNDER VERIFICATION', color: 'text-orange-600', bg: 'bg-orange-50' };
  };

  const config = getDisplayConfig();

  return (
    <div className={`inline-flex items-center gap-2 border-2 border-current px-3 py-0.5 ${config.color} ${config.bg} ${fonts.mono} font-black shadow-[2px_2px_0px_0px_currentColor] text-[9px]`}>
      {config.label}
    </div>
  );
}

export default function ApproverSubmissionsPage() {
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const { submissions, loading } = useSubmissions();

  const filteredSubmissions = submissions.filter(sub => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch = !query
      || sub.file_name.toLowerCase().includes(query)
      || sub.tracking_number?.toLowerCase().includes(query);
    if (!matchesSearch) return false;

    const s = sub.status.toLowerCase();
    if (filter === 'all') return true;
    
    // For Approvers, "Pending" filter should show items waiting for THEM
    if (filter === 'pending') return s === 'pending'; 
    
    if (filter === 'approved') return s === 'approved' || s === 'pending_admin';
    if (filter === 'declined') return s.includes('declined');
    return true;
  });

  const filters: { value: FilterStatus; label: string }[] = [
    { value: 'all', label: 'All Records' },
    { value: 'pending', label: 'My Queue' },
    { value: 'approved', label: 'Cleared' },
    { value: 'declined', label: 'Rejected' },
  ];

  return (
    <div className="space-y-10 pb-20 p-8 bg-[#fafafa] min-h-screen">
      {/* Header Section */}
      <div className="border-b-4 border-gray-900 pb-8">
        <h1 className={`${fonts.serif} text-7xl font-light text-gray-900 leading-none tracking-tight`}>
          File Registry
        </h1>
        <div className="flex items-center justify-between mt-4">
          <p className={`${fonts.mono} text-orange-600 font-bold`}>
            Stage_01 // Internal Review Queue
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="relative">
        <label className={`${fonts.mono} block mb-2 font-bold text-gray-900`}>Search_By_File_Or_Tracking_Number</label>
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="DAET-2026-000001 or document name"
          className="w-full border-2 border-gray-900 bg-white px-5 py-4 font-mono text-sm outline-none focus:border-orange-500"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`border-2 px-6 py-2 text-[11px] font-bold transition-all uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 ${
              filter === f.value 
                ? 'bg-orange-500 text-white border-orange-900' 
                : 'bg-white text-gray-600 border-gray-900'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white border-2 border-gray-900 shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className={`${fonts.mono} bg-gray-900 text-white`}>
              <th className="p-5">Document</th>
              <th className="p-5">Origin</th>
              <th className="p-5 text-center">Status_Stamp</th>
              <th className="p-5 text-right">Utility</th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-gray-900">
            {loading ? (
               <tr><td colSpan={4} className="p-20 text-center animate-pulse font-mono uppercase">Syncing_Records...</td></tr>
            ) : filteredSubmissions.length === 0 ? (
               <tr><td colSpan={4} className="p-20 text-center font-mono text-gray-400">Zero_Entries_Found</td></tr>
            ) : filteredSubmissions.map((sub) => (
              <tr key={sub.id} className="hover:bg-orange-50/30 transition-colors group">
                <td className="p-5">
                  <div className="font-bold text-gray-900 underline decoration-orange-500/30 decoration-2 underline-offset-4">
                    {sub.file_name}
                  </div>
                  <div className="text-[10px] font-mono text-orange-600 mt-1 uppercase">{sub.tracking_number || 'TRACKING PENDING'}</div>
                  <div className="text-[10px] font-mono text-gray-400 mt-1 uppercase">LOGGED: {new Date(sub.created_at).toLocaleDateString()}</div>
                </td>
                <td className="p-5 text-xs font-black text-gray-700">{sub.profiles?.email ?? 'Unknown'}</td>
                <td className="p-5 text-center"><StatusStamp status={sub.status} /></td>
                <td className="p-5 text-right">
                  <Link 
                    href={`/workflow/approver/file_management/${sub.id}`} 
                    className={`${fonts.mono} border-2 border-black bg-white px-4 py-1.5 font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 transition-all inline-block`}
                  >
                    Open_File
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}