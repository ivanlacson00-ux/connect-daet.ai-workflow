'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const fonts = {
  serif: "font-serif italic",
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

export default function ApproverManagePage() {
  const { id } = useParams();
  const router = useRouter();
  const supabase = createClient();
  
  const [sub, setSub] = useState<any>(null);
  const [sender, setSender] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [comment, setComment] = useState('');

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    const { data: submission } = await supabase
      .from('workflow_submissions')
      .select('*')
      .eq('id', id)
      .single();

    if (submission) {
      setSub(submission);
      setComment(submission.approver_comments || '');

      const { data: profile } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', submission.user_id)
        .single();
      
      if (profile) setSender(profile);
    }
    setLoading(false);
  }, [id, supabase]);

  useEffect(() => { fetchDetails(); }, [fetchDetails]);

  const handleApproverAction = async (decision: 'approved' | 'declined') => {
    // SECURITY: Approver can only act if status is strictly 'pending_approver'
    if (sub.status !== 'pending_approver') return;

    if (decision === 'declined' && !comment.trim()) {
      alert("Please provide a reason for declining this submission.");
      return;
    }

    setUpdating(true);
    
    // Logic: If approved by Approver, it moves to Admin review.
    // If declined, it stops here.
    const nextStatus = decision === 'approved' ? 'pending_admin' : 'declined_by_approver';

    const { error } = await supabase
      .from('workflow_submissions')
      .update({ 
        status: nextStatus, 
        approver_comments: comment,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (!error) {
      await fetchDetails();
    }
    setUpdating(false);
  };

  if (loading) return <div className="p-10 font-mono text-blue-600 animate-pulse">Accessing Stage_1_Record...</div>;
  if (!sub) return <div className="p-10 font-mono text-red-500">Record Not Found</div>;

  // LOCK LOGIC: Locked if status is no longer 'pending_approver'
  const isLocked = sub.status !== 'pending_approver';

  return (
    <div className="h-screen bg-white flex flex-col lg:flex-row overflow-hidden border-t-4 border-blue-600">
      
      {/* SIDEBAR: APPROVER DOSSIER */}
      <aside className="w-full lg:w-[420px] border-r-2 border-black p-8 flex flex-col overflow-y-auto bg-[#fafafa]">
        <button onClick={() => router.back()} className={`${fonts.mono} text-gray-400 mb-10 hover:text-black`}>
          ← Return to Queue
        </button>

        <section className="mb-10">
          <div className="flex items-center gap-2 mb-2">
             <span className="bg-blue-600 text-white text-[8px] font-black px-1.5 py-0.5 uppercase">Stage_01_Review</span>
          </div>
          <h1 className="text-4xl font-serif italic leading-none mb-4">{sub.file_name}</h1>
          <div className={`inline-block px-3 py-1 border-2 font-black ${fonts.mono} shadow-[3px_3px_0px_0px_currentColor]
            ${sub.status === 'pending_admin' || sub.status === 'approved' ? 'text-green-600 bg-green-50' : 
              sub.status.includes('declined') ? 'text-red-600 bg-red-50' : 'text-blue-600 bg-blue-50'}`}>
            {sub.status}
          </div>
        </section>

        {/* SENDER INFO */}
        <section className="mb-10 p-5 border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <h2 className={`${fonts.mono} text-blue-600 mb-4 font-black underline`}>Origin_Sender</h2>
          <p className="text-[9px] font-bold text-gray-400 uppercase">User Name</p>
          <p className="font-bold text-sm mb-3">{sender?.full_name || 'System User'}</p>
          <p className="text-[9px] font-bold text-gray-400 uppercase">Email</p>
          <p className="font-bold text-sm underline truncate">{sender?.email || 'Unknown'}</p>
        </section>

        {/* APPROVER INTERFACE */}
        <div className="mt-auto pt-6 border-t-2 border-black">
          <label className={`${fonts.mono} mb-3 block font-black`}>
            {isLocked ? 'Submitted Feedback' : 'Initial Reviewer Notes'}
          </label>
          
          {isLocked ? (
            <div className="p-4 border-2 border-dashed border-gray-300 bg-gray-100 text-sm text-gray-600 italic">
              {sub.approver_comments || "No comments were provided at this stage."}
            </div>
          ) : (
            <textarea 
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full h-28 p-4 border-2 border-black bg-white text-sm outline-none resize-none focus:ring-4 ring-blue-100"
              placeholder="Provide context for the Admin or feedback for the user..."
            />
          )}
          
          <div className="mt-6">
            {isLocked ? (
              <div className="bg-blue-900 text-white p-4 text-center font-black text-[10px] uppercase tracking-widest shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                Review Submitted — Forwarded to Admin
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => handleApproverAction('approved')}
                  disabled={updating}
                  className="bg-blue-600 text-white py-4 font-black text-[10px] uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all"
                >
                  Forward to Admin
                </button>
                <button 
                  onClick={() => handleApproverAction('declined')}
                  disabled={updating}
                  className="bg-black text-white py-4 font-black text-[10px] uppercase shadow-[4px_4px_0px_0px_rgba(239,68,68,1)] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all"
                >
                  Decline
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* PREVIEW PANEL */}
      <main className="flex-1 bg-[#111] flex flex-col p-8 relative">
        <div className="flex-1 bg-white border-4 border-black shadow-2xl overflow-hidden flex items-center justify-center">
          {sub.file_name.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i) ? (
            <img src={sub.file_url} alt="Preview" className="max-w-full max-h-full object-contain p-2" />
          ) : (
            <iframe src={`https://docs.google.com/gview?url=${encodeURIComponent(sub.file_url)}&embedded=true`} className="w-full h-full border-none" />
          )}
        </div>
      </main>
    </div>
  );
}