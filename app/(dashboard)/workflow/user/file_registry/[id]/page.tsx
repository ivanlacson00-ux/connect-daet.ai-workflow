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
  rejection_comment: string;
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

  const getStatusStyles = (status: string) => {
    switch (status) {
      case 'pending':
      case 'pending_approver':
        return { label: 'PENDING', classes: 'border-2 border-blue-600 text-blue-600 bg-white shadow-[3px_3px_0px_0px_rgba(37,99,235,1)]' };
      case 'pending_admin':
        return { label: 'UNDER REVIEW', classes: 'bg-blue-600 text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]' };
      case 'approved':
        return { label: 'APPROVED', classes: 'border-2 border-blue-600 text-blue-600 bg-white' };
      case 'declined_by_approver':
      case 'declined_by_admin':
        return { label: 'REJECTED', classes: 'border-2 border-red-600 text-red-600 bg-red-50' };
      default:
        return { label: status?.toUpperCase(), classes: 'border-2 border-gray-400 text-gray-500' };
    }
  };

  const isImage = (type: string) => type?.startsWith('image/');

  if (loading) return <div className={`${fonts.mono} p-20 animate-pulse text-blue-600 uppercase`}>Opening_Secure_Archive...</div>;
  if (!sub) return <div className="p-20 font-mono text-red-500 underline uppercase">Error: Record_Not_Found</div>;

  const statusConfig = getStatusStyles(sub.status);
  
  // Logic: Only show feedback if it's REJECTED or FINAL APPROVED
  const showFeedback = sub.status === 'approved' || sub.status.includes('declined');
  const officialNote = sub.admin_comments || sub.rejection_comment || sub.approver_comments;

  return (
    <div className="h-screen bg-[#fafafa] flex flex-col lg:flex-row overflow-hidden border-t-[6px] border-black">
      
      {/* SIDEBAR */}
      <aside className="w-full lg:w-[480px] border-r-2 border-black flex flex-col bg-[#fafafa]">
        
        <div className="px-8 pt-8">
          <button 
            onClick={() => router.back()} 
            className={`${fonts.mono} text-gray-400 hover:text-black transition-all flex items-center gap-2 group mb-6`}
          >
            ← BACK TO ARCHIVE
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-10 py-4 space-y-10 custom-scrollbar">
          
          {/* Header */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <span className="bg-black text-white text-[9px] font-black px-2 py-0.5 tracking-tighter uppercase">Document_Entry // ID: {sub.id.split('-')[0]}</span>
            </div>
            <h1 className="text-4xl font-serif italic leading-[0.9] mb-8 break-words tracking-tighter text-zinc-900">{sub.file_name}</h1>
            <div className={`inline-block px-4 py-1.5 font-black text-[11px] tracking-widest uppercase ${statusConfig.classes}`}>
              {statusConfig.label}
            </div>
          </section>

          {/* Context Card */}
          <section className="relative">
             <div className="border-2 border-black p-6 space-y-6 bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                <div>
                  <p className={`${fonts.mono} text-[9px] text-gray-400 mb-1`}>Category_Ref</p>
                  <p className="text-xl font-black tracking-tight text-blue-600 uppercase">{sub.category || 'UNASSIGNED'}</p>
                </div>
                <div>
                  <p className={`${fonts.mono} text-[9px] text-gray-400 mb-1`}>User_Manifest_Context</p>
                  <p className="text-sm italic leading-relaxed text-zinc-600 whitespace-pre-wrap break-words border-l-2 border-zinc-100 pl-4">
                    "{sub.description || 'No context brief provided.'}"
                  </p>
                </div>
                <div className="pt-4 border-t border-zinc-100 flex justify-between items-end">
                   <div>
                      <p className={`${fonts.mono} text-[8px] text-gray-400`}>Registry_Timestamp</p>
                      <p className="text-[11px] font-bold">{new Date(sub.created_at).toLocaleDateString()} // {new Date(sub.created_at).toLocaleTimeString()}</p>
                   </div>
                   <div className="text-right">
                      <p className={`${fonts.mono} text-[8px] text-gray-400`}>Weight</p>
                      <p className="text-[11px] font-bold">{(sub.file_size / 1024).toFixed(2)} KB</p>
                   </div>
                </div>
             </div>
          </section>

          {/* Official Feedback Section */}
          {showFeedback && officialNote && (
            <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
               <p className={`${fonts.mono} text-red-600 border-b border-red-100 pb-2`}>Official_Validation_Feedback</p>
               <div className="p-6 border-2 border-black bg-white shadow-[6px_6px_0px_0px_rgba(239,68,68,1)] relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-1 bg-red-600 text-white text-[7px] font-black uppercase">Official</div>
                  <p className="text-sm italic leading-relaxed text-zinc-800 break-words">
                    "{officialNote}"
                  </p>
               </div>
            </section>
          )}

          {/* Locked Status for Active Review */}
          {!showFeedback && (
             <section className="p-6 border-2 border-dashed border-zinc-300 bg-zinc-50">
                <p className={`${fonts.mono} text-zinc-400 text-center leading-tight`}>
                  Note: Official feedback will be visible once the validation process is finalized.
                </p>
             </section>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-10 border-t-2 border-black bg-white">
          <button 
            onClick={() => window.open(sub.file_url, '_blank')}
            className={`${fonts.mono} w-full py-4 bg-black text-white font-black text-[10px] tracking-[0.2em] shadow-[4px_4px_0px_0px_rgba(37,99,235,1)] hover:bg-blue-600 active:shadow-none active:translate-x-1 active:translate-y-1 transition-all`}
          >
            Download_Original_Manifest
          </button>
        </div>
      </aside>

      {/* PREVIEW PANEL */}
      <main className="flex-1 bg-zinc-900 flex flex-col p-8 relative overflow-hidden">
        <div className="absolute top-4 left-6 z-20">
           <div className={`${fonts.mono} text-white/50 text-[9px] bg-white/5 border border-white/10 px-3 py-1 backdrop-blur-md`}>
             SECURE_ASSET_PREVIEW // {sub.id.split('-')[0].toUpperCase()}
           </div>
        </div>

        <div className="flex-1 bg-white border-[4px] border-black shadow-[30px_30px_0px_0px_rgba(0,0,0,0.5)] overflow-hidden flex items-center justify-center relative">
          {isImage(sub.file_type) ? (
            <div className="p-12 w-full h-full flex items-center justify-center">
              <img 
                src={sub.file_url} 
                alt="Asset Preview" 
                className="max-w-full max-h-full object-contain shadow-2xl animate-in zoom-in-95 duration-500" 
              />
            </div>
          ) : (
            <iframe 
              src={`https://docs.google.com/gview?url=${encodeURIComponent(sub.file_url)}&embedded=true`} 
              className="w-full h-full border-none" 
            />
          )}
          
          <div className="absolute bottom-8 right-8 pointer-events-none opacity-10">
            <span className="text-[60px] font-black text-black select-none tracking-tighter uppercase leading-none">Dossier<br/>Archive</span>
          </div>
        </div>
      </main>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #fafafa; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #000; }
      `}</style>
    </div>
  );
}