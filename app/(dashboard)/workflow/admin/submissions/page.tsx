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
    
    // Admin Stage Logic
    if (s === 'pending_admin') {
      return { label: 'PENDING ADMIN', color: 'text-blue-600', bg: 'bg-blue-50' };
    }
    if (s.includes('approved')) {
      return { label: 'APPROVED', color: 'text-green-600', bg: 'bg-green-50' };
    }
    if (s.includes('declined')) {
      return { label: 'DECLINED', color: 'text-red-600', bg: 'bg-red-50' };
    }
    
    // Default / Stage 01
    return { label: 'PENDING_APPROVER', color: 'text-orange-600', bg: 'bg-orange-50' };
  };

  const config = getDisplayConfig();

  return (
    <div className={`inline-flex items-center gap-2 border-2 border-current px-3 py-0.5 ${config.color} ${config.bg} ${fonts.mono} font-black shadow-[2px_2px_0px_0px_currentColor] text-[9px]`}>
      {config.label}
    </div>
  );
}

export default function SubmissionsPage() {
  const [filter, setFilter] = useState<FilterStatus>('all');
  const { submissions, loading } = useSubmissions();

  const filteredSubmissions = submissions.filter(sub => {
    const s = sub.status.toLowerCase();
    if (filter === 'all') return true;
    
    // The "Pending" filter now specifically looks for Admin Action
    if (filter === 'pending') return s === 'pending_admin'; 
    
    if (filter === 'approved') return s === 'approved';
    if (filter === 'declined') return s.includes('declined');
    return true;
  });

  const filters: { value: FilterStatus; label: string }[] = [
    { value: 'all', label: 'All Submissions' },
    { value: 'pending', label: 'Awaiting Admin' }, // Changed label for clarity
    { value: 'approved', label: 'Approved' },
    { value: 'declined', label: 'Declined' },
  ];

  return (
    <div className="space-y-10 pb-20">
      {/* Header Section */}
      <div className="border-b-4 border-gray-900 pb-8">
        <h1 className={`${fonts.serif} text-7xl font-light text-gray-900 leading-none tracking-tight`}>
          Master Logs
        </h1>
        <div className="flex items-center justify-between mt-4">
          <p className={`${fonts.mono} text-blue-600 font-bold`}>
            Global Archive // Level_02 Finalization
          </p>
          <p className={`${fonts.mono} text-gray-400 font-bold`}>
            Displaying: {filteredSubmissions.length} Records
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="space-y-3">
        <label className={`${fonts.mono} font-bold text-gray-900`}>Filter_Database_By_Status</label>
        <div className="flex flex-wrap gap-3">
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`border-2 px-6 py-2 text-[11px] font-bold transition-all uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 ${
                filter === f.value
                  ? 'bg-blue-600 text-white border-blue-900'
                  : 'bg-white text-gray-600 border-gray-900 hover:bg-gray-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-white border-2 border-gray-900 shadow-[10px_10px_0px_0px_rgba(37,99,235,0.1)] overflow-hidden">
        <div className="p-4 border-b-2 border-gray-900 bg-gray-50 flex items-center justify-between">
          <h2 className={`${fonts.mono} font-black text-gray-900`}>Archive_Index</h2>
          <div className="flex items-center gap-2">
            {loading && <span className={`${fonts.mono} text-blue-600 animate-pulse`}>Fetching...</span>}
            <div className="w-2 h-2 bg-blue-900 rounded-full animate-pulse" />
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="py-20 text-center border-b-2 border-gray-900">
               <span className={`${fonts.mono} text-gray-400 animate-pulse text-lg`}>SYNCING_DATABASE...</span>
            </div>
          ) : filteredSubmissions.length === 0 ? (
            <div className="py-20 text-center border-b-2 border-gray-900">
              <p className={`${fonts.mono} text-gray-400`}>Zero_Entries_Found</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`${fonts.mono} bg-gray-900 text-white`}>
                  <th className="p-5 font-bold">Document</th>
                  <th className="p-5 font-bold">Origin</th>
                  <th className="p-5 font-bold text-center">Status</th>
                  <th className="p-5 font-bold">Timestamp</th>
                  <th className="p-5 font-bold text-right">Utility</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-gray-900">
                {filteredSubmissions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-blue-50/30 transition-colors group">
                    <td className="p-5">
                      <div className="font-bold text-gray-900 underline decoration-blue-500/30 decoration-2 underline-offset-4 truncate max-w-[200px]">
                        {sub.file_name}
                      </div>
                      <div className="text-[10px] font-mono text-gray-400 mt-1 uppercase">TYPE: {sub.file_type}</div>
                    </td>
                    <td className="p-5">
                      <div className="font-bold text-gray-700 text-xs truncate max-w-[180px]">
                        {sub.profiles?.email ?? '—'}
                      </div>
                    </td>
                    <td className="p-5 text-center">
                      <StatusStamp status={sub.status} />
                    </td>
                    <td className="p-5">
                      <div className={`${fonts.mono} text-gray-600`}>
                        {new Date(sub.created_at).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="p-5 text-right">
                      <Link 
                        href={`/workflow/admin/submissions/${sub.id}`}
                        className={`${fonts.mono} inline-block bg-white border-2 border-gray-900 px-4 py-1.5 font-bold text-[10px] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 transition-all text-gray-900`}
                      >
                        Manage_Entry
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}