'use client';

import Link from 'next/link';

export type NotificationFilter = 'all' | 'unread';

export default function WorkflowNotificationControls({
  filter,
  archiveHref,
  onFilterChange,
  notificationCount,
  unreadCount,
  page,
  hasNextPage,
  busy,
  onPreviousPage,
  onNextPage,
  onMarkAllRead,
  onClearNotifications,
}: {
  filter: NotificationFilter;
  archiveHref: string;
  onFilterChange: (filter: NotificationFilter) => void;
  notificationCount: number;
  unreadCount: number;
  page: number;
  hasNextPage: boolean;
  busy: boolean;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onMarkAllRead: () => void;
  onClearNotifications: () => void;
}) {
  const clearNotifications = () => {
    if (window.confirm('Clear notifications addressed to your account? They will move to your personal notification archive. This does not delete submissions or workflow history.')) {
      onClearNotifications();
    }
  };

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-warm-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border border-warm-border bg-sidebar p-1" aria-label="Filter notifications">
          {(['all', 'unread'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onFilterChange(value)}
              aria-pressed={filter === value}
              className={`rounded-full px-3 py-1.5 text-[10px] font-semibold capitalize transition-colors ${
                filter === value ? 'bg-card text-warm-text shadow-sm' : 'text-muted-text hover:text-warm-text'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-muted-text">
          {notificationCount} shown · {unreadCount} unread
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={archiveHref}
          aria-label="View notification archive"
          title="View notification archive"
          className="grid h-9 w-9 place-items-center rounded-full border border-warm-border text-warm-text transition-colors hover:bg-sidebar"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8h18v11H3zM3 8l2-4h14l2 4M9 12h6" />
          </svg>
        </Link>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={busy}
          className="rounded-full border border-warm-border px-3 py-2 text-[10px] font-semibold text-warm-text transition-colors hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-50"
        >
          Mark all as read
        </button>
        <button
          type="button"
          onClick={clearNotifications}
          disabled={busy}
          className="rounded-full border border-warm-border px-3 py-2 text-[10px] font-semibold text-rejected-text transition-colors hover:bg-rejected-bg/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Updating…' : 'Clear'}
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPreviousPage}
            disabled={busy || page === 0}
            aria-label="Previous notifications page"
            className="grid h-8 w-8 place-items-center rounded-full border border-warm-border text-sm text-warm-text hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-40"
          >
            ‹
          </button>
          <span className="min-w-14 text-center text-[10px] text-muted-text">Page {page + 1}</span>
          <button
            type="button"
            onClick={onNextPage}
            disabled={busy || !hasNextPage}
            aria-label="Next notifications page"
            className="grid h-8 w-8 place-items-center rounded-full border border-warm-border text-sm text-warm-text hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-40"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
