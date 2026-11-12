'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import WorkflowNotificationFeed from '@/components/WorkflowNotificationFeed';
import SwipeDismissNotification from '@/components/SwipeDismissNotification';
import { getOfficeFileManagementPath, getOfficeNotificationsPath, type OfficeRole } from '@/lib/workflow/offices';

// ─── Styles & Fonts (synced with the dashboards) ─────────────────────────────
const fonts = {
  serif: 'font-serif',
};
const PAGE_SIZE = 30;

interface NotificationCursor {
  createdAt: string;
  id: string;
}

type EventConfig = { label: string; styles: string; needsReview?: boolean };

interface ApproverNotification {
  id: string;
  submission_id: string;
  notification_id: string;
  user_id?: string | null;
  updated_at: string;
  event_type?: string;
  notification_title?: string | null;
  notification_message?: string | null;
  status?: string;
  notification_status?: string;
  file_name?: string | null;
  tracking_number?: string | null;
  requester_email?: string;
  user_email?: string;
  is_unread: boolean;
}

const getStatusConfig = (status?: string): EventConfig => {
  const currentStatus = (status || '').toLowerCase();
  switch (currentStatus) {
    case 'pending':
    case 'pending_approver':
      return { label: 'Needs review', styles: 'bg-pending-bg text-pending-text', needsReview: true };
    case 'pending_admin':
      return { label: 'Approved · awaiting admin', styles: 'bg-approved-bg text-approved-text' };
    case 'approved':
      return { label: 'Approved', styles: 'bg-approved-bg text-approved-text' };
    case 'completed':
      return { label: 'Completed', styles: 'bg-approved-bg text-approved-text' };
    case 'pending_office':
      return { label: 'At municipal office', styles: 'bg-review-bg text-review-text' };
    case 'pending_mayor':
      return { label: "Mayor's final review", styles: 'bg-review-bg text-review-text' };
    case 'returned_for_requirements':
      return { label: 'Requirements requested', styles: 'bg-pending-bg text-pending-text' };
    case 'declined_by_approver':
    case 'declined_by_admin':
    case 'declined_by_office':
    case 'declined_by_mayor':
    case 'rejected':
      return { label: 'Declined', styles: 'bg-rejected-bg text-rejected-text' };
    default:
      return {
        label: currentStatus.replaceAll('_', ' ') || 'Unknown',
        styles: 'bg-sidebar text-muted-text',
      };
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

const getErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
};

export default function ApproverNotificationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const officePath = pathname.split('/notifications')[0];
  const officeRole: OfficeRole = officePath === '/workflow/tourism-office'
    ? 'tourism_officer'
    : officePath === '/workflow/municipal-treasurer'
      ? 'municipal_treasurer'
      : officePath === '/workflow/mayor'
        ? 'mayor_office'
        : 'sangguniang_bayan';
  const fileManagementPath = getOfficeFileManagementPath(officeRole);
  const notificationsPath = getOfficeNotificationsPath(officeRole);
  const fetchInFlight = useRef(false);
  const [notifications, setNotifications] = useState<ApproverNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<NotificationCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchNotifications = useCallback(async (
    startAfter: NotificationCursor | null,
    append = false,
    updateCursor = true
  ) => {
    if (fetchInFlight.current) return;
    fetchInFlight.current = true;
    setLoading(true);
    setErrorMessage(null);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        setNotifications([]);
        setHasMore(false);
        return;
      }

      let query = supabase
        .from('workflow_notifications')
        .select('*, workflow_submissions(*, profiles:user_id(email))')
        .eq('recipient_id', user.id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE + 1);
      if (startAfter) {
        query = query.or(
          `created_at.lt.${startAfter.createdAt},and(created_at.eq.${startAfter.createdAt},id.lt.${startAfter.id})`
        );
      }
      const { data, error } = await query;
      if (error) throw error;

      const rows = data || [];
      const pageRows = rows.slice(0, PAGE_SIZE);
      const { data: archived, error: archiveError } = pageRows.length
        ? await supabase
          .from('workflow_notification_archives')
          .select('notification_id')
          .eq('user_id', user.id)
          .in('notification_id', pageRows.map((notification) => notification.id))
        : { data: [], error: null };
      if (archiveError) throw archiveError;
      const archivedIds = new Set((archived || []).map((item) => item.notification_id));
      const pageNotifications: ApproverNotification[] = pageRows
        .filter((notification) => !archivedIds.has(notification.id))
        .map((notification) => ({
            ...notification.workflow_submissions,
            id: notification.submission_id,
            submission_id: notification.submission_id,
            notification_id: notification.id,
            event_type: notification.event_type,
            updated_at: notification.created_at,
            notification_title: notification.title,
            notification_message: notification.message,
            is_unread: !notification.read_at,
            requester_email: notification.workflow_submissions?.profiles?.email,
          }));
      setNotifications((current) => {
        const merged = new Map<string, ApproverNotification>(
          (append ? current : []).map((notification) => [notification.notification_id, notification])
        );
        pageNotifications.forEach((notification) => merged.set(notification.notification_id, notification));
        return Array.from(merged.values()).sort(
          (first, second) => Date.parse(second.updated_at) - Date.parse(first.updated_at)
        );
      });
      if (updateCursor) {
        const lastRow = pageRows.at(-1);
        setCursor(lastRow ? { createdAt: lastRow.created_at, id: lastRow.id } : startAfter);
        setHasMore(rows.length > PAGE_SIZE);
      }
    } catch (error) {
      const message = getErrorMessage(error, 'Could not load notifications.');
      console.error('Failed to load approver notifications:', message);
      setErrorMessage(message);
      if (!append) setNotifications([]);
      setHasMore(false);
    } finally {
      fetchInFlight.current = false;
      setLoading(false);
    }
  }, [supabase]);

  const archiveNotification = async (notificationId: string) => {
    if (actionBusy) return;
    setActionBusy(true);
    setErrorMessage(null);
    try {
      const { error } = await supabase.rpc('archive_workflow_notification', {
        target_notification_id: notificationId,
      });
      if (error) throw error;
      setNotifications((current) => current.filter((notification) => notification.notification_id !== notificationId));
      window.dispatchEvent(new Event('workflow-notifications-changed'));
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Could not archive the notification.'));
    } finally {
      setActionBusy(false);
    }
  };

  const clearNotifications = async () => {
    setActionBusy(true);
    setErrorMessage(null);
    try {
      const { error } = await supabase.rpc('archive_all_workflow_notifications');
      if (error) throw error;
      setNotifications([]);
      setCursor(null);
      setHasMore(false);
      window.dispatchEvent(new Event('workflow-notifications-changed'));
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Could not archive notifications.'));
    } finally {
      setActionBusy(false);
    }
  };

  const openNotification = async (
    event: MouseEvent<HTMLAnchorElement>,
    notification: ApproverNotification
  ) => {
    event.preventDefault();
    try {
      if (notification.is_unread) {
        setErrorMessage(null);
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) throw userError || new Error('Sign in before opening notifications.');
        const { error } = await supabase
          .from('workflow_notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', notification.notification_id)
          .eq('recipient_id', user.id);
        if (error) throw error;
        setNotifications((current) => current.map((item) =>
          item.notification_id === notification.notification_id ? { ...item, is_unread: false } : item
        ));
        window.dispatchEvent(new Event('workflow-notifications-changed'));
      }
      router.push(`${fileManagementPath}/${notification.id}`);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Could not open this notification.'));
    }
  };

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | undefined;

    void fetchNotifications(null);
    void supabase.auth.getUser().then(({ data, error }) => {
      if (error) {
        console.error('Could not start approver notification updates:', error.message);
        return;
      }
      if (!active || !data.user) return;

      channel = supabase
        .channel(`approver-notifications-${data.user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'workflow_notifications',
            filter: `recipient_id=eq.${data.user.id}`,
          },
          () => void fetchNotifications(null, true, false)
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'workflow_submissions',
          },
          () => void fetchNotifications(null, true, false)
        )
        .subscribe((status, subscribeError) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error(
              'Approver notification realtime subscription failed:',
              subscribeError?.message || status
            );
          }
        });
    });

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, fetchNotifications]);

  const needsReviewCount = useMemo(
    () => notifications.filter(n => getStatusConfig(n.status).needsReview).length,
    [notifications]
  );
  const unreadCount = useMemo(
    () => notifications.filter((notification) => notification.is_unread).length,
    [notifications]
  );

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-8 max-md:mb-5">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Office workspace
        </p>
        <h1 className={`${fonts.serif} text-[32px] leading-tight text-warm-text max-md:text-[26px]`}>Notifications</h1>
        <p className="mt-2 text-xs text-muted-text max-md:mt-1.5">
          {loading
            ? 'Checking for updates...'
            : `${needsReviewCount} ${needsReviewCount === 1 ? 'submission needs' : 'submissions need'} your review · ${unreadCount} unread`}
        </p>
      </div>

      <WorkflowNotificationFeed
        archiveHref={`${notificationsPath}/archive`}
        busy={actionBusy || loading}
        canClear={notifications.length > 0}
        hasMore={hasMore}
        loading={loading}
        actionLabel="Clear all"
        iconOnlyAction
        actionConfirmation="Clear all notifications from this feed? They will be moved to your archive, where you can permanently delete them."
        onClear={clearNotifications}
        onLoadMore={() => fetchNotifications(cursor, true)}
      >
        {errorMessage && (
          <p role="alert" className="mb-4 rounded-xl border border-rejected-bg bg-rejected-bg/40 px-4 py-3 text-xs text-rejected-text">
            {errorMessage}
          </p>
        )}

        {/* List header */}
        <div className="mb-4 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-warm-text">Recent activity</h2>
        <span className="rounded-md bg-sidebar px-2 py-1 text-[10px] font-medium text-muted-text">{notifications.length}</span>
      </div>

      {loading && notifications.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
          <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Syncing notifications...
        </div>
      ) : notifications.length === 0 ? (
        <div className="rounded-2xl border border-warm-border bg-card py-20 text-center">
          <p className={`${fonts.serif} text-2xl text-warm-text`}>No notifications yet</p>
          <p className="mt-2 text-xs text-muted-text">New submissions and updates will appear here.</p>
        </div>
      ) : (
        <div role="list" className="space-y-3">
          {notifications.map((note) => {
            const config = getStatusConfig(note.status);
            const title = note.notification_title || note.event_type?.replaceAll('_', ' ') || 'Update';

            return (
              <SwipeDismissNotification
                key={note.notification_id}
                onDismiss={() => void archiveNotification(note.notification_id)}
                label={`Archive notification for ${note.file_name || 'submission'}`}
                actionText="Archive"
                busy={actionBusy}
              >
                <Link
                  href={`${fileManagementPath}/${note.id}`}
                  onClick={(event) => void openNotification(event, note)}
                  className="group flex flex-col gap-5 border border-warm-border bg-card px-5 py-5 pr-14 transition-colors hover:border-clay-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-clay sm:flex-row sm:items-center sm:justify-between max-md:gap-3 max-md:px-3.5 max-md:pr-14 max-md:py-3.5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <div className="relative flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-sidebar text-muted-text">
                      <span className="text-lg leading-4" aria-hidden="true">▤</span>
                      <span className="mt-1 text-[8px] font-semibold uppercase">
                        {note.file_name?.split('.').at(-1)?.slice(0, 3) || 'File'}
                      </span>
                      {note.is_unread && (
                        <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-card bg-clay" aria-label="Unread" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        {note.is_unread && (
                          <span className="rounded-md bg-clay-soft px-2 py-1 text-[10px] font-medium text-clay">Unread</span>
                        )}
                        <span className="text-[11px] font-medium text-warm-text">{title}</span>
                      </div>

                      <h3 className="truncate text-sm font-semibold text-warm-text group-hover:text-clay">
                        {note.file_name || 'Untitled file'}
                      </h3>

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
                    <span className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors group-hover:bg-warm-text max-md:h-11 max-md:w-full">
                      View document <span aria-hidden="true">→</span>
                    </span>
                  </div>
                </Link>
              </SwipeDismissNotification>
            );
          })}
        </div>
      )}
      </WorkflowNotificationFeed>
    </div>
  );
}