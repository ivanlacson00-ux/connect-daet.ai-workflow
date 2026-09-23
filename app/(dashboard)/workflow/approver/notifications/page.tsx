'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const fonts = {
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

export default function ApproverNotificationsPage() {
  const supabase = createClient();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. Initial Fetch - Focuses on PENDING items that need review
  const fetchPendingSubmissions = async () => {
    const { data, error } = await supabase
      .from('workflow_submissions')
      .select('*')
      .in('status', ['pending', 'pending_approver']) // Items under verification
      .order('updated_at', { ascending: false });

    if (error) {
      console.error("Approver Fetch Error:", error.message);
    } else {
      setNotifications(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPendingSubmissions();

    // 2. Realtime Subscription
    // Listen for new insertions (new tasks) or status changes
    const channel = supabase
      .channel('approver-queue-changes')
      .on(
        'postgres_changes',
        {
          event: '*', 
          schema: 'public',
          table: 'workflow_submissions',
        },
        (payload) => {
          if (payload.eventType === 'INSERT' && payload.new.status === 'pending') {
            setNotifications((current) => [payload.new, ...current]);
          } else if (payload.eventType === 'UPDATE') {
            // If an item is no longer pending (e.g., another approver handled it), remove it
            if (payload.new.status !== 'pending') {
              setNotifications((current) => current.filter((n) => n.id !== payload.new.id));
            } else {
              setNotifications((current) =>
                current.map((n) => (n.id === payload.new.id ? payload.new : n))
              );
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  if (loading) return <div className="p-10 font-mono text-blue-600 animate-pulse uppercase tracking-[0.3em]">Loading_Verification_Queue...</div>;

  return (
    <div className="min-h-screen bg-[#fafafa] border-t-[6px] border-blue-600 p-8 lg:p-16">
      <div className="max-w-4xl mx-auto">
        <header className="mb-12 border-b-4 border-black pb-8">
          <div>
            <span className="bg-blue-600 text-white text-[10px] font-black px-2 py-1 uppercase tracking-tighter mb-4 inline-block">
              Verification_Queue // Approver_Auth
            </span>
            <h1 className="text-6xl font-serif italic tracking-tighter leading-none text-black">Action Required</h1>
          </div>
        </header>

        <div className="space-y-6">
          {notifications.length === 0 ? (
            <div className="border-2 border-dashed border-zinc-300 p-20 text-center text-zinc-400 font-mono text-xs uppercase tracking-widest">
              Queue_Cleared // No_Pending_Submissions
            </div>
          ) : (
            notifications.map((note) => (
              <div 
                key={note.id}
                className="group relative bg-white border-2 border-black p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex-1">
                    <p className={`${fonts.mono} text-zinc-400 mb-1 flex items-center gap-2`}>
                      <span className="text-blue-500 font-bold">Stage: Verification</span>
                      <span>//</span>
                      <span>Ref: {note.id?.split('-')[0]}</span>
                      <span>//</span>
                      <span>{new Date(note.updated_at).toLocaleDateString()}</span>
                    </p>
                    <p className="font-mono text-[10px] font-bold tracking-wider text-blue-600">
                      Tracking: {note.tracking_number || 'Pending assignment'}
                    </p>
                    <h3 className="text-xl font-black uppercase tracking-tight text-black">
                      {note.file_name}
                    </h3>
                    <p className="text-xs text-zinc-500 italic mt-1 truncate max-w-md">
                      Submitted by: {note.user_email || "System_User"}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="px-4 py-1.5 border-2 border-blue-600 text-blue-600 bg-blue-50 font-black text-[10px] uppercase tracking-widest animate-pulse">
                      Awaiting Review
                    </div>
                  </div>
                </div>
                
                {/* Blue indicator for new items in queue */}
                {new Date().getTime() - new Date(note.updated_at).getTime() < 300000 && (
                  <div className="absolute -top-2 -right-2 w-4 h-4 bg-blue-600 rounded-full border-2 border-white animate-bounce" />
                )}
              </div>
            ))
          )}
        </div>

        <footer className="mt-12 pt-8 border-t border-zinc-200">
          <p className="font-mono text-[9px] text-zinc-400 text-center uppercase tracking-[0.3em]">
            Approver_Protocol_v3 // Queue_Sync_Active
          </p>
        </footer>
      </div>
    </div>
  );
}