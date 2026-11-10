'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Notification = {
  id: string;
  submission_id: string;
  title: string;
  message: string;
  created_at: string;
  read_at: string | null;
};
type SubmissionLink = { id: string; tracking_number: string; title: string };

export default function NotificationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: notificationError } = await supabase
      .from('notifications')
      .select('id, submission_id, title, message, created_at, read_at')
      .order('created_at', { ascending: false });
    if (notificationError) {
      console.error('Notifications could not be loaded:', notificationError);
      setError('Notifications could not be loaded. Refresh and try again.');
      setLoading(false);
      return;
    }

    const submissionIds = [...new Set((data ?? []).map((notification) => notification.submission_id))];
    const submissionResult = submissionIds.length
      ? await supabase.from('submissions')
          .select('id, tracking_number, title')
          .in('id', submissionIds)
      : { data: [], error: null };
    if (submissionResult.error) {
      console.error('Notification submission references could not be loaded:', submissionResult.error);
      setError('Notification details could not be loaded.');
      setLoading(false);
      return;
    }
    setNotifications(data ?? []);
    setSubmissions(submissionResult.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadNotifications().catch((loadError: unknown) => {
      console.error('Notification load failed:', loadError);
      setError('Notifications could not be loaded.');
      setLoading(false);
    });
  }, [loadNotifications]);

  const markRead = async (id: string) => {
    const readAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .eq('id', id)
      .is('read_at', null);
    if (updateError) {
      console.error('Notification read state could not be updated:', updateError);
      setError('This notification could not be marked as read.');
      return;
    }
    setNotifications((current) => current.map((notification) =>
      notification.id === id ? { ...notification, read_at: readAt } : notification
    ));
  };

  return (
    <section>
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-clay">Submission updates</p>
        <h1 className="mt-2 font-serif text-3xl text-warm-text">Notifications</h1>
      </header>
      {error && <p role="alert" className="mb-4 rounded-xl border border-rejected-bg bg-rejected-bg/50 p-4 text-sm text-rejected-text">{error}</p>}
      {loading ? (
        <p role="status" className="py-10 text-center text-sm text-muted-text">Loading notifications...</p>
      ) : notifications.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-warm-border bg-card p-10 text-center text-sm text-muted-text">
          Decision updates for your submissions will appear here.
        </div>
      ) : (
        <ul className="grid gap-3">
          {notifications.map((notification) => {
            const submission = submissions.find((item) => item.id === notification.submission_id);
            return (
              <li key={notification.id} className="rounded-2xl border border-warm-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-warm-text">{notification.title}{notification.read_at ? '' : ' · New'}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-text">{notification.message}</p>
                    {submission && (
                      <Link href={`/workflow/user/file_registry/${submission.id}`} className="mt-3 inline-block text-xs font-semibold text-clay">
                        {submission.tracking_number} · {submission.title}
                      </Link>
                    )}
                    <time className="mt-2 block text-xs text-muted-text">{new Date(notification.created_at).toLocaleString()}</time>
                  </div>
                  {!notification.read_at && (
                    <button type="button" onClick={() => void markRead(notification.id)} className="rounded-full border border-warm-border px-3 py-2 text-xs font-semibold text-warm-text">
                      Mark read
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
