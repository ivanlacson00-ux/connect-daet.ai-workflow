'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const fonts = {
  serif: "font-serif italic",
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

export default function AdminManagePage() {
  const { id } = useParams();
  const router = useRouter();
  const supabase = createClient();
  
  const [sub, setSub] = useState<any>(null);
  const [sender, setSender] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [adminComment, setAdminComment] = useState('');

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    const { data: submission } = await supabase
      .from('workflow_submissions')
      .select('*')
      .eq('id', id)
      .single();

    if (submission) {
      setSub(submission);
      setAdminComment(submission.admin_comments || '');

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

  const handleAdminAction = async (decision: 'approved' | 'declined') => {
    // ADMIN OVERRIDE: Admin can act on anything UNLESS it's still with the approver
    if (sub.status === 'pending_approver') {
      alert("This file is still awaiting initial Approver review.");
      return;
    }

    setUpdating(true);
    const finalStatus = decision === 'approved' ? 'approved' : 'declined_by_admin';

    const { error } = await supabase
      .from('workflow_submissions')
      .update({ 
        status: finalStatus, 
        admin_comments: adminComment,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (!error) {
      // Rewards only on final Admin approval [cite: 74]
      if (finalStatus === 'approved') {
        console.log("Rewards Engine: +50 Points to", sub.user_id);
      }
      await fetchDetails();
    }
    setUpdating(false);
  };

  if (loading) return <div className="h-screen bg-white flex items-center justify-center font-mono text-yellow-600 animate-pulse">[ ACCESSING_EXECUTIVE_FILES... ]</div>;
  if (!sub) return <div className="p-20 font-mono text-red-500 text-center">FILE_NOT_FOUND</div>;

  // LOGIC: Admin can act if the file has left the Approver's hands
  const canAdminAct = sub.status !== 'pending_approver';

  return (
    <div className="h-screen bg-white flex flex-col lg:flex-row overflow-hidden border-t-8 border-yellow-500">
      <aside className="w-full lg:w-[450px] border-r-4 border-black p-8 flex flex-col overflow-y-auto bg-gray-50">
        <button onClick={() => router.back()} className={`${fonts.mono} text-gray-400 mb-8 hover:text-black transition-colors text-left`}>
          ← EXIT_LOGS
        </button>

        <header className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="bg-yellow-500 text-black text-[9px] font-black px-2 py-0.5 uppercase tracking-tighter">Admin_Override_Active</span>
            <span className={`${fonts.mono} text-gray-400`}>ID_{String(sub.id).slice(0, 8)}</span>
          </div>
          <h1 className="text-4xl font-serif italic leading-tight mb-4">{sub.file_name}</h1>
          
          <div className={`inline-block px-3 py-1 border-2 font-black ${fonts.mono} shadow-[3px_3px_0px_0px_currentColor]
            ${sub.status === 'approved' ? 'text-green-600 bg-green-50 border-green-600' : 
              sub.status.includes('declined') ? 'text-red-600 bg-red-50 border-red-600' : 
              'text-yellow-600 bg-yellow-50 border-yellow-600'}`}>
            {sub.status}
          </div>
        </header>

        {/* PREVIOUS STAGE FEEDBACK */}
        {sub.approver_comments && (
          <section className="mb-6 p-4 bg-blue-50 border-l-4 border-blue-600 shadow-sm">
            <h3 className={`${fonts.mono} text-blue-600 mb-1 font-black`}>Stage_1_Approver_Notes:</h3>
            <p className="text-sm italic text-blue-900 leading-relaxed">"{sub.approver_comments}"</p>
          </section>
        )}

        <div className="mt-auto pt-6 border-t-4 border-double border-black">
          <label className={`${fonts.mono} mb-3 block font-black text-gray-900`}>Executive_Decision_Console</label>
          
          {!canAdminAct ? (
            <div className="p-4 border-2 border-dashed border-gray-400 bg-gray-200 text-[10px] font-mono text-gray-500 uppercase">
              Awaiting_Initial_Approver_Review...
            </div>
          ) : (
            <>
              <textarea 
                value={adminComment}
                onChange={(e) => setAdminComment(e.target.value)}
                className="w-full h-24 p-4 border-2 border-black bg-white text-sm focus:ring-4 ring-yellow-400 outline-none resize-none mb-4 font-sans"
                placeholder="Modify decision or comments..."
              />
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => handleAdminAction('approved')}
                  disabled={updating}
                  className="bg-green-600 text-white py-4 font-black text-[10px] uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all"
                >
                  {sub.status === 'approved' ? 'Update_Approval' : 'Final_Approve'}
                </button>
                <button 
                  onClick={() => handleAdminAction('declined')}
                  disabled={updating}
                  className="bg-black text-white py-4 font-black text-[10px] uppercase shadow-[4px_4px_0px_0px_rgba(234,179,8,1)] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all"
                >
                  {sub.status.includes('declined') ? 'Update_Decline' : 'Final_Decline'}
                </button>
              </div>
            </>
          )}
        </div>
      </aside>

      <main className="flex-1 bg-zinc-900 flex flex-col p-8 relative">
        <div className="flex-1 bg-white border-[4px] border-black shadow-2xl flex items-center justify-center">
          {sub.file_name.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i) ? (
            <img src={sub.file_url} alt="Evidence" className="max-w-full max-h-full object-contain p-4" />
          ) : (
            <iframe src={`https://docs.google.com/gview?url=${encodeURIComponent(sub.file_url)}&embedded=true`} className="w-full h-full border-none" />
          )}
        </div>
      </main>
    </div>
  );
}