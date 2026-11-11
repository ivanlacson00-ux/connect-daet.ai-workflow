'use client';

export type NotificationFilter = 'all' | 'unread';

export default function WorkflowNotificationControls({
  filter,
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
    if (window.confirm('Clear all notifications from your list? This only hides them for your account and does not delete submissions or history.')) {
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
          {busy ? 'Updating…' : 'Clear notifications'}
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
