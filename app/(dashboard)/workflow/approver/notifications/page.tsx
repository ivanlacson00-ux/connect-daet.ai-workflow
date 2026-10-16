'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

// ─── Styles & Fonts (synced with the dashboards) ─────────────────────────────
const fonts = {
  serif: 'font-serif',
};

// ─── Event config ────────────────────────────────────────────────────────────
// Approving a file passes it to the admin, so VERIFICATION_PASSED reads as approved here
type EventConfig = { label: string; styles: string; needsReview?: boolean };

const getEventConfig = (eventType?: string, fallbackStatus?: string): EventConfig => {
  switch (eventType) {
    case 'SUBMITTED':
      return { label: 'Needs review', styles: 'bg-pending-bg text-pending-text', needsReview: true };
    case 'VERIFICATION_PASSED':
    case 'FINAL_APPROVAL':
    case 'WORKFLOW_COMPLETED':
      return { label: 'Approved', styles: 'bg-approved-bg text-approved-text' };
    case 'RETURNED_FOR_CORRECTION':
    case 'FINAL_REJECTION':
      return { label: 'Declined', styles: 'bg-rejected-bg text-rejected-text' };
    default: {
      const s = (fallbackStatus || '').toLowerCase();
      if (['pending', 'pending_approver'].includes(s)) {
        return { label: 'Needs review', styles: 'bg-pending-bg text-pending-text', needsReview: true };
      }
      if (['pending_admin', 'approved', 'completed'].includes(s)) {
        return { label: 'Approved', styles: 'bg-approved-bg text-approved-text' };
      }
      if (['declined_by_approver', 'declined_by_admin', 'rejected'].includes(s)) {
        return { label: 'Declined', styles: 'bg-rejected-bg text-rejected-text' };
      }
      return { label: s.replaceAll('_', ' ') || 'Update', styles: 'bg-sidebar text-muted-text' };
    }
  }
};

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(iso).toLocaleDateString();
};

export default function ApproverNotificationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('workflow_notifications')
        .select('*, workflow_submissions(*, profiles:user_id(email))')
        .eq('recipient_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) {
        console.error('Approver fetch error:', error.message);
        return;
      }

      // Keep only the latest notification for each submission
      const latestBySubmission = new Map<string, any>();
      (data || []).forEach((notification) => {
        if (!latestBySubmission.has(notification.submission_id)) {
          latestBySubmission.set(notification.submission_id, {
            ...notification.workflow_submissions,
            id: notification.submission_id,
            notification_id: notification.id,
            event_type: notification.event_type,
            updated_at: notification.created_at,
            notification_title: notification.title,
            notification_message: notification.message,
            is_unread: !notification.read_at,
            requester_email: notification.workflow_submissions?.profiles?.email,
          });
        }
      });
      setNotifications(Array.from(latestBySubmission.values()));

      // Mark as read (the unread flag above is captured first, so new items still show as new)
      await supabase
        .from('workflow_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_id', user.id)
        .is('read_at', null);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchNotifications();

    // Realtime: refresh when a new notification arrives
    const channel = supabase
      .channel('approver-queue-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'workflow_notifications' },
        () => fetchNotifications()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, fetchNotifications]);

  const needsReviewCount = useMemo(
    () => notifications.filter(n => getEventConfig(n.event_type, n.status).needsReview).length,
    [notifications]
  );

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-8 max-md:mb-5">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Approver workspace
        </p>
        <h1 className={`${fonts.serif} text-[32px] leading-tight text-warm-text max-md:text-[26px]`}>Notifications</h1>
        <p className="mt-2 text-xs text-muted-text max-md:mt-1.5">
          {loading
            ? 'Checking for updates...'
            : needsReviewCount > 0
              ? `${needsReviewCount} ${needsReviewCount === 1 ? 'submission needs' : 'submissions need'} your review.`
              : 'You\'re all caught up.'}
        </p>
      </div>

      {/* List header */}
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-warm-text">Recent activity</h2>
        <span className="rounded-md bg-sidebar px-2 py-1 text-[10px] font-medium text-muted-text">{notifications.length}</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
          <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Syncing notifications...
        </div>
      ) : notifications.length === 0 ? (
        <div className="rounded-2xl border border-warm-border bg-card py-20 text-center">
          <p className={`${fonts.serif} text-2xl text-warm-text`}>No notifications yet</p>
          <p className="mt-2 text-xs text-muted-text">New submissions and updates will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((note) => {
            const config = getEventConfig(note.event_type, note.status);
            const title = note.notification_title || note.event_type?.replaceAll('_', ' ') || 'Update';

            return (
              <article
                key={note.id}
                className="group flex flex-col gap-5 rounded-2xl border border-warm-border bg-card px-5 py-5 transition-colors hover:border-[#d9cabb] sm:flex-row sm:items-center sm:justify-between max-md:gap-3 max-md:px-3.5 max-md:py-3.5"
              >
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="relative flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-sidebar text-muted-text">
                    <span className="text-lg leading-4" aria-hidden="true">▤</span>
                    <span className="mt-1 text-[8px] font-semibold uppercase">
                      {note.file_name?.split('.').at(-1)?.slice(0, 3) || 'File'}
                    </span>
                    {note.is_unread && (
                      <span
                        className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-card bg-clay"
                        aria-label="New"
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      {note.is_unread && (
                        <span className="rounded-md bg-clay-soft px-2 py-1 text-[10px] font-medium text-clay">New</span>
                      )}
                      <span className="text-[11px] font-medium text-warm-text">{title}</span>
                    </div>

                    <h3 className="truncate text-sm font-semibold text-warm-text group-hover:text-clay">
                      {note.file_name || 'Untitled file'}
                    </h3>

                    {note.notification_message && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-text">{note.notification_message}</p>
                    )}

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-text">
                      <span className="truncate">From {note.requester_email || note.user_email || 'unknown submitter'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{timeAgo(note.updated_at)}</span>
                      {note.tracking_number && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Tracking {note.tracking_number}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:justify-end max-md:w-full max-md:flex-col max-md:items-stretch">
                  <div className="max-md:self-start">
                    <span className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-medium ${config.styles}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                      {config.label}
                    </span>
                  </div>
                  <Link
                    href={`/workflow/approver/file_management/${note.id}`}
                    className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text max-md:h-11 max-md:w-full"
                  >
                    {config.needsReview ? 'Review file' : 'View entry'} <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}