'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { downloadWorkflowAttachment, saveDownload } from '@/lib/workflow/attachments';
import DocumentMessaging from '@/components/DocumentMessaging';

type Submission = {
  id: string;
  tracking_number: string;
  title: string;
  description: string | null;
  state: string;
  current_version_id: string;
  created_at: string;
  updated_at: string;
};
type Version = { id: string; version_number: number; description: string | null; created_at: string };
type Attachment = {
  id: string;
  submission_id: string;
  original_filename: string;
  content_type: string | null;
  byte_size: number | null;
  created_at: string;
};
type VersionAttachment = { submission_version_id: string; attachment_id: string };
type Decision = {
  id: string;
  submission_version_id: string;
  decision_kind: string;
  stage: string;
  reason: string | null;
  correction_instructions: string | null;
  created_at: string;
};
type StatusEvent = {
  id: string;
  previous_state: string | null;
  new_state: string;
  cause_code: string | null;
  reason: string | null;
  created_at: string;
};
type Notification = { id: string; title: string; message: string; created_at: string; read_at: string | null };

const STATE_LABELS: Record<string, string> = {
  initial_review: 'Tourism Officer review',
  office_review: 'Municipal office review',
  returned: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  draft: 'Draft',
};

export default function UserFileDetail() {
  const params = useParams<{ id: string }>();
  const submissionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const supabase = useMemo(() => createClient(), []);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [versionAttachments, setVersionAttachments] = useState<VersionAttachment[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [statusHistory, setStatusHistory] = useState<StatusEvent[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadSubmission = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data: current, error: submissionError } = await supabase
      .from('submissions')
      .select('id, tracking_number, title, description, state, current_version_id, created_at, updated_at')
      .eq('id', submissionId)
      .single();
    if (submissionError) {
      console.error('Submission details could not be loaded:', submissionError);
      setError('This submission could not be loaded or is not available to your account.');
      setLoading(false);
      return;
    }

    const [versionResult, attachmentResult, linkResult, decisionResult, historyResult, notificationResult] = await Promise.all([
      supabase.from('submission_versions')
        .select('id, version_number, description, created_at')
        .eq('submission_id', submissionId)
        .order('version_number', { ascending: false }),
      supabase.from('attachments')
        .select('id, submission_id, original_filename, content_type, byte_size, created_at')
        .eq('submission_id', submissionId)
        .order('created_at', { ascending: false }),
      supabase.from('submission_version_attachments')
        .select('submission_version_id, attachment_id')
        .eq('submission_id', submissionId),
      supabase.from('submission_decisions')
        .select('id, submission_version_id, decision_kind, stage, reason, correction_instructions, created_at')
        .eq('submission_id', submissionId)
        .order('created_at', { ascending: false }),
      supabase.from('submission_status_history')
        .select('id, previous_state, new_state, cause_code, reason, created_at')
        .eq('submission_id', submissionId)
        .order('created_at', { ascending: false }),
      supabase.from('notifications')
        .select('id, title, message, created_at, read_at')
        .eq('submission_id', submissionId)
        .order('created_at', { ascending: false }),
    ]);
    const queryErrors = [
      versionResult.error,
      attachmentResult.error,
      linkResult.error,
      decisionResult.error,
      historyResult.error,
      notificationResult.error,
    ].filter(Boolean);
    if (queryErrors.length) {
      console.error('Submission history could not be fully loaded:', queryErrors);
      setError('Some submission history could not be loaded. Refresh and try again.');
      setLoading(false);
      return;
    }

    setSubmission(current);
    setVersions(versionResult.data ?? []);
    setAttachments(attachmentResult.data ?? []);
    setVersionAttachments(linkResult.data ?? []);
    setDecisions(decisionResult.data ?? []);
    setStatusHistory(historyResult.data ?? []);
    setNotifications(notificationResult.data ?? []);
    setLoading(false);
  }, [submissionId, supabase]);

  useEffect(() => {
    void loadSubmission().catch((loadError: unknown) => {
      console.error('Submission history load failed:', loadError);
      setError('Submission history could not be loaded.');
      setLoading(false);
    });
  }, [loadSubmission]);

  const downloadAttachment = async (attachment: Attachment) => {
    try {
      const file = await downloadWorkflowAttachment(supabase, attachment.id);
      saveDownload(file, attachment.original_filename);
    } catch (downloadError) {
      console.error('Private attachment download failed:', downloadError);
      setError('The file could not be downloaded with your current access.');
    }
  };

  const markNotificationRead = async (notificationId: string) => {
    const readAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .eq('id', notificationId)
      .is('read_at', null);
    if (updateError) {
      console.error('Notification read state could not be updated:', updateError);
      setError('The notification could not be marked as read.');
      return;
    }
    setNotifications((current) => current.map((item) =>
      item.id === notificationId ? { ...item, read_at: readAt } : item
    ));
  };

  if (loading) return <p role="status" className="py-12 text-center text-sm text-muted-text">Loading submission history...</p>;
  if (error && !submission) return <p role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 p-4 text-sm text-rejected-text">{error}</p>;
  if (!submission) return <p role="alert">Submission unavailable.</p>;

  return (
    <section className="space-y-6">
      <Link href="/workflow/user" className="text-sm font-semibold text-clay">← My submissions</Link>
      {error && <p role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 p-4 text-sm text-rejected-text">{error}</p>}

      <header className="rounded-2xl border border-warm-border bg-card p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-clay">{submission.tracking_number}</p>
        <h1 className="mt-2 font-serif text-3xl text-warm-text">{submission.title}</h1>
        <p className="mt-2 text-sm text-muted-text">
          Status: {STATE_LABELS[submission.state] ?? submission.state.replaceAll('_', ' ')}
        </p>
        {submission.description && <p className="mt-4 whitespace-pre-wrap text-sm text-warm-text">{submission.description}</p>}
        {submission.state === 'returned' && (
          <div className="mt-5">
            <Link href={`/workflow/user/upload?resubmit=${submission.id}`} className="inline-flex rounded-full bg-clay px-5 py-3 text-sm font-semibold text-white">
              Submit corrected version
            </Link>
          </div>
        )}
      </header>

      <section className="rounded-2xl border border-warm-border bg-card p-6">
        <h2 className="font-serif text-xl text-warm-text">Document versions</h2>
        <ul className="mt-4 space-y-4">
          {versions.map((version) => {
            const versionFileIds = new Set(versionAttachments
              .filter((link) => link.submission_version_id === version.id)
              .map((link) => link.attachment_id));
            const versionFiles = attachments.filter((attachment) => versionFileIds.has(attachment.id));
            return (
              <li key={version.id} className="rounded-xl border border-warm-border p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-semibold text-warm-text">
                    Version {version.version_number}{version.id === submission.current_version_id ? ' · Current' : ''}
                  </p>
                  <time className="text-xs text-muted-text">{new Date(version.created_at).toLocaleString()}</time>
                </div>
                {version.description && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-text">{version.description}</p>}
                {versionFiles.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {versionFiles.map((attachment) => (
                      <li key={attachment.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                        <span className="text-warm-text">{attachment.original_filename}</span>
                        <button type="button" onClick={() => void downloadAttachment(attachment)} className="rounded-full border border-warm-border px-4 py-2 text-xs font-semibold text-warm-text">
                          Download private file
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-2xl border border-warm-border bg-card p-6">
        <h2 className="font-serif text-xl text-warm-text">Decision history</h2>
        {decisions.length === 0 ? <p className="mt-3 text-sm text-muted-text">No overall decisions have been recorded.</p> : (
          <ul className="mt-4 space-y-3">
            {decisions.map((decision) => (
              <li key={decision.id} className="rounded-xl bg-sidebar p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-semibold text-warm-text">{decision.decision_kind.replaceAll('_', ' ')} · {decision.stage.replaceAll('_', ' ')}</p>
                  <time className="text-xs text-muted-text">{new Date(decision.created_at).toLocaleString()}</time>
                </div>
                <p className="mt-1 text-xs text-muted-text">Applies to version {versions.find((version) => version.id === decision.submission_version_id)?.version_number ?? 'unknown'}</p>
                {decision.reason && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-text">{decision.reason}</p>}
                {decision.correction_instructions && <p className="mt-2 whitespace-pre-wrap text-sm text-warm-text">Correction instructions: {decision.correction_instructions}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-warm-border bg-card p-6">
        <h2 className="font-serif text-xl text-warm-text">Status history</h2>
        <ol className="mt-4 space-y-3">
          {statusHistory.map((event) => (
            <li key={event.id} className="border-l-2 border-clay pl-4">
              <p className="text-sm font-medium text-warm-text">
                {event.previous_state ? `${event.previous_state.replaceAll('_', ' ')} → ` : ''}
                {event.new_state.replaceAll('_', ' ')}
              </p>
              <p className="mt-1 text-xs text-muted-text">{event.reason ?? event.cause_code?.replaceAll('_', ' ') ?? 'Workflow status update'} · {new Date(event.created_at).toLocaleString()}</p>
            </li>
          ))}
          {statusHistory.length === 0 && <li className="text-sm text-muted-text">No status history is available.</li>}
        </ol>
      </section>

      <DocumentMessaging
        key={submission.id}
        submissionId={submission.id}
        fileName={submission.title}
        trackingNumber={submission.tracking_number}
        activity={null}
      />

      <section className="rounded-2xl border border-warm-border bg-card p-6">
        <h2 className="font-serif text-xl text-warm-text">Notifications</h2>
        {notifications.length === 0 ? <p className="mt-3 text-sm text-muted-text">No notifications have been recorded for this submission.</p> : (
          <ul className="mt-4 space-y-3">
            {notifications.map((notification) => (
              <li key={notification.id} className="rounded-xl bg-sidebar p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-warm-text">{notification.title}{notification.read_at ? '' : ' · New'}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-text">{notification.message}</p>
                    <time className="mt-2 block text-xs text-muted-text">{new Date(notification.created_at).toLocaleString()}</time>
                  </div>
                  {!notification.read_at && (
                    <button type="button" onClick={() => void markNotificationRead(notification.id)} className="rounded-full border border-warm-border px-3 py-2 text-xs font-semibold text-warm-text">
                      Mark read
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
