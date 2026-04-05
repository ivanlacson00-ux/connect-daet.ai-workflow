'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAdminStats } from '@/hooks/useAdminStats';

// ─── Styles ──────────────────────────────────────────────────────────────────
const fonts = {
  serif: "font-serif italic",
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

interface Submission {
  id: string | number;
  file_name: string;
  file_url: string;
  status: string;
  user_id: string;
  submitter_email?: string;
  created_at: string;
}

// ─── Status Stamp ────────────────────────────────────────────────────────────
function StatusStamp({ status }: { status: string }) {
  const getDisplayConfig = () => {
    switch (status?.toLowerCase()) {
      case 'approved':
        return { label: 'APPROVED', color: 'text-green-600', bg: 'bg-green-50' };
      case 'declined':
        return { label: 'DECLINED', color: 'text-red-600', bg: 'bg-red-50' };
      default:
        return { label: 'PENDING', color: 'text-orange-600', bg: 'bg-orange-50' };
    }
  };

  const config = getDisplayConfig();

  return (
    <div className={`inline-flex items-center gap-2 border-2 border-current px-3 py-0.5 ${config.color} ${config.bg} ${fonts.mono} font-black shadow-[2px_2px_0px_0px_currentColor] text-[9px]`}>
      {config.label}
    </div>
  );
}

export default function AdminDashboard() {
  const supabase = createClient();
  const { stats: adminStats } = useAdminStats();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);

  // ─── Stat Cards Data ───────────────────────────────────────────────────────
  const pendingCount = (adminStats.pendingApprover || 0) + (adminStats.pendingAdmin || 0);
  const declinedCount = (adminStats.declinedByApprover || 0) + (adminStats.declinedByAdmin || 0);

  const statCards = [
    { label: 'Total Users', value: adminStats.totalUsers },
    { label: 'Pending',    value: pendingCount },
    { label: 'Approved',   value: adminStats.approved },
    { label: 'Declined',   value: declinedCount },
  ];

<<<<<<< HEAD
=======
  // ─── Data Fetching ──────────────────────────────────────────────────────────
  const fetchRecentSubmissions = useCallback(async () => {
    setLoading(true);
    const { data: subs, error: subError } = await supabase
      .from("workflow_submissions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    if (subError) {
      setLoading(false);
      return;
    }

    const { data: profs } = await supabase.from("profiles").select("id, email");

    const mergedData = subs.map((sub: any) => {
      const userProfile = profs?.find(p => p.id === sub.user_id);
      return {
        ...sub,
        submitter_email: userProfile ? userProfile.email : "Unknown Sender"
      };
    });

    setSubmissions(mergedData);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchRecentSubmissions(); }, [fetchRecentSubmissions]);

  const handleDownload = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const link = document.body.appendChild(document.createElement('a'));
      link.href = window.URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      link.remove();
    } catch (e) { console.error("Download error", e); }
  };

  const isImage = (fileName: string) => /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(fileName);

>>>>>>> origin
  return (
    <div className="space-y-12 pb-20">
      {/* Header Section */}
      <div className="border-b-4 border-gray-900 pb-8">
        <h1 className={`${fonts.serif} text-7xl font-light text-gray-900 leading-none tracking-tight`}>
          Admin Hub
        </h1>
        <p className={`${fonts.mono} mt-4 text-blue-600 font-bold`}>
          System Diagnostics // Node Status: Online
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card) => (
          <div key={card.label} className="bg-[#001f3f] border-4 border-blue-900 p-6 text-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
            <p className={`${fonts.mono} text-gray-400 opacity-90 leading-tight mb-2 text-[9px] font-bold`}>{card.label}</p>
            <p className="text-5xl font-black leading-none tracking-tighter">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Recent Submissions Table */}
      <div className="bg-white border-2 border-gray-900 shadow-[10px_10px_0px_0px_rgba(37,99,235,0.1)] overflow-hidden">
        <div className="p-4 border-b-2 border-gray-900 bg-gray-50 flex items-center justify-between">
          <h2 className={`${fonts.mono} font-black text-gray-900`}>Recent_Entry_Log</h2>
          <div className="flex items-center gap-2">
            {loading && <span className={`${fonts.mono} text-blue-600 animate-pulse`}>Syncing...</span>}
            <div className="w-2 h-2 bg-blue-900 rounded-full animate-pulse" />
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className={`${fonts.mono} bg-gray-900 text-white`}>
                <th className="p-5 font-bold">Document</th>
                <th className="p-5 font-bold">Origin</th>
                <th className="p-5 font-bold text-center">Status</th>
                <th className="p-5 font-bold text-right">Utility</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-gray-900">
              {submissions.map((sub) => (
                <tr key={sub.id} className="hover:bg-blue-50/50 transition-colors group">
                  <td className="p-5">
                    <div className={`${fonts.mono} text-blue-400 text-[8px] mb-0.5`}>ID: #{String(sub.id).slice(0,6)}</div>
                    <div className="font-bold text-gray-900 truncate max-w-[220px]">{sub.file_name}</div>
                    <div className={`${fonts.mono} text-[8px] text-gray-400 mt-1`}>Logged: {new Date(sub.created_at).toLocaleDateString()}</div>
                  </td>
                  <td className="p-5">
                    <div className="text-xs font-black text-gray-700">{sub.submitter_email}</div>
                  </td>
                  <td className="p-5 text-center">
                    <StatusStamp status={sub.status} />
                  </td>
                  <td className="p-5 text-right">
                    <div className="flex justify-end gap-3">
                      <button 
                        onClick={() => setPreviewFile({ url: sub.file_url, name: sub.file_name })} 
                        className="p-2 border border-gray-200 hover:border-blue-600 hover:text-blue-600 transition-all bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,0.05)] hover:shadow-none"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      </button>
                      <button 
                        onClick={() => handleDownload(sub.file_url, sub.file_name)} 
                        className="p-2 border border-gray-200 hover:border-gray-900 text-gray-400 hover:text-gray-900 transition-all bg-white"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 bg-black/95 z-[100] flex flex-col animate-in fade-in duration-300">
          <div className="px-6 py-4 flex justify-between items-center border-b-2 border-white/10 bg-black">
            <div className="flex flex-col text-white">
              <span className={`${fonts.mono} text-blue-500 mb-0.5`}>Vault_Preview_Engine</span>
              <h2 className="text-lg font-medium">{previewFile.name}</h2>
            </div>
            <button onClick={() => setPreviewFile(null)} className="text-white hover:text-red-500 transition-all p-2">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-hidden bg-[#1a1a1a]">
            {isImage(previewFile.name) ? (
              <img src={previewFile.url} alt="Preview" className="max-w-full max-h-full object-contain p-8 animate-in zoom-in-95" />
            ) : (
              <iframe className="w-full h-full border-none bg-white" src={`https://docs.google.com/gview?url=${encodeURIComponent(previewFile.url)}&embedded=true`} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}