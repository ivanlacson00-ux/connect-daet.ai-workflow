'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

// ─── Styles ──────────────────────────────────────────────────────────────────
const fonts = {
  serif: 'font-serif',
};

const NEW_WINDOW_MS = 5 * 60 * 1000;

// Maps a notification event to the status it represents
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

const getStatusConfig = (status: string) => {
  const s = (status || '').toLowerCase();
  if (s === 'pending' || s === 'pending_approver') return { label: 'Under verification', classes: 'bg-pending-bg text-pending-text' };
  if (s === 'pending_admin') return { label: 'Pending approval', classes: 'bg-review-bg text-review-text' };
  if (s === 'declined_by_approver') return { label: 'Returned for correction', classes: 'bg-rejected-bg text-rejected-text' };
  if (s === 'declined_by_admin') return { label: 'Rejected', classes: 'bg-rejected-bg text-rejected-text' };
  if (s === 'completed') return { label: 'Completed', classes: 'bg-approved-bg text-approved-text' };
  if (s.includes('approved')) return { label: 'Approved', classes: 'bg-approved-bg text-approved-text' };
  if (s.includes('declined')) return { label: 'Declined', classes: 'bg-rejected-bg text-rejected-text' };
  return { label: s.replaceAll('_', ' ') || 'Unknown', classes: 'bg-sidebar text-muted-text' };
};

export default function AdminNotificationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    const { data, error } = await supabase
      .from('workflow_notifications')
      .select('*, workflow_submissions(*, profiles:user_id(email))')
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      console.error('Admin Fetch Error:', error.message);
    } else {
      // Keep only the latest notification per submission
      const latestBySubmission = new Map<string, any>();
      (data || []).forEach((notification) => {
        if (!latestBySubmission.has(notification.submission_id)) {
          latestBySubmission.set(notification.submission_id, {
            ...notification.workflow_submissions,
            id: notification.submission_id,
            notification_id: notification.id,
            updated_at: notification.created_at,
            notification_title: notification.title,
            notification_message: notification.message,
            requester_email: notification.workflow_submissions?.profiles?.email,
            notification_status: getNotificationStatus(
              notification.event_type,
              notification.workflow_submissions?.status
            ),
          });
        }
      });
      setNotifications(Array.from(latestBySubmission.values()));

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('workflow_notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('recipient_id', user.id)
          .is('read_at', null);
      }
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchNotifications();

    // Realtime: refetch whenever a new notification is inserted
    const channel = supabase
      .channel('admin-global-changes')
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

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-8 max-md:mb-5">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-clay" /> Admin workspace · Live
        </p>
        <h1 className={`${fonts.serif} text-[32px] leading-tight text-warm-text max-md:text-[26px]`}>Registry feed</h1>
        <p className="mt-2 text-xs text-muted-text max-md:mt-1.5">
          Latest activity across all submissions. Showing <span className="text-warm-text">{notifications.length}</span> updates.
        </p>
      </div>

      {/* Feed */}
      {loading ? (
        <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
          <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Loading activity...
        </div>
      ) : notifications.length === 0 ? (
        <div className="rounded-2xl border border-warm-border bg-card py-16 text-center">
          <p className={`${fonts.serif} text-2xl text-warm-text`}>Nothing here</p>
          <p className="mt-2 text-xs text-muted-text">No activity has been recorded yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((note) => {
            const status = getStatusConfig(note.notification_status || note.status);
            const isNew = Date.now() - new Date(note.updated_at).getTime() < NEW_WINDOW_MS;

            return (
              <article
                key={note.id}
                className="flex flex-col gap-4 rounded-2xl border border-warm-border bg-card px-5 py-5 transition-colors hover:border-[#d9cabb] sm:flex-row sm:items-center sm:justify-between max-md:px-3.5 max-md:py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-text">
                    {isNew && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-clay-soft px-2 py-0.5 text-[10px] font-semibold text-clay">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-clay" /> New
                      </span>
                    )}
                    <span>User {String(note.user_id ?? '').split('-')[0] || '—'}</span>
                    <span aria-hidden="true">·</span>
                    <span>Ref {String(note.id).split('-')[0]}</span>
                    <span aria-hidden="true">·</span>
                    <span>{new Date(note.updated_at).toLocaleDateString()}</span>
                  </div>

                  <p className="mt-2 text-[11px] font-semibold text-clay">
                    {note.notification_title || note.event_type?.replaceAll('_', ' ') || 'Update'}
                  </p>
                  <h3 className="mt-0.5 truncate text-sm font-semibold text-warm-text">{note.file_name}</h3>
                  <p className="mt-1 text-[11px] text-muted-text">
                    {note.tracking_number || 'Tracking pending'}
                  </p>
                  <p className="mt-1.5 line-clamp-2 break-words text-xs leading-relaxed text-muted-text">
                    <span className="text-warm-text">{note.requester_email || note.user_email || 'Requester unavailable'}</span>
                    {' — '}
                    {note.notification_message || note.description || 'No description provided.'}
                  </p>
                </div>

                <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end max-md:w-full max-md:items-stretch">
                  <div className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-medium max-md:self-start ${status.classes}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                    {status.label}
                  </div>
                  <Link
                    href={`/workflow/admin/submissions/${note.id}`}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text max-md:h-11 max-md:w-full max-md:justify-center"
                  >
                    View details <span aria-hidden="true">→</span>
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