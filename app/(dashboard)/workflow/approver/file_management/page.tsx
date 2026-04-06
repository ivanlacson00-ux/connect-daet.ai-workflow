'use client';

import { useState } from 'react';
import { useSubmissions } from '@/hooks/useSubmissions';
import Link from 'next/link';

const fonts = {
  serif: "font-serif italic",
  mono: "font-mono uppercase tracking-[0.15em] text-[10px]",
};

type FilterStatus = 'all' | 'pending' | 'approved' | 'declined';

function StatusStamp({ status }: { status: string }) {
  const getDisplayConfig = () => {
    const s = status?.toLowerCase();
    // If it's pending_admin, it's awaiting Level 02 (You)
    if (s === 'pending_admin') return { label: 'PENDING ADMIN', color: 'text-blue-600', bg: 'bg-blue-50' };
    if (s.includes('approved')) return { label: 'APPROVED', color: 'text-green-600', bg: 'bg-green-50' };
    if (s.includes('declined')) return { label: 'DECLINED', color: 'text-red-600', bg: 'bg-red-50' };
    // Otherwise it's still with the initial reviewers
    return { label: 'STAGE 01', color: 'text-orange-600', bg: 'bg-orange-50' };
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
    if (filter === 'pending') return s === 'pending_admin'; // Only show what Admin needs to sign
    if (filter === 'approved') return s === 'approved';
    if (filter === 'declined') return s.includes('declined');
    return true;
  });

  const filters: { value: FilterStatus; label: string }[] = [
    { value: 'all', label: 'All Records' },
    { value: 'pending', label: 'Awaiting Admin' },
    { value: 'approved', label: 'Completed' },
    { value: 'declined', label: 'Rejected' },
  ];

  return (
    <div className="space-y-10 pb-20 p-8 bg-[#fafafa] min-h-screen">
      <div className="border-b-4 border-gray-900 pb-8">
        <h1 className={`${fonts.serif} text-7xl font-light text-gray-900 leading-none tracking-tight`}>
          Master Logs
        </h1>
        <div className="flex items-center justify-between mt-4">
          <p className={`${fonts.mono} text-blue-600 font-bold`}>
            Global Archive // Level_02 Authority
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`border-2 px-6 py-2 text-[11px] font-bold transition-all uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${
              filter === f.value ? 'bg-blue-600 text-white border-blue-900' : 'bg-white text-gray-600 border-gray-900'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white border-2 border-gray-900 shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className={`${fonts.mono} bg-gray-900 text-white`}>
              <th className="p-5">Document</th>
              <th className="p-5">Origin</th>
              <th className="p-5 text-center">Current_Stamp</th>
              <th className="p-5 text-right">Utility</th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-gray-900">
            {loading ? (
               <tr><td colSpan={4} className="p-20 text-center animate-pulse font-mono">SYNCING_DATABASE...</td></tr>
            ) : filteredSubmissions.map((sub) => (
              <tr key={sub.id} className="hover:bg-blue-50/30 transition-colors">
                <td className="p-5 font-bold">{sub.file_name}</td>
                <td className="p-5 text-xs text-gray-500">{sub.profiles?.email}</td>
                <td className="p-5 text-center"><StatusStamp status={sub.status} /></td>
                <td className="p-5 text-right">
                  <Link href={`/workflow/admin/submissions/${sub.id}`} className={`${fonts.mono} border-2 border-black px-4 py-1.5 font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]`}>
                    Manage
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