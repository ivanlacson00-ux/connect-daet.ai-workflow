'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import FilePreview, { downloadFile, getFileUrl } from '@/components/FilePreview';

// ─── Styles & Fonts (synced with the approver and user file pages) ───────────
const fonts = {
  serif: 'font-serif',
  mono: 'font-sans text-xs',
};

const fieldClasses =
  'h-11 w-full rounded-full border border-warm-border bg-card px-4 text-xs text-warm-text outline-none transition-colors focus:border-clay';

interface Submission {
  id: string;
  user_id: string;
  tracking_number?: string | null;
  file_name: string;
  file_url: string;
  file_path?: string | null;
  file_type: string;
  file_size: number;
  status: string;
  category?: string | null;
  description?: string | null;
  approver_comments?: string | null;
  admin_comments?: string | null;
  archived_at?: string | null;
  retention_until?: string | null;
  created_at: string;
  updated_at: string;
}

type AdminDecision = 'approved' | 'declined' | 'completed';

// ─── Status helpers ──────────────────────────────────────────────────────────
const getStatusStyles = (status: string) => {
  const s = (status || '').toLowerCase();
  if (s === 'pending' || s === 'pending_approver') return { label: 'Under verification', classes: 'bg-pending-bg text-pending-text' };
  if (s === 'pending_admin') return { label: 'Pending approval', classes: 'bg-review-bg text-review-text' };
  if (s === 'approved') return { label: 'Approved', classes: 'bg-approved-bg text-approved-text' };
  if (s === 'completed') return { label: 'Completed', classes: 'bg-approved-bg text-approved-text' };
  if (s.includes('declined') || s === 'rejected') return { label: 'Declined', classes: 'bg-rejected-bg text-rejected-text' };
  return { label: s.replaceAll('_', ' ') || 'Unknown', classes: 'bg-sidebar text-muted-text' };
};

const getActionLabel = (type: string) => {
  switch (type) {
    case 'STAGE_1_AUTHORIZED': return 'Approved by';
    case 'STAGE_1_REJECTED': return 'Stage 1 rejected';
    case 'FINAL_AUTHORIZATION': return 'Final approval';
    case 'FINAL_REJECTION': return 'Rejected by';
    case 'VERIFICATION_PASSED': return 'Verification passed';
    case 'RETURNED_FOR_CORRECTION': return 'Returned for correction';
    case 'WORKFLOW_COMPLETED': return 'Workflow completed';
    case 'SUBMITTED': return 'Submitted by';
    default: return 'Action by';
  }
};

export default function AdminManagePage() {
  const { id } = useParams();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [sub, setSub] = useState<Submission | null>(null);
  const [sender, setSender] = useState<any>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [actionError, setActionError] = useState('');
  const [adminComment, setAdminComment] = useState('');
  const [archiveUpdating, setArchiveUpdating] = useState(false);
  const [retentionDate, setRetentionDate] = useState('');

  const fetchDetails = useCallback(async () => {
    try {
      const { data: submission } = await supabase
        .from('workflow_submissions')
        .select('*')
        .eq('id', id)
        .single();

      if (submission) {
        setSub(submission);
        setAdminComment(submission.admin_comments || '');
        setRetentionDate(submission.retention_until?.slice(0, 10) || '');

        const { data: profile } = await supabase
          .from('profiles')
          .select('email, full_name, role')
          .eq('id', submission.user_id)
          .single();
        if (profile) setSender(profile);

        const { data: logs } = await supabase
          .from('workflow_audit_logs')
          .select('*, profiles:action_by (full_name, email, role)')
          .eq('submission_id', id)
          .order('created_at', { ascending: false });
        if (logs) setAuditLogs(logs);
      }
    } catch (err) {
      console.error('Failed to load submission:', err);
    } finally {
      setLoading(false);
    }
  }, [id, supabase]);

  useEffect(() => { fetchDetails(); }, [fetchDetails]);

  const handleAdminAction = async (decision: AdminDecision) => {
    if (!sub) return;
    if (decision === 'completed' && sub.status !== 'approved') return;
    if (decision !== 'completed' && sub.status !== 'pending_admin') return;

    setUpdating(true);
    setActionError('');
    const nextStatus =
      decision === 'approved' ? 'approved' : decision === 'declined' ? 'declined_by_admin' : 'completed';

    const { error: updateError } = await supabase
      .from('workflow_submissions')
      .update({
        status: nextStatus,
        admin_comments: adminComment,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      console.error('Update failed:', updateError);
      setActionError('Could not save your decision. Please try again.');
    } else {
      await fetchDetails();
    }
    setUpdating(false);
  };

  const handleArchive = async () => {
    if (!sub) return;
    setArchiveUpdating(true);
    const shouldArchive = !sub.archived_at;
    const { error } = await supabase.rpc('set_workflow_submission_archive', {
      target_submission_id: id,
      should_archive: shouldArchive,
      retention_date: shouldArchive && retentionDate ? new Date(`${retentionDate}T23:59:59.999Z`).toISOString() : null,
    });

    if (error) {
      console.error('Archive update failed:', error.message);
    } else {
      await fetchDetails();
    }
    setArchiveUpdating(false);
  };

  if (loading) {
    return (
      <div className="w-full">
        <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
          <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Loading submission...
        </div>
      </div>
    );
  }

  if (!sub) {
    return (
      <div className="w-full">
        <div className="rounded-2xl border border-rejected-bg bg-rejected-bg/50 px-5 py-8 text-xs font-semibold text-rejected-text">
          Submission not found.
        </div>
      </div>
    );
  }

  const statusConfig = getStatusStyles(sub.status);
  const isFinalized = sub.status === 'completed' || sub.status.includes('declined');
  const isApproved = sub.status === 'approved';
  const isPendingAdmin = !isFinalized && !isApproved;

  return (
    <div className="w-full">
      {/* Back */}
      <div className="no-print mb-5 max-md:mb-4">
        <button
          onClick={() => router.back()}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-warm-border px-4 text-xs font-medium text-warm-text transition-colors hover:bg-sidebar max-md:h-11"
        >
          <span aria-hidden="true">←</span> Back to master logs
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 max-md:gap-3">

        {/* DETAILS COLUMN */}
        <aside className="space-y-4 lg:col-span-5 max-md:space-y-3">

          {/* Header */}
          <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
              <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Submission ID: {String(sub.id).split('-')[0]}
            </p>
            <h1 className={`${fonts.serif} mb-4 break-words text-[28px] leading-tight text-warm-text max-md:text-[24px]`}>{sub.file_name}</h1>
            <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium ${statusConfig.classes}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              {statusConfig.label}
            </div>
            <div className="mt-4 border-t border-warm-border pt-4">
              <p className="text-[10px] font-medium text-muted-text">Tracking number</p>
              <p className="mt-0.5 text-[11px] font-semibold text-warm-text">{sub.tracking_number || 'Pending assignment'}</p>
            </div>
          </section>

          {/* Printable receipt */}
          <section className="receipt-print border-2 border-black bg-white p-6">
            <p className={`${fonts.mono} mb-3 text-blue-600`}>Submission_Receipt</p>
            <div className="space-y-2 font-mono text-[11px]">
              <p><span className="text-gray-400">Tracking_Number:</span> {sub.tracking_number || 'Pending assignment'}</p>
              <p><span className="text-gray-400">Document:</span> {sub.file_name}</p>
              <p><span className="text-gray-400">Status:</span> {statusConfig.label}</p>
              <p><span className="text-gray-400">Submitted:</span> {new Date(sub.created_at).toLocaleString()}</p>
            </div>
          </section>

          {/* Context Card */}
          <section className="space-y-5 rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <div>
              <p className="mb-1 text-[11px] font-medium text-muted-text">Category</p>
              <p className="inline-flex rounded-md bg-clay-soft px-2.5 py-1 text-xs font-semibold text-clay">{sub.category || 'General'}</p>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-medium text-muted-text">Sender notes</p>
              <p className="whitespace-pre-wrap break-words border-l-2 border-warm-border pl-4 font-serif text-base leading-relaxed text-warm-text">
                "{sub.description || 'No description provided.'}"
              </p>
            </div>
            <div className="border-t border-warm-border pt-4">
              <p className="text-[10px] font-medium text-muted-text">Submitted by</p>
              <p className="mt-0.5 text-[11px] font-semibold text-warm-text">{sender?.full_name || 'Unknown'}</p>
              <p className="text-[11px] text-muted-text">{sender?.email}</p>
            </div>
            <div className="flex items-end justify-between gap-4 border-t border-warm-border pt-4">
              <div>
                <p className="text-[10px] font-medium text-muted-text">Submitted on</p>
                <p className="mt-0.5 text-[11px] font-semibold text-warm-text">{new Date(sub.created_at).toLocaleDateString()} at {new Date(sub.created_at).toLocaleTimeString()}</p>
              </div>
              {sub.file_size ? (
                <div className="text-right">
                  <p className="text-[10px] font-medium text-muted-text">File size</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-warm-text">{(sub.file_size / 1024).toFixed(2)} KB</p>
                </div>
              ) : null}
            </div>
          </section>

          {/* Approver notes (read-only context) */}
          {sub.approver_comments && (
            <section className="no-print rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
              <p className="mb-2 text-xs font-semibold text-warm-text">Approver notes</p>
              <p className="whitespace-pre-wrap break-words border-l-2 border-warm-border pl-4 font-serif text-base leading-relaxed text-warm-text">
                "{sub.approver_comments}"
              </p>
            </section>
          )}

          {/* Final Review Actions */}
          {isPendingAdmin && (
            <section className="no-print rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
              <label htmlFor="admin-notes" className="mb-2 block text-xs font-semibold text-warm-text">
                Final validation notes
              </label>
              <textarea
                id="admin-notes"
                value={adminComment}
                onChange={(e) => setAdminComment(e.target.value)}
                style={{ caretColor: 'currentColor' }}
                className="mb-4 h-32 w-full resize-none rounded-xl border border-warm-border bg-card p-4 text-sm text-warm-text outline-none transition-colors placeholder:text-muted-text/60 focus:border-clay"
                placeholder="Closing remarks for the user/system (optional)..."
              />
              {actionError && (
                <p className="mb-3 rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text">
                  {actionError}
                </p>
              )}
              <div className="flex gap-3 max-md:flex-col">
                <button
                  onClick={() => handleAdminAction('approved')}
                  disabled={updating}
                  className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:opacity-50"
                >
                  {updating ? 'Saving...' : 'Final approve'}
                </button>
                <button
                  onClick={() => handleAdminAction('declined')}
                  disabled={updating}
                  className="inline-flex h-11 flex-1 items-center justify-center rounded-full border border-warm-border px-6 text-xs font-semibold text-rejected-text transition-colors hover:bg-rejected-bg/50 disabled:opacity-50"
                >
                  Final decline
                </button>
              </div>
            </section>
          )}

          {isApproved && (
            <section className="no-print rounded-2xl border border-approved-bg bg-approved-bg/50 p-5 max-md:p-3.5">
              <p className="mb-1 text-xs font-semibold text-approved-text">Ready to close</p>
              <p className="mb-4 text-xs leading-relaxed text-muted-text">
                This file is approved. Mark it as completed to finish the workflow.
              </p>
              {actionError && (
                <p className="mb-3 rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text">
                  {actionError}
                </p>
              )}
              <button
                onClick={() => handleAdminAction('completed')}
                disabled={updating}
                className="inline-flex h-11 w-full items-center justify-center rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:opacity-50"
              >
                {updating ? 'Saving...' : 'Mark as completed'}
              </button>
            </section>
          )}

          {isFinalized && (
            <section className="no-print space-y-3 rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
              <p className="text-xs font-semibold text-warm-text">Final review</p>
              {sub.admin_comments ? (
                <div className={`rounded-xl border p-4 ${sub.status.includes('declined') ? 'border-rejected-bg bg-rejected-bg/50' : 'border-approved-bg bg-approved-bg/50'}`}>
                  <p className={`mb-2 text-xs font-semibold ${sub.status.includes('declined') ? 'text-rejected-text' : 'text-approved-text'}`}>Admin notes</p>
                  <p className="whitespace-pre-wrap break-words font-serif text-base leading-relaxed text-warm-text">
                    "{sub.admin_comments}"
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-text">No admin notes were left on this review.</p>
              )}
              <button
                onClick={() => window.print()}
                className="inline-flex h-11 w-full items-center justify-center rounded-full border border-warm-border px-6 text-xs font-semibold text-warm-text transition-colors hover:bg-sidebar"
              >
                Print submission receipt
              </button>
            </section>
          )}

          {/* Secure Archive */}
          <section className="no-print rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <p className="mb-1 text-xs font-semibold text-warm-text">Secure archive</p>
            <p className="mb-4 text-xs leading-relaxed text-muted-text">
              {sub.archived_at
                ? `Archived ${new Date(sub.archived_at).toLocaleString()}`
                : 'This record is active and visible to authorized workflow users.'}
            </p>
            {!sub.archived_at && (
              <div className="mb-4">
                <label htmlFor="retention-date" className="mb-1.5 block text-[11px] font-medium text-muted-text">
                  Retention until
                </label>
                <input
                  id="retention-date"
                  type="date"
                  value={retentionDate}
                  onChange={(event) => setRetentionDate(event.target.value)}
                  className={fieldClasses}
                />
              </div>
            )}
            <button
              onClick={handleArchive}
              disabled={archiveUpdating}
              className="inline-flex h-11 w-full items-center justify-center rounded-full border border-warm-border px-6 text-xs font-semibold text-warm-text transition-colors hover:bg-sidebar disabled:opacity-50"
            >
              {archiveUpdating ? 'Updating archive...' : sub.archived_at ? 'Restore from archive' : 'Archive record'}
            </button>
          </section>

          {/* Timeline */}
          <section className="no-print rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <p className="mb-4 text-xs font-semibold text-warm-text">Activity</p>
            {auditLogs.length === 0 ? (
              <p className="text-xs text-muted-text">No activity recorded yet.</p>
            ) : (
              <div className="relative ml-1 space-y-6 border-l border-warm-border">
                {auditLogs.map((log) => (
                  <div key={log.id} className="relative pl-5">
                    <span className="absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full bg-clay ring-4 ring-card" />
                    <p className="text-[11px] font-semibold text-clay">{getActionLabel(log.action_type)}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <p className="text-[11px] font-medium text-warm-text">{log.profiles?.full_name || 'System'}</p>
                      {log.profiles?.role && (
                        <span className="rounded-md bg-sidebar px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-text">
                          {log.profiles.role}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-text">
                      {new Date(log.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                    {log.comments && (
                      <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-sidebar p-3 font-serif text-sm leading-relaxed text-warm-text">
                        "{log.comments}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Footer Actions */}
          <button
            onClick={async () => {
              const url = await getFileUrl(supabase, sub);
              await downloadFile(url, sub.file_name);
            }}
            className="no-print inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-warm-border px-6 text-xs font-semibold text-warm-text transition-colors hover:bg-sidebar"
          >
            Download original file
          </button>
        </aside>

        {/* PREVIEW PANEL */}
        <main className="no-print lg:col-span-7">
          <div className="flex flex-col overflow-hidden rounded-2xl border border-warm-border bg-card lg:sticky lg:top-10">
            <div className="flex min-h-12 items-center border-b border-warm-border px-5 py-3 max-md:px-3.5">
              <div className="flex min-w-0 flex-col">
                <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">Document preview</span>
                <span className="truncate text-[11px] font-medium text-warm-text">{sub.file_name}</span>
              </div>
            </div>

            <div className="relative flex h-[60vh] min-h-[380px] items-center justify-center overflow-hidden bg-cream lg:h-[75vh]">
              <FilePreview file={sub} />
            </div>
          </div>
        </main>
      </div>

      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          .receipt-print, .receipt-print * { visibility: visible; }
          .receipt-print { position: absolute; inset: 0; margin: 0; box-shadow: none; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}