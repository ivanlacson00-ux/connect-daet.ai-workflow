'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import WorkflowNotificationControls, { type NotificationFilter } from '@/components/WorkflowNotificationControls';

// ─── Styles ──────────────────────────────────────────────────────────────────
const fonts = {
  serif: 'font-serif',
};

const NEW_WINDOW_MS = 5 * 60 * 1000;
const PAGE_SIZE = 30;

interface AdminNotification {
  id: string;
  submission_id: string;
  notification_id: string;
  user_id: string | null;
  updated_at: string;
  event_type?: string | null;
  notification_title?: string | null;
  notification_message?: string | null;
  notification_status?: string | null;
  status?: string | null;
  file_name?: string | null;
  tracking_number?: string | null;
  requester_email?: string | null;
  user_email?: string | null;
  is_new: boolean;
  is_unread: boolean;
}

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
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [page, setPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchNotifications = useCallback(async (targetPage = page) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        setNotifications([]);
        setHasNextPage(false);
        return;
      }

      let query = supabase
        .from('workflow_notifications')
        .select('*, workflow_submissions(*, profiles:user_id(email))', { count: 'exact' })
        .order('created_at', { ascending: false });
      if (filter === 'unread') {
        query = query.eq('recipient_id', user.id).is('read_at', null);
      }
      const { data, error, count } = await query.range(
        targetPage * PAGE_SIZE,
        targetPage * PAGE_SIZE + PAGE_SIZE - 1
      );
      if (error) throw error;
      const rows = data || [];
      const { data: dismissed, error: dismissedError } = rows.length
        ? await supabase
          .from('workflow_notification_dismissals')
          .select('notification_id')
          .eq('user_id', user.id)
          .in('notification_id', rows.map((notification) => notification.id))
        : { data: [], error: null };
      if (dismissedError) throw dismissedError;
      const dismissedIds = new Set((dismissed || []).map((item) => item.notification_id));

      // Keep only the latest notification per submission
      const latestBySubmission = new Map<string, AdminNotification>();
      rows.forEach((notification) => {
        if (dismissedIds.has(notification.id)) return;
        if (!latestBySubmission.has(notification.submission_id)) {
          latestBySubmission.set(notification.submission_id, {
            ...notification.workflow_submissions,
            id: notification.submission_id,
            submission_id: notification.submission_id,
            notification_id: notification.id,
            updated_at: notification.created_at,
            notification_title: notification.title,
            notification_message: notification.message,
            requester_email: notification.workflow_submissions?.profiles?.email,
            notification_status: getNotificationStatus(
              notification.event_type,
              notification.workflow_submissions?.status
            ),
            is_new: Date.now() - new Date(notification.created_at).getTime() < NEW_WINDOW_MS,
            is_unread: notification.recipient_id === user.id && !notification.read_at,
          });
        }
      });
      const visibleNotifications = Array.from(latestBySubmission.values());
      setNotifications(visibleNotifications);
      setHasNextPage(
        visibleNotifications.length > 0 && (targetPage + 1) * PAGE_SIZE < (count || 0)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load notifications.';
      console.error('Failed to load admin notifications:', message);
      setErrorMessage(message);
      setNotifications([]);
      setHasNextPage(false);
    } finally {
      setLoading(false);
    }
  }, [filter, page, supabase]);

  const markAllAsRead = async () => {
    setActionBusy(true);
    setErrorMessage(null);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        setErrorMessage(userError?.message || 'Sign in before updating notifications.');
        return;
      }
      const { error } = await supabase
        .from('workflow_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_id', user.id)
        .is('read_at', null);
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      window.dispatchEvent(new Event('workflow-notifications-changed'));
      await fetchNotifications();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not mark notifications as read.');
    } finally {
      setActionBusy(false);
    }
  };

  const clearNotifications = async () => {
    setActionBusy(true);
    setErrorMessage(null);
    try {
      const { error } = await supabase.rpc('dismiss_all_workflow_notifications');
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      window.dispatchEvent(new Event('workflow-notifications-changed'));
      setPage(0);
      await fetchNotifications(0);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not clear notifications.');
    } finally {
      setActionBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void fetchNotifications();
    });

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
      active = false;
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
          Latest activity across all submissions. Showing <span className="text-warm-text">{notifications.length}</span> updates, including <span className="text-warm-text">{notifications.filter((notification) => notification.is_unread).length}</span> unread for your account.
        </p>
      </div>

      <WorkflowNotificationControls
        filter={filter}
        onFilterChange={(nextFilter) => {
          setFilter(nextFilter);
          setPage(0);
        }}
        notificationCount={notifications.length}
        unreadCount={notifications.filter((notification) => notification.is_unread).length}
        page={page}
        hasNextPage={hasNextPage}
        busy={actionBusy || loading}
        onPreviousPage={() => setPage((current) => Math.max(0, current - 1))}
        onNextPage={() => setPage((current) => current + 1)}
        onMarkAllRead={markAllAsRead}
        onClearNotifications={clearNotifications}
      />
      {errorMessage && (
        <p role="alert" className="mb-4 rounded-xl border border-rejected-bg bg-rejected-bg/40 px-4 py-3 text-xs text-rejected-text">
          {errorMessage}
        </p>
      )}

      {/* Feed */}
      {loading ? (
        <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
          <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Loading activity...
        </div>
      ) : notifications.length === 0 ? (
        <div className="rounded-2xl border border-warm-border bg-card py-16 text-center">
          <p className={`${fonts.serif} text-2xl text-warm-text`}>
            {filter === 'unread' ? 'No unread notifications' : 'Nothing here'}
          </p>
          <p className="mt-2 text-xs text-muted-text">
            {filter === 'unread' ? 'You have no unread updates.' : 'No activity has been recorded yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((note) => {
            const status = getStatusConfig(note.notification_status || note.status || '');

            return (
              <article
                key={note.id}
                className="flex flex-col gap-4 rounded-2xl border border-warm-border bg-card px-5 py-5 transition-colors hover:border-clay-border sm:flex-row sm:items-center sm:justify-between max-md:px-3.5 max-md:py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-text">
                    {note.is_new && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-clay-soft px-2 py-0.5 text-[10px] font-semibold text-clay">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-clay" /> New
                      </span>
                    )}
                    {note.is_unread && (
                      <span className="inline-flex items-center rounded-full bg-pending-bg px-2 py-0.5 text-[10px] font-semibold text-pending-text">
                        Unread for you
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