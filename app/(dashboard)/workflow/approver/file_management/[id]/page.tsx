'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function ManageFilePage() {
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

  const updateStatus = async (newStatus: string) => {
    // SECURITY: Stop the function if the status is already set
    if (sub.status !== 'pending') return;

    setUpdating(true);
    const { error } = await supabase
      .from('workflow_submissions')
      .update({ 
        status: newStatus, 
        approver_comments: comment,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (!error) {
      await fetchDetails();
    }
    setUpdating(false);
  };

  if (loading) return <div className="p-10 font-mono text-blue-600">Accessing Record...</div>;
  if (!sub) return <div className="p-10 font-mono text-red-500">Record Not Found</div>;

  // Check if the file is already processed
  const isLocked = sub.status !== 'pending';

  return (
    <div className="h-screen bg-white flex flex-col lg:flex-row overflow-hidden border-t-4 border-black">
      
      <aside className="w-full lg:w-[420px] border-r-2 border-black p-8 flex flex-col overflow-y-auto bg-[#fafafa]">
        <button onClick={() => router.back()} className="text-[10px] font-black uppercase text-gray-400 mb-10 hover:text-black">
          ← Return to Registry
        </button>

        <section className="mb-10">
          <h1 className="text-5xl font-serif italic leading-none mb-4">{sub.file_name}</h1>
          <div className={`inline-block px-3 py-1 border-2 font-black text-[10px] uppercase shadow-[3px_3px_0px_0px_currentColor]
            ${sub.status === 'approved' ? 'text-green-600 bg-green-50' : 
              sub.status === 'declined' ? 'text-red-600 bg-red-50' : 'text-blue-600 bg-blue-50'}`}>
            {sub.status}
          </div>
        </section>

        {/* SENDER INFO */}
        <section className="mb-10 p-5 border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <h2 className="text-[10px] font-black uppercase text-blue-600 mb-4 tracking-widest underline">Origin_Sender</h2>
          <p className="text-[9px] font-bold text-gray-400 uppercase">User Name</p>
          <p className="font-bold text-sm mb-3">{sender?.full_name || 'System User'}</p>
          <p className="text-[9px] font-bold text-gray-400 uppercase">Email</p>
          <p className="font-bold text-sm underline">{sender?.email || 'Unknown'}</p>
        </section>

        {/* REVIEWER INPUT OR SAVED COMMENT */}
        <div className="mt-auto pt-6 border-t-2 border-black">
          <label className="text-[10px] font-black uppercase mb-3 block">
            {isLocked ? 'Final Reviewer Notes' : 'Reviewer Feedback'}
          </label>
          
          {isLocked ? (
            // SHOW STATIC TEXT IF LOCKED
            <div className="p-4 border-2 border-dashed border-gray-300 bg-gray-100 text-sm text-gray-600 italic">
              {sub.approver_comments || "No comments were provided."}
            </div>
          ) : (
            // SHOW TEXTAREA IF PENDING
            <textarea 
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full h-28 p-4 border-2 border-black bg-white text-sm outline-none resize-none"
              placeholder="Notes for the sender..."
            />
          )}
          
          <div className="mt-6">
            {isLocked ? (
              // LOCKED MESSAGE
              <div className="bg-gray-900 text-white p-4 text-center font-black text-[10px] uppercase tracking-widest">
                Decision Finalized — Record Locked
              </div>
            ) : (
              // ACTION BUTTONS
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => updateStatus('approved')}
                  disabled={updating}
                  className="bg-green-600 text-white py-4 font-black text-[10px] uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all"
                >
                  Approve
                </button>
                <button 
                  onClick={() => updateStatus('declined')}
                  disabled={updating}
                  className="bg-black text-white py-4 font-black text-[10px] uppercase shadow-[4px_4px_0px_0px_rgba(37,99,235,1)] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all"
                >
                  Decline
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* PREVIEW */}
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