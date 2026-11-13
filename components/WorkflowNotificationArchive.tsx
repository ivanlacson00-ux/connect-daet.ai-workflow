'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SwipeDismissNotification from '@/components/SwipeDismissNotification';
import WorkflowNotificationFeed from '@/components/WorkflowNotificationFeed';
import { useWorkflowRole } from '@/lib/workflow/role-context';
import {
  getOfficeFileManagementPath,
  getOfficeNotificationsPath,
  getRoleHomePath,
  isOfficeRole,
  type OfficeRole,
} from '@/lib/workflow/offices';

type ArchiveRole = 'submitter' | 'system_admin' | OfficeRole;

interface ArchiveCursor {
  archivedAt: string;
  notificationId: string;
}

interface ArchivedNotification {
  id: string;
  notificationId: string;
  title?: string;
  message?: string;
  eventType?: string;
  fileName?: string | null;
  trackingNumber?: string | null;
  status?: string | null;
  requesterEmail?: string | null;
  archivedAt: string;
  isUnread: boolean;
}

const PAGE_SIZE = 30;

const getErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
};

const getStatusConfig = (status: string) => {
  const value = (status || '').toLowerCase();
  if (value === 'pending' || value === 'pending_approver') {
    return { label: 'Under review', styles: 'bg-pending-bg text-pending-text' };
  }
  if (value === 'pending_admin') {
    return { label: 'Under review', styles: 'bg-review-bg text-review-text' };
  }
  if (value === 'completed') {
    return { label: 'Completed', styles: 'bg-approved-bg text-approved-text' };
  }
  if (value.includes('approved')) {
    return { label: 'Approved', styles: 'bg-approved-bg text-approved-text' };
  }
  if (value.includes('declined') || value.includes('rejected')) {
    return { label: 'Returned for correction', styles: 'bg-rejected-bg text-rejected-text' };
  }
  return { label: value.replaceAll('_', ' ') || 'Unknown', styles: 'bg-sidebar text-muted-text' };
};

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

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(iso).toLocaleDateString();
};

export default function WorkflowNotificationArchive({ role }: { role: ArchiveRole }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const viewerRole = useWorkflowRole();
  const fetchInFlight = useRef(false);
  const [notifications, setNotifications] = useState<ArchivedNotification[]>([]);
  const [cursor, setCursor] = useState<ArchiveCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const basePath = getRoleHomePath(role);
  const notificationPath = role === 'submitter' || role === 'system_admin'
    ? `${basePath}/notifications`
    : getOfficeNotificationsPath(role);
  const detailPath = role === 'submitter'
    ? `${basePath}/file_registry`
    : role === 'system_admin'
      ? `${basePath}/submissions`
      : getOfficeFileManagementPath(role);
  const adminOfficeQuery = viewerRole === 'system_admin' && isOfficeRole(role)
    ? `?office=${role}`
    : '';

  const fetchNotifications = useCallback(async (startAfter: ArchiveCursor | null, append = false) => {
    if (fetchInFlight.current) return;
    fetchInFlight.current = true;
    setLoading(true);
    setErrorMessage(null);
    try {
      const { error: userError, data: { user } } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('Sign in before viewing archived notifications.');

      let query = supabase
        .from('workflow_notification_archives')
        .select('notification_id, archived_at, workflow_notifications(*, workflow_submissions(*, profiles:user_id(email)))')
        .eq('user_id', user.id)
        .order('archived_at', { ascending: false })
        .order('notification_id', { ascending: false })
        .limit(PAGE_SIZE + 1);
      if (startAfter) {
        query = query.or(
          `archived_at.lt.${startAfter.archivedAt},and(archived_at.eq.${startAfter.archivedAt},notification_id.lt.${startAfter.notificationId})`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      const rows = data || [];
      const pageRows = rows.slice(0, PAGE_SIZE);
      const pageNotifications: ArchivedNotification[] = pageRows.flatMap((row) => {
        const notification = Array.isArray(row.workflow_notifications)
          ? row.workflow_notifications[0]
          : row.workflow_notifications;
        if (!notification) return [];
        return [{
          id: notification.submission_id,
          notificationId: row.notification_id,
          title: notification.title,
          message: notification.message,
          eventType: notification.event_type,
          fileName: notification.workflow_submissions?.file_name,
          trackingNumber: notification.workflow_submissions?.tracking_number,
          status: getNotificationStatus(
            notification.event_type,
            notification.workflow_submissions?.status || ''
          ),
          requesterEmail: notification.workflow_submissions?.profiles?.email,
          archivedAt: row.archived_at,
          isUnread: !notification.read_at,
        }];
      });

      setNotifications((current) => {
        const merged = new Map<string, ArchivedNotification>(
          (append ? current : []).map((notification) => [notification.notificationId, notification])
        );
        pageNotifications.forEach((notification) => merged.set(notification.notificationId, notification));
        return Array.from(merged.values()).sort(
          (first, second) => Date.parse(second.archivedAt) - Date.parse(first.archivedAt)
        );
      });
      const lastRow = pageRows.at(-1);
      setCursor(lastRow
        ? { archivedAt: lastRow.archived_at, notificationId: lastRow.notification_id }
        : startAfter);
      setHasMore(rows.length > PAGE_SIZE);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Could not load archived notifications.'));
      if (!append) setNotifications([]);
      setHasMore(false);
    } finally {
      fetchInFlight.current = false;
      setLoading(false);
    }
  }, [supabase]);

  const deleteNotification = async (notificationId: string) => {
    if (busy) return;
    if (!window.confirm('Permanently delete this archived notification? This cannot be undone.')) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw userError || new Error('Sign in before deleting notifications.');
      const { error } = await supabase
        .from('workflow_notifications')
        .delete()
        .eq('id', notificationId)
        .eq('recipient_id', user.id);
      if (error) throw error;
      setNotifications((current) => current.filter((notification) => notification.notificationId !== notificationId));
      window.dispatchEvent(new Event('workflow-notifications-changed'));
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Could not permanently delete the notification.'));
    } finally {
      setBusy(false);
    }
  };

  const deleteAllNotifications = async () => {
    if (busy) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const { error } = await supabase.rpc('delete_archived_workflow_notifications');
      if (error) throw error;
      setNotifications([]);
      setCursor(null);
      setHasMore(false);
      window.dispatchEvent(new Event('workflow-notifications-changed'));
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Could not permanently delete archived notifications.'));
    } finally {
      setBusy(false);
    }
  };

  const openNotification = async (
    event: MouseEvent<HTMLAnchorElement>,
    notification: ArchivedNotification
  ) => {
    event.preventDefault();
    try {
      if (notification.isUnread) {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) throw userError || new Error('Sign in before opening notifications.');
        const { error } = await supabase
          .from('workflow_notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', notification.notificationId)
          .eq('recipient_id', user.id);
        if (error) throw error;
        setNotifications((current) => current.map((item) =>
          item.notificationId === notification.notificationId ? { ...item, isUnread: false } : item
        ));
        window.dispatchEvent(new Event('workflow-notifications-changed'));
      }
      router.push(`${detailPath}/${notification.id}${adminOfficeQuery}`);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Could not open this notification.'));
    }
  };

  useEffect(() => {
    void fetchNotifications(null);
  }, [fetchNotifications]);

  return (
    <div className="w-full">
      <header className="mb-8 max-md:mb-5">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-clay" /> {role === 'system_admin' ? 'Admin workspace' : role !== 'submitter' ? 'Office workspace' : 'Live updates'}
        </p>
        <h1 className="font-serif text-[32px] leading-tight text-warm-text max-md:text-[26px]">Notification archive</h1>
        <p className="mt-2 text-xs text-muted-text">
          Archived notifications remain here until you permanently delete them.
        </p>
      </header>

      <WorkflowNotificationFeed
        archiveHref={`${notificationPath}${adminOfficeQuery}`}
        archiveLabel="Back to notifications"
        busy={busy || loading}
        canClear={notifications.length > 0}
        hasMore={hasMore}
        loading={loading}
        actionLabel="Delete all archived"
        actionConfirmation="Permanently delete all archived notifications? This cannot be undone. Submissions and workflow history will remain."
        onClear={deleteAllNotifications}
        onLoadMore={() => fetchNotifications(cursor, true)}
      >
        {errorMessage && (
          <p role="alert" className="mb-4 rounded-xl border border-rejected-bg bg-rejected-bg/40 px-4 py-3 text-xs text-rejected-text">
            {errorMessage}
          </p>
        )}

        {loading && notifications.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
            <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Loading archived notifications...
          </div>
        ) : notifications.length === 0 ? (
          <div className="rounded-2xl border border-warm-border bg-card py-20 text-center">
            <p className="font-serif text-2xl text-warm-text">Archive is empty</p>
            <p className="mt-2 text-xs text-muted-text">Notifications you archive will appear here.</p>
          </div>
        ) : (
          <div role="list" className="space-y-3">
            {notifications.map((notification) => {
              const status = getStatusConfig(notification.status || '');
              const detailHref = `${detailPath}/${notification.id}${adminOfficeQuery}`;
              return (
                <SwipeDismissNotification
                  key={notification.notificationId}
                  onDismiss={() => void deleteNotification(notification.notificationId)}
                  label={`Permanently delete ${notification.fileName || 'notification'}`}
                  actionText="Delete"
                  busy={busy}
                >
                  <Link
                    href={detailHref}
                    onClick={(event) => void openNotification(event, notification)}
                    className="group flex flex-col gap-5 border border-warm-border bg-card px-5 py-5 pr-14 transition-colors hover:border-clay-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-clay sm:flex-row sm:items-center sm:justify-between max-md:gap-3 max-md:px-3.5 max-md:pr-14 max-md:py-3.5"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                      <div className="relative flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-sidebar text-muted-text">
                        <span className="text-lg leading-4" aria-hidden="true">▤</span>
                        <span className="mt-1 text-[8px] font-semibold uppercase">
                          {notification.fileName?.split('.').at(-1)?.slice(0, 3) || 'File'}
                        </span>
                        {notification.isUnread && (
                          <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-card bg-clay" aria-label="Unread" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          {notification.isUnread && (
                            <span className="rounded-md bg-clay-soft px-2 py-1 text-[10px] font-medium text-clay">Unread</span>
                          )}
                          <span className="text-[11px] font-medium text-warm-text">
                            {notification.title || notification.eventType?.replaceAll('_', ' ') || 'Update'}
                          </span>
                        </div>
                        <h2 className="truncate text-sm font-semibold text-warm-text group-hover:text-clay">
                          {notification.fileName || 'Untitled file'}
                        </h2>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-text">
                          {role !== 'submitter' && (
                            <>
                              <span className="truncate">From {notification.requesterEmail || 'unknown submitter'}</span>
                              <span aria-hidden="true">·</span>
                            </>
                          )}
                          <span>Archived {timeAgo(notification.archivedAt)}</span>
                          {notification.trackingNumber && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Tracking {notification.trackingNumber}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end max-md:w-full max-md:flex-col max-md:items-stretch">
                      <span className={`inline-flex items-center gap-2 self-start whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-medium ${status.styles}`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                        {status.label}
                      </span>
                      <span className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors group-hover:bg-warm-text max-md:h-11 max-md:w-full">
                        View details <span aria-hidden="true">→</span>
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
