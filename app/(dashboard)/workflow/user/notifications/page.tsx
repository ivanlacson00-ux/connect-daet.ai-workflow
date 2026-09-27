'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const fonts = {
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

export default function NotificationsPage() {
  const supabase = createClient();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const getNotificationStatus = (eventType: string, currentStatus: string) => {
    switch (eventType) {
      case 'SUBMITTED':
        return 'pending';
      case 'VERIFICATION_PASSED':
        return 'pending_admin';
      case 'RETURNED_FOR_CORRECTION':
        return 'declined_by_approver';
      case 'FINAL_APPROVAL':
        return 'approved';
      case 'FINAL_REJECTION':
        return 'declined_by_admin';
      case 'WORKFLOW_COMPLETED':
        return 'completed';
      default:
        return currentStatus;
    }
  };

  const fetchNotifications = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('workflow_notifications')
      .select('*, workflow_submissions(*, profiles:user_id(email))')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (data) {
      const latestBySubmission = new Map<string, any>();
      data.forEach((notification) => {
        if (!latestBySubmission.has(notification.submission_id)) {
          latestBySubmission.set(notification.submission_id, {
            ...notification.workflow_submissions,
            id: notification.submission_id,
            notification_id: notification.id,
            notification_title: notification.title,
            notification_message: notification.message,
            requester_email: notification.workflow_submissions?.profiles?.email,
            notification_status: getNotificationStatus(
              notification.event_type,
              notification.workflow_submissions?.status
            ),
            updated_at: notification.created_at,
          });
        }
      });
      setNotifications(Array.from(latestBySubmission.values()));
      await supabase
        .from('workflow_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_id', user.id)
        .is('read_at', null);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchNotifications();

    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'workflow_notifications',
        },
        () => fetchNotifications()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const getStatusColor = (status: string) => {
    if (status.includes('approved')) return 'text-green-600 border-green-600 bg-green-50';
    if (status.includes('declined')) return 'text-red-600 border-red-600 bg-red-50';
    if (status.includes('pending')) return 'text-blue-600 border-blue-600 bg-blue-50';
    return 'text-zinc-400 border-zinc-400 bg-zinc-50';
  };

  const getStatusLabel = (status: string) => {
    if (status === 'pending' || status === 'pending_approver') return 'UNDER VERIFICATION';
    if (status === 'pending_admin') return 'PENDING APPROVAL';
    if (status === 'declined_by_approver') return 'RETURNED FOR CORRECTION';
    if (status === 'declined_by_admin') return 'REJECTED';
    return status.replace(/_/g, ' ').toUpperCase();
  };

  if (loading) return <div className="p-10 font-mono text-blue-600 animate-pulse uppercase tracking-[0.3em]">Syncing_Registry...</div>;

  return (
    <div className="min-h-screen bg-[#fafafa] border-t-[6px] border-black p-8 lg:p-16">
      <div className="max-w-4xl mx-auto">
        <header className="mb-12 border-b-4 border-black pb-8">
          <div>
            <span className="bg-black text-white text-[10px] font-black px-2 py-1 uppercase tracking-tighter mb-4 inline-block">
              User_Activity_Feed // Live
            </span>
            <h1 className="text-6xl font-serif italic tracking-tighter leading-none">Notifications</h1>
          </div>
        </header>

        <div className="space-y-6">
          {notifications.length === 0 ? (
            <div className="border-2 border-dashed border-zinc-300 p-20 text-center text-zinc-400 font-mono text-xs uppercase tracking-widest">
              No_Active_Notifications_Found
            </div>
          ) : (
            notifications.map((note) => (
              <div 
                key={note.id}
                className="group relative bg-white border-2 border-black p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex-1">
                    <p className={`${fonts.mono} text-zinc-400 mb-1`}>
                      Ref: {note.id.split('-')[0]} // {new Date(note.updated_at).toLocaleDateString()}
                    </p>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-blue-600">
                      {note.notification_title || note.event_type?.replace(/_/g, ' ')}
                    </p>
                    <p className="font-mono text-[10px] font-bold tracking-wider text-blue-600">
                      Tracking: {note.tracking_number || 'Pending assignment'}
                    </p>
                    <h3 className="text-xl font-black uppercase tracking-tight">
                      {note.file_name}
                    </h3>
                    <p className="text-xs text-zinc-500 italic mt-1 truncate max-w-md">
                      {note.description || "No description provided."}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className={`px-4 py-1.5 border-2 font-black text-[10px] uppercase tracking-widest ${getStatusColor(note.notification_status || note.status)}`}>
                      {getStatusLabel(note.notification_status || note.status)}
                    </div>
                  </div>
                </div>
                
                {/* Visual Indicator for New Updates (within last 5 mins) */}
                {new Date().getTime() - new Date(note.updated_at).getTime() < 300000 && (
                  <div className="absolute -top-2 -right-2 w-4 h-4 bg-blue-600 rounded-full border-2 border-white animate-bounce" />
                )}
              </div>
            ))
          )}
        </div>

        <footer className="mt-12 pt-8 border-t border-zinc-200">
          <p className="font-mono text-[9px] text-zinc-400 text-center uppercase tracking-[0.3em]">
            Secure encrypted stream // end_of_data
          </p>
        </footer>
      </div>
    </div>
  );
}