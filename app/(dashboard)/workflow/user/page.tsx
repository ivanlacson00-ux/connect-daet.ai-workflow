'use client';

import { useEffect, useState, useCallback } from 'react';
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
    if (status === 'approved') {
      return { label: 'APPROVED', color: 'text-green-600', bg: 'bg-green-50' };
    }
    // Updated check for 'rejected' or 'declined' [cite: 58, 59]
    if (status.includes('rejected') || status.includes('declined')) {
      return { label: 'REJECTED', color: 'text-red-600', bg: 'bg-red-50' };
    }
    // Covers pending_approver and pending_admin [cite: 55, 56]
    return { label: 'PENDING', color: 'text-blue-600', bg: 'bg-blue-50' };
  };

  const config = getDisplayConfig();

  return (
    <div className={`inline-flex items-center gap-2 border-2 border-current px-4 py-1.5 rotate-[-2deg] ${config.color} ${config.bg} ${fonts.mono} font-black shadow-[2px_2px_0px_0px_currentColor]`}>
      <span className="text-lg">●</span>
      {config.label}
    </div>
  );
}

// ─── Submission Card ──────────────────────────────────────────────────────────
function SubmissionCard({ sub, onPreview }: { sub: Submission; onPreview: (s: Submission) => void }) {
  const isRejected = sub.status.includes('declined') || sub.status.includes('rejected');

  return (
    <article className="bg-white border border-blue-600 p-8 transition-all duration-300 hover:shadow-[8px_8px_0px_0px_rgba(37,99,235,1)] group mb-8 relative overflow-hidden">
      {/* Background Watermark for status */}
      <div className="absolute top-[-20px] right-[-20px] opacity-[0.03] pointer-events-none select-none">
        <h4 className="text-9xl font-black uppercase">{sub.status.split('_')[0]}</h4>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start gap-8 relative z-10">
        <div className="flex-1 space-y-4">
          <div>
            <div className={`${fonts.mono} text-blue-400 mb-1`}>Record No. {sub.id.slice(0, 12)}</div>
            <h3 className={`${fonts.serif} text-4xl text-gray-900 group-hover:text-blue-600 transition-colors`}>
              {sub.file_name}
            </h3>
            <p className={`${fonts.mono} text-gray-400 mt-2`}>
              {new Date(sub.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>

          <StatusStamp status={sub.status} />
        </div>

        <div className="flex flex-col gap-3 w-full md:w-auto shrink-0">
          <button 
            onClick={() => onPreview(sub)}
            className={`${fonts.mono} bg-white border-2 border-blue-600 px-6 py-3 text-blue-600 hover:bg-blue-600 hover:text-white transition-all font-bold active:translate-y-1`}>
            [ View File ]
          </button>
          
          {/* Resubmit button removed as requested */}
        </div>
      </div>

      {/* Show feedback only if the file was rejected/declined [cite: 32, 46] */}
      {(sub.approver_comments || sub.admin_comments) && isRejected && (
        <div className="mt-8 p-6 bg-red-50 border border-red-200 relative">
            <div className={`${fonts.mono} text-red-600 mb-2 font-bold`}>Reviewer Feedback:</div>
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

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-gray-900">
      <div className="max-w-[1000px] mx-auto px-6 py-24">
        
        <div className="flex flex-col md:flex-row justify-between items-baseline gap-6 mb-20 border-b-2 border-gray-900 pb-10">
          <div>
            <h1 className={`${fonts.serif} text-7xl font-light text-gray-900`}>Archive</h1>
            <p className={`${fonts.mono} mt-2 text-blue-600`}>Authenticated Workflow Session // {user?.email}</p>
          </div>
          <a 
            href="/workflow/user/upload"
            className={`${fonts.mono} bg-blue-600 text-white px-10 py-5 hover:bg-black transition-all shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none`}>
            + New Submission
          </a>
        </div>

        <div className="flex flex-wrap gap-12 mb-20">
          {[
            { label: 'Logged Files', value: submissions.length },
            { label: 'Cleared', value: submissions.filter(s => s.status === 'approved').length },
            { label: 'Reward Bal', value: `${submissions.filter(s => s.status === 'approved').length * 50} pts` },
          ].map((stat) => (
            <div key={stat.label}>
              <h2 className={`${fonts.mono} text-gray-400`}>{stat.label}</h2>
              <p className={`${fonts.serif} text-5xl mt-1 text-gray-900`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className={`${fonts.mono} animate-pulse text-blue-600 flex items-center gap-4`}>
            <span className="w-10 h-[1px] bg-blue-600 animate-width"></span>
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
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-6 backdrop-blur-sm">
          <div className="relative bg-white max-w-6xl w-full h-[85vh] flex flex-col shadow-2xl">
            <div className="flex justify-between items-center p-6 border-b border-gray-100 bg-white">
              <div>
                <p className={fonts.mono}>Previewing Document</p>
                <h3 className="font-bold text-2xl text-gray-900">{previewFile.file_name}</h3>
              </div>
              <button
                onClick={() => setPreviewFile(null)}
                className="w-12 h-12 flex items-center justify-center border-2 border-gray-900 text-gray-900 hover:bg-gray-900 hover:text-white transition-all text-2xl"
              >
                ✕
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-8 bg-gray-50 flex items-center justify-center">
              {previewFile.file_type?.startsWith('image/') ? (
                <img src={previewFile.file_url} className="max-w-full max-h-full object-contain shadow-lg" />
              ) : previewFile.file_name.match(/\.(pdf)$/i) ? (
                <iframe src={previewFile.file_url} className="w-full h-full border-none shadow-lg" />
              ) : (
                <div className="text-center p-12 border-2 border-dashed border-gray-300 bg-white">
                  <p className={`${fonts.serif} text-2xl mb-6`}>Interactive preview unavailable for this format.</p>
                  <a href={previewFile.file_url} download className={`${fonts.mono} bg-blue-600 text-white px-8 py-4`}>
                    Download Source File
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}