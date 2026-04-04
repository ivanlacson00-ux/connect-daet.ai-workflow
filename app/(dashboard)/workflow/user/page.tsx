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

// ─── Status Timeline ──────────────────────────────────────────────────────────
const PIPELINE_STAGES = ['Upload', 'Review', 'Approved'] as const;

function StatusTimeline({ status }: { status: string }) {
  const stages = getPipelineState(status);
  return (
    <div className="flex items-center gap-0 mt-6 border-t border-blue-600/10 pt-4">
      {PIPELINE_STAGES.map((label, i) => {
        const s = stages[i];
        const isLast = i === PIPELINE_STAGES.length - 1;

        const dotClass =
          s === 'done' ? 'bg-blue-600 border-blue-600' :
          s === 'active' ? 'bg-white border-blue-600 ring-4 ring-blue-100' :
          s === 'declined' ? 'bg-red-600 border-red-600' :
          'bg-white border-gray-300';

        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-start">
              <div className={`w-3 h-3 border transition-all ${dotClass}`} />
              <span className={`${fonts.mono} mt-2 ${s === 'idle' ? 'text-gray-400' : 'text-blue-600'}`}>
                {label}
              </span>
            </div>
            {!isLast && (
              <div className="w-12 md:w-20 h-[1px] bg-blue-600 mb-6 mx-2 opacity-20" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const isDeclined = status.includes('declined');
  const isApproved = status === 'approved';
  
  return (
    <span className={`border border-blue-600 px-3 py-1 ${fonts.mono} font-bold 
      ${isDeclined ? 'bg-red-600 text-white border-red-600' : isApproved ? 'bg-blue-600 text-white' : 'bg-white text-blue-600'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

// ─── Submission Card ──────────────────────────────────────────────────────────
function SubmissionCard({ sub, onPreview }: { sub: Submission; onPreview: (s: Submission) => void }) {
  return (
    <article className="bg-white border border-blue-600 p-6 transition-all duration-500 hover:bg-blue-50/30 group mb-6 shadow-[4px_4px_0px_0px_rgba(37,99,235,1)]">
      <div className="flex flex-col md:flex-row justify-between items-start gap-4">
        <div className="flex-1">
          <div className={`${fonts.mono} text-blue-400 mb-2`}>File ID: #{sub.id.slice(0, 8)}</div>
          <h3 className={`${fonts.serif} text-3xl text-gray-900 mb-1 group-hover:translate-x-1 transition-transform`}>
            {sub.file_name}
          </h3>
          <div className="flex gap-4 items-center mt-2">
            <span className={`${fonts.mono} text-gray-400`}>{new Date(sub.created_at).toLocaleDateString()}</span>
            <StatusBadge status={sub.status} />
          </div>
        </div>

        <div className="flex gap-2">
          <button 
            onClick={() => onPreview(sub)}
            className={`${fonts.mono} border border-blue-600 px-4 py-2 text-blue-600 hover:bg-blue-600 hover:text-white transition-colors`}>
            / View
          </button>
        </div>
      </div>

      <StatusTimeline status={sub.status} />

      {(sub.approver_comments || sub.admin_comments) && (
        <div className="mt-4 p-4 bg-red-50 border-l-4 border-red-600 italic text-sm font-serif text-red-900">
          "{sub.approver_comments || sub.admin_comments}"
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

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-gray-900">
      <div className="max-w-[1200px] mx-auto px-6 py-20">
        
        {/* Header Section */}
        <div className="border-b border-blue-600 pb-8 mb-12 flex justify-between items-end">
          <div>
            <h1 className={`${fonts.serif} text-6xl font-semibold text-blue-600`}>Dashboard</h1>
            <p className={`${fonts.mono} mt-4 text-blue-400`}>System Overview // File Tracking</p>
          </div>
          <a 
            href="/workflow/user/upload"
            className={`${fonts.mono} bg-blue-600 text-white px-8 py-4 hover:bg-blue-700 transition-all shadow-[4px_4px_0px_0px_rgba(30,58,138,1)]`}>
            + New Upload
          </a>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 border-l border-t border-blue-600 bg-white mb-16 shadow-sm">
          {[
            { label: 'Total Files', value: submissions.length },
            { label: 'Approved', value: submissions.filter(s => s.status === 'approved').length },
            { label: 'Rewards', value: `${submissions.filter(s => s.status === 'approved').length * 50} pts` },
          ].map((stat) => (
            <div key={stat.label} className="border-r border-b border-blue-600 p-8 hover:bg-blue-50 transition-colors">
              <h2 className={fonts.mono}>{stat.label}</h2>
              <p className={`${fonts.serif} text-5xl mt-2 text-blue-600`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* List Section */}
        {loading ? (
          <div className={`${fonts.mono} animate-pulse text-blue-600`}>Syncing Records...</div>
        ) : (
          <div className="space-y-0">
             <div className={`${fonts.mono} mb-6 text-blue-400`}>Recent Submissions</div>
             {submissions.length === 0 ? (
               <div className="border border-dashed border-blue-300 p-20 text-center">
                 <p className={fonts.serif}>No files found in the system.</p>
               </div>
             ) : (
               submissions.map(sub => (
                 <SubmissionCard key={sub.id} sub={sub} onPreview={setPreviewFile} />
               ))
             )}
          </div>
        )}
      </div>

      {/* ─── PREVIEW MODAL (FIXED) ─────────────────────────────────────────── */}
      {previewFile && (
        <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4">
          <div className="relative bg-white rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center p-5 border-b bg-gray-50 shrink-0">
              <div>
                <h3 className="font-bold text-xl">{previewFile.file_name}</h3>
                <p className="text-sm text-gray-500">{formatFileSize(previewFile.file_size)}</p>
              </div>
              <button
                onClick={() => setPreviewFile(null)}
                className="w-10 h-10 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-700 text-xl"
              >
                ✕
              </button>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-gray-100 min-h-[400px]">
              {previewFile.file_type?.startsWith('image/') && (
                <img 
                  src={previewFile.file_url} 
                  alt={previewFile.file_name} 
                  className="max-w-full max-h-[70vh] object-contain"
                />
              )}
              {previewFile.file_name.match(/\.(pdf)$/i) && (
                <iframe src={previewFile.file_url} className="w-full h-[70vh]" />
              )}
              {!previewFile.file_type?.startsWith('image/') && !previewFile.file_name.match(/\.(pdf)$/i) && (
                <div className="text-center">
                  <p className="text-gray-500 mb-4">Preview not available</p>
                  <a
                    href={previewFile.file_url}
                    download={previewFile.file_name}
                    className="bg-blue-600 text-white px-6 py-2 rounded-full hover:bg-blue-700"
                  >
                    Download File
                  </a>
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div className="p-3 bg-gray-50 border-t text-center text-xs text-gray-400">
              CONNECT-Daet.ai • Secure File Preview
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helper Functions ────────────────────────────────────────────────────────
function getPipelineState(status: string): ('done' | 'active' | 'declined' | 'idle')[] {
  switch (status) {
    case 'pending_approver':   return ['active', 'idle', 'idle'];
    case 'pending_admin':      return ['done', 'active', 'idle'];
    case 'approved':           return ['done', 'done', 'done'];
    case 'declined_by_approver': return ['declined', 'idle', 'idle'];
    case 'declined_by_admin':   return ['done', 'declined', 'idle'];
    default:                    return ['idle', 'idle', 'idle'];
  }
}