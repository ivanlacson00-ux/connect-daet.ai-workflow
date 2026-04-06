'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const fonts = {
  serif: "font-serif italic",
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

interface Submission {
  id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  status: string;
  category: string;
  description: string;
  approver_comments: string;
  admin_comments: string;
  rejection_comment: string; // Added from schema
  created_at: string;
}

export default function UserFileDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [sub, setSub] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchSubmission = async () => {
      const { data } = await supabase
        .from('workflow_submissions')
        .select('*')
        .eq('id', id)
        .single();

      if (data) setSub(data);
      setLoading(false);
    };
    fetchSubmission();
  }, [id, supabase]);

  // Status mapping helper to keep logic consistent with Registry
  const getStatusDisplay = (s: string) => {
    switch (s) {
      case 'pending':
      case 'pending_approver':
        return { label: 'PENDING', styles: "text-blue-600 bg-white border-blue-600 shadow-[3px_3px_0px_0px_rgba(37,99,235,0.3)]" };
      case 'pending_admin':
        return { label: 'UNDER REVIEW', styles: "text-white bg-blue-600 border-blue-600 shadow-[3px_3px_0px_0px_rgba(0,0,0,0.2)]" };
      case 'approved':
        return { label: 'APPROVED', styles: "text-blue-700 bg-blue-50 border-blue-400" };
      case 'declined_by_approver':
      case 'declined_by_admin':
        return { label: 'REJECTED', styles: "text-red-600 bg-red-50 border-red-600" };
      default:
        return { label: s?.toUpperCase().replace('_', ' '), styles: "text-gray-600 bg-gray-50 border-gray-400" };
    }
  };

  const isImage = (type: string) => type?.startsWith('image/');

  if (loading) return <div className={`${fonts.mono} p-20 animate-pulse text-blue-600`}>Accessing_Dossier_Entry...</div>;
  if (!sub) return <div className="p-20 font-mono text-red-500 underline uppercase">Record_Not_Found</div>;

  const statusInfo = getStatusDisplay(sub.status);

  return (
    <div className="h-screen bg-white flex flex-col lg:flex-row overflow-hidden border-t-4 border-black">
      
      {/* SIDEBAR: DATA & DETAILS */}
      <aside className="w-full lg:w-[450px] border-r-2 border-black p-8 flex flex-col overflow-y-auto bg-[#fafafa]">
        <button 
          onClick={() => router.back()} 
          className={`${fonts.mono} text-gray-400 mb-10 hover:text-blue-600 transition-colors text-left font-bold`}
        >
          ← Return_to_Archive
        </button>

        <section className="mb-8">
          <div className="flex items-center gap-2 mb-2">
             <span className="bg-blue-600 text-white text-[8px] font-black px-1.5 py-0.5 uppercase tracking-widest">Document_Header</span>
          </div>
          <h1 className="text-4xl font-serif italic leading-tight mb-4 text-black">{sub.file_name}</h1>
          
          <div className={`inline-block px-4 py-1.5 border-2 font-black ${fonts.mono} ${statusInfo.styles}`}>
            {statusInfo.label}
          </div>
        </section>

        {/* 01. DEPARTMENT */}
        <section className="mb-6 p-4 border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <h2 className={`${fonts.mono} text-blue-600 mb-1 font-black`}>01_Department</h2>
          <p className="font-bold text-lg uppercase tracking-tight">{sub.category || 'GENERAL_UNASSIGNED'}</p>
        </section>

        {/* 02. CONTEXT BRIEF */}
        <section className="mb-8">
          <h2 className={`${fonts.mono} text-gray-400 mb-2 font-black`}>02_Context_Brief</h2>
          <div className="p-5 border-2 border-dashed border-black/20 bg-white min-h-[100px]">
            <p className="text-sm leading-relaxed text-gray-700 italic font-serif">
              {sub.description || "No context was provided for this submission."}
            </p>
          </div>
        </section>

        {/* 03. METADATA */}
        <section className="mb-8 space-y-4">
          <h2 className={`${fonts.mono} text-gray-400 border-b border-gray-200 pb-1 font-black`}>03_Metadata_Log</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[9px] font-bold text-gray-400 uppercase">Weight</p>
              <p className="font-mono text-xs font-bold">{(sub.file_size / 1024).toFixed(2)} KB</p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-gray-400 uppercase">Registry_Date</p>
              <p className="font-mono text-xs font-bold">{new Date(sub.created_at).toLocaleDateString()}</p>
            </div>
          </div>
        </section>

        {/* 04. FEEDBACK (Consolidated from all possible comment fields) */}
        {(sub.approver_comments || sub.admin_comments || sub.rejection_comment) && (
          <section className="mb-10">
            <h2 className={`${fonts.mono} text-red-600 mb-2 font-black`}>04_Official_Feedback</h2>
            <div className="p-4 border-2 border-red-600 bg-red-50 text-sm text-red-900 italic font-serif shadow-[4px_4px_0px_0px_rgba(220,38,38,0.1)]">
              "{sub.admin_comments || sub.approver_comments || sub.rejection_comment}"
            </div>
          </section>
        )}

        <div className="mt-auto pt-6 border-t-2 border-black">
          <button 
            onClick={() => window.open(sub.file_url, '_blank')}
            className={`${fonts.mono} w-full py-4 bg-black text-white font-black hover:bg-blue-600 transition-all shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none mb-4`}
          >
            Download_Original_Manifest
          </button>
        </div>
      </aside>

      {/* PREVIEW PANEL */}
      <main className="flex-1 bg-[#1a1a1a] flex flex-col p-4 lg:p-12 relative overflow-hidden">
        <div className="absolute top-6 left-6 z-10 hidden lg:block">
            <span className={`${fonts.mono} text-white/20 text-[8px]`}>System // Visual_Output_Buffer</span>
        </div>
        
        <div className="flex-1 bg-white border-4 border-black shadow-2xl overflow-hidden flex items-center justify-center relative">
          {isImage(sub.file_type) ? (
            <img 
              src={sub.file_url} 
              alt="Preview" 
              className="max-w-full max-h-full object-contain p-4 animate-in fade-in zoom-in-95 duration-500" 
            />
          ) : (
            <iframe 
              title="Document Preview"
              src={`https://docs.google.com/gview?url=${encodeURIComponent(sub.file_url)}&embedded=true`} 
              className="w-full h-full border-none" 
            />
          )}
        </div>
      </main>
    </div>
  );
}