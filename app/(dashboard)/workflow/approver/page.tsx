// app/(dashboard)/workflow/approver/page.tsx
'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';

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
    switch (status.toLowerCase()) {
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
    <div className={`inline-flex items-center gap-2 border-2 border-current px-4 py-1 rotate-[-1deg] ${config.color} ${config.bg} ${fonts.mono} font-black shadow-[3px_3px_0px_0px_currentColor]`}>
      <span className="text-lg">●</span>
      {config.label}
    </div>
  );
}

export default function ApproverDashboard() {
  const supabase = createClient();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);

  // ─── Data Metrics ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    return {
      pending: submissions.filter(s => s.status === 'pending').length,
      approved: submissions.filter(s => s.status === 'approved').length,
      declined: submissions.filter(s => s.status === 'declined').length,
    };
  }, [submissions]);

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("workflow_submissions")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) setSubmissions(data);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchSubmissions(); }, [fetchSubmissions]);

  const handleDownload = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  const handleAction = async (id: string | number, newStatus: 'approved' | 'declined') => {
    const { error } = await supabase
      .from("workflow_submissions")
      .update({ status: newStatus })
      .eq("id", id);
    
    if (!error) {
      setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s));
    }
  };

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-gray-900 relative pb-20">
      <div className="max-w-[1100px] mx-auto px-6 py-20">
        
        {/* Header Section */}
        <div className="mb-12 border-b-2 border-gray-900 pb-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h1 className={`${fonts.serif} text-7xl font-light text-gray-900 leading-none`}>Review Queue</h1>
              <p className={`${fonts.mono} mt-4 text-blue-600`}>Approver Authority // Gateway Verification</p>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-3 gap-4 md:w-72">
              <div className="bg-orange-50 border border-orange-200 p-3 text-center">
                <div className={`${fonts.mono} text-[8px] text-orange-500 mb-1`}>Pending</div>
                <div className="text-xl font-bold text-orange-600 leading-none">{stats.pending}</div>
              </div>
              <div className="bg-green-50 border border-green-200 p-3 text-center">
                <div className={`${fonts.mono} text-[8px] text-green-500 mb-1`}>Approved</div>
                <div className="text-xl font-bold text-green-600 leading-none">{stats.approved}</div>
              </div>
              <div className="bg-red-50 border border-red-200 p-3 text-center">
                <div className={`${fonts.mono} text-[8px] text-red-500 mb-1`}>Declined</div>
                <div className="text-xl font-bold text-red-600 leading-none">{stats.declined}</div>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className={`${fonts.mono} animate-pulse text-blue-600 flex items-center gap-2`}>
            <span className="w-2 h-2 bg-blue-600 rounded-full animate-ping" />
            [ Syncing Submissions ]
          </div>
        ) : (
          <div className="space-y-8">
            {submissions.map((sub) => (
              <article key={sub.id} className="bg-white border border-blue-600 p-8 transition-all hover:shadow-[10px_10px_0px_0px_rgba(37,99,235,1)] relative overflow-hidden group">
                <div className="absolute top-[-10px] right-[-10px] opacity-[0.03] pointer-events-none select-none text-8xl font-black uppercase">
                  {sub.status}
                </div>

                <div className="flex flex-col md:flex-row justify-between items-start gap-8 relative z-10">
                  <div className="space-y-4">
                    <div>
                      <div className={`${fonts.mono} text-blue-400 mb-1`}>Entry ID: {String(sub.id).slice(0,8)}</div>
                      <h3 className={`${fonts.serif} text-4xl text-gray-900 group-hover:text-blue-600 transition-colors`}>
                        {sub.file_name || "Untitled_File"}
                      </h3>
                      <p className={`${fonts.mono} text-gray-400 mt-2`}>
                        {sub.submitter_email} // {new Date(sub.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <StatusStamp status={sub.status} />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto self-end md:self-start">
                    <button 
                      onClick={() => setPreviewFile({ url: sub.file_url, name: sub.file_name })}
                      className={`${fonts.mono} bg-white border-2 border-gray-900 px-6 py-3 text-gray-900 hover:bg-gray-100 transition-all font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]`}>
                      Preview
                    </button>

                    <button 
                      onClick={() => handleDownload(sub.file_url, sub.file_name)}
                      className={`${fonts.mono} bg-gray-100 border-2 border-gray-300 px-4 py-3 hover:border-gray-900 transition-all font-bold`}>
                      Get File
                    </button>
                    
                    {sub.status === 'pending' && (
                      <div className="flex gap-3 border-l-2 border-gray-100 pl-3 ml-2">
                        <button 
                          onClick={() => handleAction(sub.id, 'approved')}
                          className={`${fonts.mono} bg-blue-600 text-white px-6 py-3 hover:bg-black transition-all font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]`}>
                          Approve
                        </button>
                        <button 
                          onClick={() => handleAction(sub.id, 'declined')}
                          className={`${fonts.mono} bg-white border-2 border-red-600 text-red-600 px-6 py-3 hover:bg-red-600 hover:text-white transition-all font-bold`}>
                          Decline
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}

            {submissions.length === 0 && (
              <div className="border-2 border-dashed border-gray-200 p-20 text-center">
                <p className={`${fonts.serif} text-2xl text-gray-400`}>No submissions found in system logs.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Preview Modal ───────────────────────────────────────────────────── */}
      {previewFile && (
        <div className="fixed inset-0 bg-black/95 z-[100] flex flex-col animate-in fade-in duration-200">
          <div className="px-6 py-4 flex justify-between items-center bg-black border-b border-white/10">
            <div className="flex flex-col">
              <span className={`${fonts.mono} text-blue-500 mb-0.5`}>Vault Preview</span>
              <h2 className="text-white text-lg font-medium truncate max-w-md">
                {previewFile.name}
              </h2>
            </div>
            
            <div className="flex items-center gap-4">
              <button 
                onClick={() => handleDownload(previewFile.url, previewFile.name)}
                className={`${fonts.mono} text-white/60 hover:text-white transition-colors px-4 py-2 text-[11px]`}
              >
                [ Download ]
              </button>
              <button 
                onClick={() => setPreviewFile(null)}
                className="text-white hover:text-red-500 transition-all p-2"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          
          <div className="flex-1 bg-[#1a1a1a]">
            <iframe
              title="Document Preview"
              className="w-full h-full border-none"
              src={`https://docs.google.com/gview?url=${encodeURIComponent(previewFile.url)}&embedded=true`}
            />
          </div>
        </div>
      )}
    </div>
  );
}