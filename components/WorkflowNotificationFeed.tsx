'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';

export default function WorkflowNotificationFeed({
  children,
  archiveHref,
  archiveLabel = 'View archive',
  archiveIconOnly = false,
  busy,
  canClear,
  hasMore,
  loading,
  actionLabel = 'Clear all',
  actionConfirmation = 'Clear all notifications from this feed? They will be moved to your archive, where you can permanently delete them.',
  onClear,
  onLoadMore,
}: {
  children: ReactNode;
  archiveHref: string;
  archiveLabel?: string;
  archiveIconOnly?: boolean;
  busy: boolean;
  canClear: boolean;
  hasMore: boolean;
  loading: boolean;
  actionLabel?: string;
  actionConfirmation?: string;
  onClear: () => void;
  onLoadMore: () => void | Promise<void>;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadRequested = useRef(false);

  useEffect(() => {
    if (!loading) loadRequested.current = false;
  }, [loading]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loading || busy) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loadRequested.current) {
          loadRequested.current = true;
          void Promise.resolve(onLoadMore()).finally(() => {
            loadRequested.current = false;
          });
        }
      },
      { rootMargin: '240px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [busy, hasMore, loading, onLoadMore]);

  const clearNotifications = () => {
    if (window.confirm(actionConfirmation)) {
      onClear();
    }
  };

  return (
    <>
      <div className="mb-4 flex justify-end gap-2">
        <Link
          href={archiveHref}
          aria-label={archiveIconOnly ? archiveLabel : undefined}
          title={archiveIconOnly ? archiveLabel : undefined}
          className={`inline-flex items-center justify-center rounded-full border border-warm-border bg-card text-[11px] font-semibold text-warm-text transition-colors hover:bg-sidebar ${
            archiveIconOnly ? 'h-9 w-9' : 'gap-2 px-4 py-2'
          }`}
        >
          {archiveIconOnly ? (
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8h18v11H3zM3 8l2-4h14l2 4M9 12h6" />
            </svg>
          ) : archiveLabel}
        </Link>
        <button
          type="button"
          onClick={clearNotifications}
          disabled={busy || !canClear}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-warm-border bg-card px-4 py-2 text-[11px] font-semibold text-warm-text transition-colors hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Updating…' : actionLabel}
        </button>
      </div>
      {children}
      <div
        ref={sentinelRef}
        className="flex min-h-12 items-center justify-center py-3 text-[11px] text-muted-text"
        aria-live="polite"
      >
        {loading ? 'Loading more notifications…' : hasMore ? 'Scroll for more' : ''}
      </div>
    </>
  );
}
