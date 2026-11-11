'use client';

import { useRef, useState, type MouseEvent, type TouchEvent, type ReactNode } from 'react';

export default function SwipeDismissNotification({
  children,
  onDismiss,
  label = 'Archive notification',
  actionText = 'Archive',
  busy = false,
}: {
  children: ReactNode;
  onDismiss: () => void;
  label?: string;
  actionText?: string;
  busy?: boolean;
}) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const offsetRef = useRef(0);
  const didSwipe = useRef(false);
  const [offset, setOffset] = useState(0);

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (busy) return;
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (!touchStart.current) return;
    const touch = event.touches[0];
    const horizontal = touch.clientX - touchStart.current.x;
    const vertical = touch.clientY - touchStart.current.y;
    if (Math.abs(horizontal) > Math.abs(vertical)) {
      const nextOffset = Math.max(-120, Math.min(120, horizontal));
      offsetRef.current = nextOffset;
      setOffset(nextOffset);
    }
  };

  const handleTouchEnd = () => {
    if (!busy && Math.abs(offsetRef.current) >= 72) {
      didSwipe.current = true;
      onDismiss();
    }
    touchStart.current = null;
    offsetRef.current = 0;
    setOffset(0);
  };

  const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (didSwipe.current) {
      event.preventDefault();
      event.stopPropagation();
      didSwipe.current = false;
    }
  };

  const handleTouchCancel = () => {
    touchStart.current = null;
    offsetRef.current = 0;
    didSwipe.current = false;
    setOffset(0);
  };

  return (
    <div
      role="listitem"
      className="relative overflow-hidden rounded-2xl bg-rejected-bg"
      onClickCapture={handleClickCapture}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      <div
        className="relative z-10 transition-transform duration-150 ease-out"
        style={{ transform: `translateX(${offset}px)`, touchAction: 'pan-y' }}
      >
        {children}
      </div>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-5 text-rejected-text" aria-hidden="true">
        <span>{actionText}</span>
        <span>{actionText}</span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        disabled={busy}
        aria-label={label}
        title={label}
        className="absolute right-2 top-2 z-20 grid h-9 w-9 place-items-center rounded-full border border-warm-border bg-card text-muted-text transition-colors hover:bg-rejected-bg hover:text-rejected-text disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span aria-hidden="true" className="text-xl leading-none">−</span>
      </button>
    </div>
  );
}
