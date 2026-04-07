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
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
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
        .select('email, full_name, role')
        .eq('id', submission.user_id)
        .single();
      if (profile) setSender(profile);

      const { data: logs } = await supabase
        .from('workflow_audit_logs')
        .select(`
          *,
          profiles:action_by (full_name, email, role)
        `)
        .eq('submission_id', id)
        .order('created_at', { ascending: false });
      if (logs) setAuditLogs(logs);
    }
    setLoading(false);
  }, [id, supabase]);

  useEffect(() => { fetchDetails(); }, [fetchDetails]);

  const getStatusStyles = (status: string) => {
    switch (status) {
      case 'pending':
      case 'pending_approver':
        return { label: 'PENDING', classes: 'border-2 border-blue-600 text-blue-600 bg-white shadow-[3px_3px_0px_0px_rgba(37,99,235,1)]' };
      case 'pending_admin':
        return { label: 'PENDING_ADMIN', classes: 'bg-blue-600 text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]' };
      case 'approved':
        return { label: 'APPROVED', classes: 'border-2 border-blue-600 text-blue-600 bg-white' };
      case 'declined_by_approver':
      case 'declined_by_admin':
        return { label: 'REJECTED', classes: 'border-2 border-red-600 text-red-600 bg-red-50' };
      default:
        return { label: status.toUpperCase(), classes: 'border-2 border-gray-400 text-gray-500' };
    }
  };

  const getActionLabel = (type: string) => {
    switch (type) {
      case 'STAGE_1_AUTHORIZED': return 'APPROVED BY';
      case 'FINAL_AUTHORIZATION': return 'FINAL APPROVAL';
      case 'FINAL_REJECTION': return 'REJECTED BY';
      case 'SUBMITTED': return 'SUBMITTED BY';
      default: return 'ACTION BY';
    }
  };

  const handleAdminAction = async (decision: 'approved' | 'declined') => {
    if (sub.status !== 'pending_admin') return;

    // Requirement check removed here to allow rejections without notes
    setUpdating(true);
    const nextStatus = decision === 'approved' ? 'approved' : 'declined_by_admin';
    const { data: { user } } = await supabase.auth.getUser();

    const { error: updateError } = await supabase
      .from('workflow_submissions')
      .update({ 
        status: nextStatus, 
        admin_comments: adminComment, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', id);

    if (!updateError) {
      await supabase.from('workflow_audit_logs').insert({
        submission_id: id,
        action_by: user?.id,
        action_type: decision === 'approved' ? 'FINAL_AUTHORIZATION' : 'FINAL_REJECTION',
        old_status: sub.status,
        new_status: nextStatus,
        comments: adminComment
      });
      await fetchDetails();
    }
    setUpdating(false);
  };

  if (loading) return <div className="p-10 font-mono text-blue-600 animate-pulse uppercase tracking-widest">Initialising Secure Connection...</div>;
  if (!sub) return <div className="p-10 font-mono text-red-500">404: RESOURCE_NOT_FOUND</div>;

  const statusConfig = getStatusStyles(sub.status);
  const isFinalized = sub.status === 'approved' || sub.status.includes('declined');

  return (
    <div className="h-screen bg-[#fafafa] flex flex-col lg:flex-row overflow-hidden border-t-[6px] border-black">
      <aside className="w-full lg:w-[500px] border-r-2 border-black flex flex-col bg-[#fafafa]">
        
        {/* Navigation */}
        <div className="px-8 pt-8">
          <button onClick={() => router.back()} className={`${fonts.mono} text-gray-400 hover:text-black transition-all flex items-center gap-2 group mb-6`}>
            ← ADMIN CONTROL PANEL
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-12 py-4 space-y-10 custom-scrollbar">
          
          {/* Main Title Section */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <span className="bg-black text-white text-[9px] font-black px-2 py-0.5 tracking-tighter">MASTER_REGISTRY // STAGE_02</span>
            </div>
            <h1 className="text-5xl font-serif italic leading-[0.8] mb-8 break-words tracking-tighter text-zinc-900">{sub.file_name}</h1>
            <div className={`inline-block px-4 py-1.5 font-black text-[11px] tracking-widest uppercase ${statusConfig.classes}`}>
              {statusConfig.label}
            </div>
          </section>

          {/* Submission Context (Category & Description) */}
          <section className="relative">
             <div className="border-2 border-black p-6 space-y-6 bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
               <div>
                 <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-2 border-b border-blue-100 pb-1 inline-block">Submission Context</p>
                 <p className={`${fonts.mono} text-[9px] text-gray-400 mb-1`}>Category</p>
                 <p className="text-xl font-black tracking-tight text-blue-600 uppercase">{sub.category || 'GENERAL'}</p>
               </div>
               <div>
                 <p className={`${fonts.mono} text-[9px] text-gray-400 mb-1`}>User_Description</p>
                 <p className="text-sm italic leading-relaxed text-zinc-600 whitespace-pre-wrap break-words border-l-2 border-zinc-100 pl-4">
                   "{sub.description || 'No description provided.'}"
                 </p>
               </div>
             </div>
          </section>

          {/* Origin Details Box */}
          <section className="relative">
            <div className="border-2 border-black p-6 space-y-4 bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
              <p className="text-[10px] font-black text-black uppercase tracking-widest border-b-2 border-black pb-1 inline-block">Origin Details</p>
              <div>
                <p className={`${fonts.mono} text-[9px] text-gray-400`}>Legal_Name</p>
                <p className="font-black text-lg tracking-tight">{sender?.full_name}</p>
              </div>
              <div>
                <p className={`${fonts.mono} text-[9px] text-gray-400`}>Email_ID</p>
                <p className="text-sm text-zinc-500">{sender?.email}</p>
              </div>
            </div>
          </section>

          {/* History / Timeline Section */}
          <section className="space-y-6 pt-4">
            <p className={`${fonts.mono} text-gray-400 border-b border-zinc-200 pb-2`}>Timeline</p>
            <div className="relative border-l-2 border-zinc-200 ml-1 space-y-10">
              {auditLogs.map((log) => (
                <div key={log.id} className="relative pl-6">
                  <div className="absolute -left-[5.5px] top-1 w-2.5 h-2.5 bg-blue-600 rounded-full ring-4 ring-white" />
                  
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-[10px] font-black uppercase text-blue-600">{getActionLabel(log.action_type)}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-black text-black">{log.profiles?.full_name || 'SYSTEM'}</p>
                    {log.profiles?.role && (
                      <span className="text-[8px] px-1.5 py-0.5 bg-zinc-200 text-zinc-600 font-bold uppercase rounded-sm tracking-tighter">
                        {log.profiles.role}
                      </span>
                    )}
                  </div>
                  <p className="text-[9px] text-gray-400 font-mono mt-0.5">
                    {new Date(log.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </p>

                  {log.comments && (
                    <div className="mt-3 p-4 bg-white border-2 border-dashed border-blue-600 relative">
                       <p className="text-[10px] font-black text-blue-600 uppercase mb-2 tracking-tighter">Reviewer Note</p>
                       <p className="text-[11px] italic leading-tight text-zinc-600 break-words">
                        "{log.comments}"
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Validation Footer */}
        {!isFinalized && (
          <div className="p-10 border-t-2 border-black bg-white">
            <div className="mb-6">
              <label className={`${fonts.mono} mb-3 block font-black text-black`}>Final Validation Notes</label>
              <textarea 
                value={adminComment}
                onChange={(e) => setAdminComment(e.target.value)}
                className="w-full h-32 p-4 border-2 border-black bg-zinc-50 text-sm italic outline-none resize-none focus:bg-white transition-colors"
                placeholder="Closing remarks for the user/system (optional)..."
              />
            </div>
            <div className="flex gap-4">
              <button onClick={() => handleAdminAction('approved')} disabled={updating} className="flex-1 bg-[#12b886] text-white py-4 font-black text-[10px] uppercase tracking-widest shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all disabled:opacity-50">
                {updating ? 'PROCESSING' : 'Final Approve'}
              </button>
              <button onClick={() => handleAdminAction('declined')} disabled={updating} className="flex-1 bg-black text-white py-4 font-black text-[10px] uppercase tracking-widest shadow-[4px_4px_0px_0px_rgba(239,68,68,1)] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all disabled:opacity-50">
                Final Decline
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Preview Section */}
      <main className="flex-1 bg-zinc-900 flex flex-col p-8 relative overflow-hidden">
        <div className="absolute top-4 left-6 z-20">
           <div className={`${fonts.mono} text-white/50 text-[9px] bg-white/5 border border-white/10 px-3 py-1 backdrop-blur-md`}>
             SECURE_ADMIN_VIEWER // UID: {sub.id.split('-')[0].toUpperCase()}
           </div>
        </div>

        <div className="flex-1 bg-white border-[4px] border-black shadow-[30px_30px_0px_0px_rgba(0,0,0,0.5)] overflow-hidden flex items-center justify-center relative">
          {sub.file_name.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i) ? (
            <div className="p-12 w-full h-full flex items-center justify-center">
              <img src={sub.file_url} alt="Secure Preview" className="max-w-full max-h-full object-contain shadow-2xl" />
            </div>
          ) : (
            <iframe src={`https://docs.google.com/gview?url=${encodeURIComponent(sub.file_url)}&embedded=true`} className="w-full h-full border-none" />
          )}
          
          {/* Subtle Watermark Overlay */}
          <div className="absolute bottom-8 right-8 pointer-events-none">
            <span className="text-[80px] font-black text-zinc-100/50 select-none tracking-tighter">CONNECT</span>
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