'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// ─── Styles ──────────────────────────────────────────────────────────────────
const fonts = {
  serif: "font-serif italic", 
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

interface Submission {
  id: string;
  file_name: string;
  file_url: string;
  file_size: number;
  file_type: string;
  status: string;
  approver_comments: string;
  admin_comments: string;
  created_at: string;
  updated_at: string;
}

// ─── Status Stamp ─────────────────────────────────────────────────────────────
function StatusStamp({ status }: { status: string }) {
  const getDisplayConfig = () => {
    const s = status.toLowerCase();

    // 1. Approved by Admin
    if (s === 'approved') {
      return { label: 'APPROVED', color: 'text-green-600', bg: 'bg-green-50' };
    }

    // 2. Passed Approver gate, waiting for Admin
    if (s === 'pending_admin') {
      return { label: 'AWAITING FINAL REVIEW', color: 'text-blue-600', bg: 'bg-blue-50' };
    }

    // 3. Rejected by either role
    if (s.includes('declined') || s.includes('rejected')) {
      return { label: 'REJECTED', color: 'text-red-600', bg: 'bg-red-50' };
    }

    // 4. Initial state (pending / pending_approver)
    return { label: 'PENDING', color: 'text-orange-600', bg: 'bg-orange-50' };
  };

  const config = getDisplayConfig();

  return (
    <div className={`inline-flex items-center gap-2 border-[1.5px] border-current px-3 py-1 rotate-[-1deg] ${config.color} ${config.bg} ${fonts.mono} font-black shadow-[2px_2px_0px_0px_currentColor]`}>
      <span className="text-[10px]">●</span>
      <span className="text-[10px] tracking-widest">{config.label}</span>
    </div>
  );
}

// ─── Submission Card ──────────────────────────────────────────────────────────
function SubmissionCard({ sub, onPreview }: { sub: Submission; onPreview: (s: Submission) => void }) {
  const router = useRouter();
  const isRejected = sub.status.includes('declined') || sub.status.includes('rejected');

  return (
    <article className="bg-white border border-blue-600 p-8 transition-all duration-300 hover:shadow-[8px_8px_0px_0px_rgba(37,99,235,1)] group mb-8 relative overflow-hidden">
      <div className="absolute top-[-20px] right-[-20px] opacity-[0.03] pointer-events-none select-none">
        <h4 className="text-9xl font-black uppercase">{sub.status.split('_')[0]}</h4>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start gap-8 relative z-10">
        <div className="flex-1 space-y-4">
          <div>
            <div className={`${fonts.mono} text-blue-400 mb-1`}>Ref_ID: {sub.id.slice(0, 12)}</div>
            <h3 className={`${fonts.serif} text-4xl text-gray-900 group-hover:text-blue-600 transition-colors`}>
              {sub.file_name}
            </h3>
            <p className={`${fonts.mono} text-gray-400 mt-2`}>
              {new Date(sub.created_at).toLocaleDateString()}
            </p>
          </div>

          <StatusStamp status={sub.status} />
        </div>

        <div className="flex flex-col gap-3 w-full md:w-auto shrink-0">
          <button 
            onClick={() => onPreview(sub)}
            className={`${fonts.mono} bg-white border-2 border-blue-600 px-6 py-3 text-blue-600 hover:bg-blue-50 transition-all font-bold shadow-[4px_4px_0px_0px_rgba(37,99,235,0.2)]`}>
            Preview
          </button>
          
          <button 
            onClick={() => router.push(`/workflow/user/file_management/${sub.id}`)}
            className={`${fonts.mono} bg-blue-600 text-white px-8 py-3 hover:bg-black transition-all font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none`}>
            View File →
          </button>
        </div>
      </div>

      {isRejected && (sub.approver_comments || sub.admin_comments) && (
        <div className="mt-8 p-6 bg-red-50 border border-red-200">
            <div className={`${fonts.mono} text-red-600 mb-2 font-bold`}>Feedback:</div>
            <p className="font-serif italic text-lg text-red-900">
              "{sub.admin_comments || sub.approver_comments}"
            </p>
        </div>
      )}
    </article>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function WorkflowDashboard() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [previewFile, setPreviewFile] = useState<Submission | null>(null);
  
  const supabase = createClient();

  const isImage = (fileName: string) => /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(fileName);

  // RESTORED: Download feature
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
    } catch (e) { console.error("Download error", e); }
  };

  const fetchAll = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);
    if (!user) return;

    const { data } = await supabase
      .from('workflow_submissions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (data) setSubmissions(data);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const stats = useMemo(() => [
    { label: 'Logged Files', value: submissions.length },
    { label: 'Cleared', value: submissions.filter(s => s.status === 'approved').length },
    { label: 'Reward Bal', value: `${submissions.filter(s => s.status === 'approved').length * 50} pts` },
  ], [submissions]);

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-gray-900">
      <div className="max-w-[1000px] mx-auto px-6 py-24">
        
        <div className="flex flex-col md:flex-row justify-between items-baseline gap-6 mb-20 border-b-2 border-gray-900 pb-10">
          <div>
            <h1 className={`${fonts.serif} text-7xl font-light text-gray-900`}>Archive</h1>
            <p className={`${fonts.mono} mt-2 text-blue-600`}>Vault Session // {user?.email}</p>
          </div>
          <a 
            href="/workflow/user/upload"
            className={`${fonts.mono} bg-blue-600 text-white px-10 py-5 hover:bg-black transition-all shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none`}>
            + New Submission
          </a>
        </div>

        <div className="flex flex-wrap gap-12 mb-20">
          {stats.map((stat) => (
            <div key={stat.label}>
              <h2 className={`${fonts.mono} text-gray-400`}>{stat.label}</h2>
              <p className={`${fonts.serif} text-5xl mt-1 text-gray-900`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className={`${fonts.mono} animate-pulse text-blue-600 flex items-center gap-4`}>
            <span className="w-10 h-[1px] bg-blue-600"></span>
            Syncing Records
          </div>
        ) : (
          <div className="space-y-4">
             {submissions.length === 0 ? (
               <div className="border-2 border-dashed border-gray-200 p-20 text-center">
                 <p className={`${fonts.serif} text-2xl text-gray-400`}>The archive is currently empty.</p>
               </div>
             ) : (
               submissions.map(sub => (
                 <SubmissionCard key={sub.id} sub={sub} onPreview={setPreviewFile} />
               ))
             )}
          </div>
        )}
      </div>

      {previewFile && (
        <div className="fixed inset-0 bg-black/95 z-[100] flex flex-col animate-in fade-in duration-300">
          <div className="px-6 py-4 flex justify-between items-center border-b-2 border-white/10 bg-black">
            <div className="flex flex-col text-white">
              <span className={`${fonts.mono} text-blue-500 mb-0.5`}>Preview_Engine</span>
              <h2 className="text-lg font-medium truncate max-w-md">{previewFile.file_name}</h2>
            </div>
            
            <div className="flex items-center gap-6">
              {/* RESTORED: Download Button */}
              <button 
                onClick={() => handleDownload(previewFile.file_url, previewFile.file_name)}
                className={`${fonts.mono} text-white/60 hover:text-white transition-colors text-[11px] border border-white/20 px-4 py-2 hover:border-white`}
              >
                [ Download_Source ]
              </button>
              
              <button onClick={() => setPreviewFile(null)} className="text-white hover:text-red-500 transition-all p-2">
                 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </div>
          
          <div className="flex-1 flex items-center justify-center overflow-hidden bg-[#1a1a1a]">
            {isImage(previewFile.file_name) ? (
              <img src={previewFile.file_url} alt="Preview" className="max-w-full max-h-full object-contain p-8 animate-in zoom-in-95" />
            ) : (
              <iframe 
                title="Document Preview"
                className="w-full h-full border-none bg-white" 
                src={`https://docs.google.com/gview?url=${encodeURIComponent(previewFile.file_url)}&embedded=true`} 
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}