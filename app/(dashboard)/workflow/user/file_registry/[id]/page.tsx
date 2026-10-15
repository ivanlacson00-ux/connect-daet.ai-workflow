'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import FilePreview, { downloadFile, getFileUrl } from '@/components/FilePreview';

// ─── Styles & Fonts (synced with dashboard) ──────────────────────────────────
const fonts = {
  serif: "font-serif",
  mono: "font-sans text-xs",
};

interface Submission {
  id: string;
  file_name: string;
  file_url: string;
  file_path?: string | null;
  file_type: string;
  file_size: number;
  status: string;
  category: string;
  description: string;
  approver_comments: string;
  admin_comments: string;
  rejection_comment: string;
  created_at: string;
}

export default function UserFileDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [sub, setSub] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const fetchSubmission = async () => {
      const { data } = await supabase
        .from('workflow_submissions')
        .select('*')
        .eq('id', id)
        .single();

      if (data) setSub(data);
      setLoading(false);
    };
    fetchSubmission();
  }, [id, supabase]);

  const getStatusStyles = (status: string) => {
    switch (status) {
      case 'pending':
      case 'pending_approver':
        return { label: 'Pending', classes: 'bg-pending-bg text-pending-text' };
      case 'pending_admin':
        return { label: 'Under review', classes: 'bg-review-bg text-review-text' };
      case 'approved':
        return { label: 'Approved', classes: 'bg-approved-bg text-approved-text' };
      case 'declined_by_approver':
      case 'declined_by_admin':
        return { label: 'Rejected', classes: 'bg-rejected-bg text-rejected-text' };
      default:
        return { label: status?.replaceAll('_', ' ') || 'Unknown', classes: 'bg-sidebar text-muted-text' };
    }
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

  // Logic: Only show feedback if it's REJECTED or FINAL APPROVED
  const showFeedback = sub.status === 'approved' || sub.status.includes('declined');
  const officialNote = sub.admin_comments || sub.rejection_comment || sub.approver_comments;
  const isApproved = sub.status === 'approved';

  return (
    <div className="w-full">
      {/* Back */}
      <div className="mb-5 max-md:mb-4">
        <button
          onClick={() => router.back()}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-warm-border px-4 text-xs font-medium text-warm-text transition-colors hover:bg-sidebar max-md:h-11"
        >
          <span aria-hidden="true">←</span> Back to files
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 max-md:gap-3">

        {/* DETAILS COLUMN */}
        <aside className="space-y-4 lg:col-span-5 max-md:space-y-3">

          {/* Header */}
          <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
              <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Submission ID: {sub.id.split('-')[0]}
            </p>
            <h1 className={`${fonts.serif} mb-4 break-words text-[28px] leading-tight text-warm-text max-md:text-[24px]`}>{sub.file_name}</h1>
            <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium ${statusConfig.classes}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              {statusConfig.label}
            </div>
          </section>

          {/* Context Card */}
          <section className="space-y-5 rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <div>
              <p className="mb-1 text-[11px] font-medium text-muted-text">Category</p>
              <p className="inline-flex rounded-md bg-clay-soft px-2.5 py-1 text-xs font-semibold text-clay">{sub.category || 'Unassigned'}</p>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-medium text-muted-text">Description</p>
              <p className="whitespace-pre-wrap break-words border-l-2 border-warm-border pl-4 font-serif text-base leading-relaxed text-warm-text">
                "{sub.description || 'No description provided.'}"
              </p>
            </div>
            <div className="flex items-end justify-between gap-4 border-t border-warm-border pt-4">
              <div>
                <p className="text-[10px] font-medium text-muted-text">Submitted on</p>
                <p className="mt-0.5 text-[11px] font-semibold text-warm-text">{new Date(sub.created_at).toLocaleDateString()} at {new Date(sub.created_at).toLocaleTimeString()}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium text-muted-text">File size</p>
                <p className="mt-0.5 text-[11px] font-semibold text-warm-text">{(sub.file_size / 1024).toFixed(2)} KB</p>
              </div>
            </div>
          </section>

          {/* Official Feedback Section */}
          {showFeedback && officialNote && (
            <section
              className={`animate-in fade-in slide-in-from-bottom-4 rounded-2xl border p-5 duration-700 max-md:p-3.5 ${
                isApproved
                  ? 'border-approved-bg bg-approved-bg/50'
                  : 'border-rejected-bg bg-rejected-bg/50'
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <p className={`text-xs font-semibold ${isApproved ? 'text-approved-text' : 'text-rejected-text'}`}>Official feedback</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isApproved ? 'bg-approved-bg text-approved-text' : 'bg-rejected-bg text-rejected-text'}`}>Official</span>
              </div>
              <p className="break-words font-serif text-base leading-relaxed text-warm-text">
                "{officialNote}"
              </p>
            </section>
          )}

          {/* Locked Status for Active Review */}
          {!showFeedback && (
            <section className="rounded-2xl border border-dashed border-warm-border bg-sidebar p-5 max-md:p-3.5">
              <p className="text-center text-xs leading-relaxed text-muted-text">
                Official feedback will appear here once the review is complete.
              </p>
            </section>
          )}

          {/* Footer Actions */}
          <button
            onClick={async () => {
              const url = await getFileUrl(supabase, sub);
              await downloadFile(url, sub.file_name);
            }}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text"
          >
            Download original file
          </button>
        </aside>

        {/* PREVIEW PANEL */}
        <main className="lg:col-span-7">
          <div className="flex flex-col overflow-hidden rounded-2xl border border-warm-border bg-card lg:sticky lg:top-10">
            <div className="flex min-h-12 items-center border-b border-warm-border px-5 py-3 max-md:px-3.5">
              <div className="flex min-w-0 flex-col">
                <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">Document preview</span>
                <span className="truncate text-[11px] font-medium text-warm-text">
                  {sub.file_name}
                </span>
              </div>
            </div>

            <div className="relative flex h-[60vh] min-h-[380px] items-center justify-center overflow-hidden bg-cream lg:h-[75vh]">
              <FilePreview file={sub} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}