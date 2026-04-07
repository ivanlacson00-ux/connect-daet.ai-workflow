'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const fonts = {
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

export default function AdminNotificationsPage() {
  const supabase = createClient();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. Initial Fetch - Gets ALL submissions across the entire system
  const fetchAllSubmissions = async () => {
    const { data, error } = await supabase
      .from('workflow_submissions')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(30); // Higher limit for admin oversight

    if (error) {
      console.error("Admin Fetch Error:", error.message);
    } else {
      setNotifications(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAllSubmissions();

    // 2. Realtime Subscription - Listens for ANY change in the table
    const channel = supabase
      .channel('admin-global-changes')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for INSERTs and UPDATEs
          schema: 'public',
          table: 'workflow_submissions',
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setNotifications((current) => [payload.new, ...current].slice(0, 30));
          } else if (payload.eventType === 'UPDATE') {
            setNotifications((current) =>
              current.map((n) => (n.id === payload.new.id ? payload.new : n))
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const getStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('approved')) return 'text-green-600 border-green-600 bg-green-50';
    if (s.includes('declined')) return 'text-red-600 border-red-600 bg-red-50';
    if (s.includes('pending')) return 'text-blue-600 border-blue-600 bg-blue-50';
    return 'text-zinc-400 border-zinc-400 bg-zinc-50';
  };

  if (loading) return <div className="p-10 font-mono text-red-600 animate-pulse uppercase tracking-[0.3em]">Loading_Global_Stream...</div>;

  return (
    <div className="min-h-screen bg-[#fafafa] border-t-[6px] border-red-600 p-8 lg:p-16">
      <div className="max-w-4xl mx-auto">
        <header className="mb-12 border-b-4 border-black pb-8">
          <div>
            <span className="bg-red-600 text-white text-[10px] font-black px-2 py-1 uppercase tracking-tighter mb-4 inline-block">
              Global_System_Monitor // Admin_View
            </span>
            <h1 className="text-6xl font-serif italic tracking-tighter leading-none text-black">Registry Feed</h1>
          </div>
        </header>

        <div className="space-y-6">
          {notifications.length === 0 ? (
            <div className="border-2 border-dashed border-zinc-300 p-20 text-center text-zinc-400 font-mono text-xs uppercase tracking-widest">
              Zero_Global_Activity_Detected
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
                      <span className="text-red-500 font-bold">UID: {note.user_id.split('-')[0]}</span>
                      <span>//</span>
                      <span>Ref: {note.id.split('-')[0]}</span>
                      <span>//</span>
                      <span>{new Date(note.updated_at).toLocaleDateString()}</span>
                    </p>
                    <h3 className="text-xl font-black uppercase tracking-tight text-black">
                      {note.file_name}
                    </h3>
                    <p className="text-xs text-zinc-500 italic mt-1 truncate max-w-md">
                      Owner: {note.user_email || "System_User"} — {note.description || "No description provided."}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className={`px-4 py-1.5 border-2 font-black text-[10px] uppercase tracking-widest ${getStatusColor(note.status)}`}>
                      {note.status.replace(/_/g, ' ')}
                    </div>
                  </div>
                </div>
                
                {/* Visual Indicator for New Updates (within last 5 mins) */}
                {new Date().getTime() - new Date(note.updated_at).getTime() < 300000 && (
                  <div className="absolute -top-2 -right-2 w-4 h-4 bg-red-600 rounded-full border-2 border-white animate-bounce" />
                )}
              </div>
            ))
          )}
        </div>

        <footer className="mt-12 pt-8 border-t border-zinc-200">
          <p className="font-mono text-[9px] text-zinc-400 text-center uppercase tracking-[0.3em]">
            Level_04_Authorization // Global_Broadcast_Active
          </p>
        </footer>
      </div>
    </div>
  );
}