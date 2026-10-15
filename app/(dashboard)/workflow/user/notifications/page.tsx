'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

// ─── Styles & Fonts (synced with dashboard) ──────────────────────────────────
const fonts = {
  serif: "font-serif",
  mono: "font-sans text-xs",
};

// "5 min ago", "2 hours ago", "3 days ago"
const timeAgo = (dateString: string) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(dateString).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(dateString).toLocaleDateString();
};

// What the notification says, and how it looks, based on the submission status
const getNotificationContent = (status: string) => {
  if (status.includes('approved')) {
    return { icon: '✓', iconStyles: 'bg-approved-bg text-approved-text', message: 'was approved.' };
  }
  if (status.includes('declined') || status.includes('rejected')) {
    return { icon: '✕', iconStyles: 'bg-rejected-bg text-rejected-text', message: 'was rejected.' };
  }
  if (status === 'pending_admin') {
    return { icon: '◷', iconStyles: 'bg-review-bg text-review-text', message: 'is now under review.' };
  }
  if (status.includes('pending')) {
    return { icon: '◷', iconStyles: 'bg-pending-bg text-pending-text', message: 'was submitted and is waiting for review.' };
  }
  return { icon: '●', iconStyles: 'bg-sidebar text-muted-text', message: `status changed to ${status.replace(/_/g, ' ')}.` };
};

const isNewUpdate = (updatedAt: string) => Date.now() - new Date(updatedAt).getTime() < 300000;

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

  if (loading) {
    return (
      <div className="w-full">
        <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
          <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Loading notifications...
        </div>
      </div>
    );
  }

  // Split into "Today" and "Earlier" groups (list is already newest first)
  const todayString = new Date().toDateString();
  const groups = [
    { title: 'Today', items: notifications.filter(n => new Date(n.updated_at).toDateString() === todayString) },
    { title: 'Earlier', items: notifications.filter(n => new Date(n.updated_at).toDateString() !== todayString) },
  ].filter(g => g.items.length > 0);

  const newCount = notifications.filter(n => isNewUpdate(n.updated_at)).length;

  return (
    <div className="w-full">
      <div>
        <header className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end max-md:mb-5">
          <div>
            <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
              <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Live updates
            </p>
            <h1 className={`${fonts.serif} text-[32px] leading-tight text-warm-text max-md:text-[26px]`}>Notifications</h1>
          </div>
          {newCount > 0 && (
            <span className="inline-flex items-center gap-2 self-start rounded-full bg-clay-soft px-3 py-1.5 text-[11px] font-semibold text-clay sm:self-auto">
              <span className="h-1.5 w-1.5 rounded-full bg-clay" />
              {newCount} new {newCount === 1 ? 'update' : 'updates'}
            </span>
          )}
        </header>

        {notifications.length === 0 ? (
          <div className="rounded-2xl border border-warm-border bg-card py-20 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sidebar text-lg text-muted-text" aria-hidden="true">🔔</div>
            <p className={`${fonts.serif} text-2xl text-warm-text`}>No notifications yet</p>
            <p className="mt-2 text-xs text-muted-text">Updates on your submissions will appear here.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map(group => (
              <section key={group.title}>
                <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-text">{group.title}</h2>

                <ul className="divide-y divide-warm-border overflow-hidden rounded-2xl border border-warm-border bg-card">
                  {group.items.map((note) => {
                    const content = getNotificationContent(note.status);
                    const isNew = isNewUpdate(note.updated_at);
                    const isRejected = note.status.includes('declined') || note.status.includes('rejected');
                    const feedback = isRejected ? (note.admin_comments || note.approver_comments) : null;

                    return (
                      <li
                        key={note.id}
                        className={`relative flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-sidebar/50 sm:flex-row sm:items-start sm:justify-between max-md:px-3.5 ${isNew ? 'bg-clay-soft/40' : ''}`}
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-3.5">
                          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${content.iconStyles}`} aria-hidden="true">
                            {content.icon}
                          </span>

                          <div className="min-w-0 flex-1">
                            <p className="text-sm leading-snug text-warm-text">
                              <span className="font-semibold">{note.file_name}</span> {content.message}
                            </p>

                            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-text">
                              <span>{timeAgo(note.updated_at)}</span>
                              <span aria-hidden="true">·</span>
                              <span>{note.id.split('-')[0].toUpperCase()}</span>
                              {isNew && (
                                <span className="rounded-full bg-clay px-2 py-0.5 text-[10px] font-semibold text-white">New</span>
                              )}
                            </div>

                            {feedback ? (
                              <p className="mt-2 line-clamp-2 border-l-2 border-rejected-bg pl-3 font-serif text-sm leading-relaxed text-warm-text">
                                "{feedback}"
                              </p>
                            ) : (
                              <p className="mt-1.5 max-w-xl truncate text-xs text-muted-text">
                                {note.description || "No description provided."}
                              </p>
                            )}
                          </div>
                        </div>

                        <Link
                          href={`/workflow/user/file_registry/${note.id}`}
                          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 self-start whitespace-nowrap rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text sm:self-center max-md:h-11 max-md:w-full max-md:self-stretch"
                        >
                          View details <span aria-hidden="true">→</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        <footer className="mt-8 border-t border-warm-border pt-6">
          <p className="text-center text-[11px] text-muted-text">
            You're all caught up.
          </p>
        </footer>
      </div>
    </div>
  );
}