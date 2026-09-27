'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// ─── Styles & Fonts ──────────────────────────────────────────────────────────
const fonts = {
  serif: "font-serif italic", 
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

interface Submission {
  id: string;
  tracking_number: string;
  file_name: string;
  file_url: string;
  file_size: number;
  file_type: string;
  status: string;
  category?: string;
  approver_comments: string;
  admin_comments: string;
  created_at: string;
  updated_at: string;
}

// ─── Status Stamp (Synced Unified Logic) ─────────────────────────────────────
function StatusStamp({ status }: { status: string }) {
  const getDisplayConfig = () => {
    switch (status) {
      case 'pending':
      case 'pending_approver':
        return { 
          label: 'PENDING', 
          styles: "text-blue-600 bg-white border-blue-600 shadow-[3px_3px_0px_0px_rgba(37,99,235,0.3)]" 
        };
      case 'pending_admin':
        return { 
          label: 'UNDER REVIEW', 
          styles: "text-white bg-blue-600 border-blue-600 shadow-[3px_3px_0px_0px_rgba(0,0,0,0.2)]" 
        };
      case 'approved':
        return { 
          label: 'APPROVED', 
          styles: "text-blue-700 bg-blue-50 border-blue-400" 
        };
      case 'completed':
        return {
          label: 'COMPLETED',
          styles: "text-green-700 bg-green-50 border-green-400"
        };
      case 'declined_by_approver':
      case 'declined_by_admin':
        return { 
          label: 'REJECTED', 
          styles: "text-red-600 bg-red-50 border-red-600" 
        };
      default:
        return { 
          label: status?.toUpperCase().replace('_', ' ') || 'UNKNOWN', 
          styles: "text-gray-600 bg-gray-50 border-gray-400" 
        };
    }
  };

  const config = getDisplayConfig();
  
  return (
    <div className={`inline-block px-3 py-1.5 border-2 font-black rotate-[-1deg] ${fonts.mono} ${config.styles}`}>
      {config.label}
    </div>
  );
}

// ─── Individual Card Component ───────────────────────────────────────────────
function SubmissionCard({ sub, onPreview }: { sub: Submission; onPreview: (s: Submission) => void }) {
  const router = useRouter();
  const isRejected = sub.status.includes('declined') || sub.status.includes('rejected');

  return (
    <article className="bg-white border-2 border-black p-8 transition-all duration-300 hover:shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] group mb-8 relative overflow-hidden">
      {/* Background Watermark */}
      <div className="absolute top-[-20px] right-[-20px] opacity-[0.03] pointer-events-none select-none">
        <h4 className="text-9xl font-black uppercase tracking-tighter">
          {sub.status.split('_')[0]}
        </h4>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start gap-8 relative z-10">
        <div className="flex-1 space-y-4">
          <div>
            <div className={`${fonts.mono} text-blue-400 mb-1 flex items-center gap-2`}>
               <span className="w-4 h-[1px] bg-blue-200"></span>
               Tracking: {sub.tracking_number || 'Pending assignment'}
            </div>
            <h3 className={`${fonts.serif} text-4xl text-gray-900 group-hover:text-blue-600 transition-colors`}>
              {sub.file_name}
            </h3>
            <div className="flex items-center gap-4 mt-2">
               <p className={`${fonts.mono} text-gray-400`}>{new Date(sub.created_at).toLocaleDateString()}</p>
               <span className="text-gray-200">|</span>
               <p className={`${fonts.mono} text-gray-400`}>{(sub.file_size / 1024).toFixed(1)} KB</p>
            </div>
          </div>
          <StatusStamp status={sub.status} />
        </div>

        <div className="flex flex-col gap-3 w-full md:w-auto shrink-0">
          <button 
            onClick={() => onPreview(sub)} 
            className={`${fonts.mono} bg-white border-2 border-blue-600 px-6 py-3 text-blue-600 hover:bg-blue-50 transition-all font-bold shadow-[4px_4px_0px_0px_rgba(37,99,235,0.2)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none`}
          >
            Preview_Source
          </button>
          
          <button 
            onClick={() => router.push(`/workflow/user/file_registry/${sub.id}`)} 
            className={`${fonts.mono} bg-blue-600 text-white px-8 py-3 hover:bg-black transition-all font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none`}
          >
            View Full Log →
          </button>
        </div>
      </div>

      {/* Rejection Feedback Panel */}
      {isRejected && (sub.approver_comments || sub.admin_comments) && (
        <div className="mt-8 p-6 bg-red-50 border-2 border-red-600 shadow-[4px_4px_0px_0px_rgba(220,38,38,0.1)]">
            <div className={`${fonts.mono} text-red-600 mb-2 font-black underline`}>04_Official_Feedback:</div>
            <p className="font-serif italic text-lg text-red-900 leading-relaxed">
              "{sub.admin_comments || sub.approver_comments}"
            </p>
        </div>
      )}
    </article>
  );
}

// ─── Main Dashboard Page ─────────────────────────────────────────────────────
export default function WorkflowDashboard() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [previewFile, setPreviewFile] = useState<Submission | null>(null);
  const supabase = createClient();

  const isImage = (fileType: string) => fileType?.startsWith('image/');

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

    const { data, error } = await supabase
      .from('workflow_submissions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) setSubmissions(data);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Dynamic Dashboard Stats
  const stats = useMemo(() => [
    { label: 'Logged Files', value: submissions.length },
    { label: 'Cleared', value: submissions.filter(s => s.status === 'approved').length },
    { label: 'Reward Bal', value: `${submissions.filter(s => s.status === 'approved').length * 50} pts` },
  ], [submissions]);

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-gray-900">
      <div className="max-w-[1000px] mx-auto px-6 py-24">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-baseline gap-6 mb-20 border-b-4 border-gray-900 pb-10">
          <div>
            <h1 className={`${fonts.serif} text-8xl font-light text-gray-900 leading-none`}>Archive.</h1>
            <p className={`${fonts.mono} mt-4 text-blue-600 font-bold`}>Vault Session // {user?.email}</p>
          </div>
          <a 
            href="/workflow/user/upload" 
            className={`${fonts.mono} bg-blue-600 text-white px-10 py-5 hover:bg-black transition-all shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none font-black`}
          >
            + New Submission
          </a>
        </div>

        {/* Stats Grid */}
        <div className="flex flex-wrap gap-12 mb-20">
          {stats.map((stat) => (
            <div key={stat.label} className="group">
              <h2 className={`${fonts.mono} text-gray-400 group-hover:text-blue-600 transition-colors`}>{stat.label}</h2>
              <p className={`${fonts.serif} text-6xl mt-1 text-gray-900`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* List Section */}
        {loading ? (
          <div className={`${fonts.mono} animate-pulse text-blue-600 flex items-center gap-4 py-20`}>
            <span className="w-12 h-[2px] bg-blue-600"></span>
            Syncing Records...
          </div>
        ) : (
          <div className="space-y-4">
             {submissions.length === 0 ? (
               <div className="border-4 border-dashed border-gray-100 py-32 text-center bg-gray-50/30">
                 <p className={`${fonts.serif} text-3xl text-gray-300`}>The archive is currently empty.</p>
                 <p className={`${fonts.mono} text-gray-400 mt-4`}>Await first registry entry</p>
               </div>
             ) : (
               submissions.map(sub => (
                 <SubmissionCard key={sub.id} sub={sub} onPreview={setPreviewFile} />
               ))
             )}
          </div>
        )}
      </div>

      {/* FULLSCREEN PREVIEW MODAL */}
      {previewFile && (
        <div className="fixed inset-0 bg-black/98 z-[100] flex flex-col animate-in fade-in duration-300">
          <div className="px-6 py-6 flex justify-between items-center border-b-2 border-white/10 bg-black">
            <div className="flex flex-col text-white">
              <span className={`${fonts.mono} text-blue-500 mb-0.5 font-black`}>Preview_Engine // Output</span>
              <h2 className="text-xl font-medium truncate max-w-md italic font-serif">{previewFile.file_name}</h2>
            </div>
            <div className="flex items-center gap-6">
              <button 
                onClick={() => handleDownload(`/api/workflow/files/${previewFile.id}?redirect=1`, previewFile.file_name)}
                className={`${fonts.mono} text-white/60 hover:text-blue-400 hover:border-blue-400 text-[11px] border border-white/20 px-6 py-2 transition-all font-bold`}
              >
                [ Download_Source ]
              </button>
              <button 
                onClick={() => setPreviewFile(null)} 
                className="text-white hover:text-red-500 p-2 transition-colors"
              >
                 <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </div>
          
          <div className="flex-1 flex items-center justify-center overflow-hidden bg-[#0a0a0a] p-4">
            <div className="w-full h-full max-w-6xl bg-white border-4 border-black shadow-2xl relative overflow-hidden flex items-center justify-center">
               {isImage(previewFile.file_type) ? (
                 <img 
                   src={`/api/workflow/files/${previewFile.id}?redirect=1`}
                   alt="Preview" 
                   className="max-w-full max-h-full object-contain p-8 animate-in zoom-in-95 duration-500" 
                 />
               ) : (
                 <iframe 
                   title="Document Preview"
                   className="w-full h-full border-none" 
                   src={`/api/workflow/files/${previewFile.id}?redirect=1`}
                 />
               )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}