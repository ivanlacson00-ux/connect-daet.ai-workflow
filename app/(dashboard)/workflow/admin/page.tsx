'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAdminStats } from '@/hooks/useAdminStats';
import Link from 'next/link';

// ─── Styles ──────────────────────────────────────────────────────────────────
const fonts = {
  serif: "font-serif",
  mono: "font-sans text-xs",
};

interface Submission {
  id: string | number;
  tracking_number: string;
  file_name: string;
  file_url: string;
  file_type: string;
  status: string;
  user_id: string;
  submitter_email?: string;
  created_at: string;
}

// ─── Status Stamp ────────────────────────────────────────────────────────────
function StatusStamp({ status }: { status: string }) {
  const getDisplayConfig = () => {
    const s = status?.toLowerCase();

    if (s === 'pending_admin') {
      return { label: 'Pending approval', styles: 'bg-review-bg text-review-text' };
    }
    if (s.includes('approved')) {
      return { label: 'Approved', styles: 'bg-approved-bg text-approved-text' };
    }
    if (s === 'completed') {
      return { label: 'Completed', styles: 'bg-approved-bg text-approved-text' };
    }
    if (s.includes('declined')) {
      return { label: 'Declined', styles: 'bg-rejected-bg text-rejected-text' };
    }

    return { label: 'Under verification', styles: 'bg-pending-bg text-pending-text' };
  };

  const config = getDisplayConfig();

  return (
    <div className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-medium ${config.styles}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {config.label}
    </div>
  );
}

export default function AdminDashboard() {
  const supabase = useMemo(() => createClient(), []);
  const { stats: adminStats } = useAdminStats();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);

  // ─── Stat Cards Data ───────────────────────────────────────────────────────
  const pendingCount = (adminStats.pendingApprover || 0) + (adminStats.pendingAdmin || 0);
  const declinedCount = (adminStats.declinedByApprover || 0) + (adminStats.declinedByAdmin || 0);

  const statCards = [
    { label: 'Total users', value: adminStats.totalUsers, hint: 'Registered accounts', icon: '♧', iconStyles: 'bg-clay-soft text-clay' },
    { label: 'Pending', value: pendingCount, hint: 'Waiting on a review', icon: '▤', iconStyles: 'bg-pending-bg text-pending-text' },
    { label: 'Approved', value: adminStats.approved, hint: 'Reviewed and approved', icon: '✓', iconStyles: 'bg-approved-bg text-approved-text' },
    { label: 'Declined', value: declinedCount, hint: 'Returned to submitters', icon: '✕', iconStyles: 'bg-rejected-bg text-rejected-text' },
  ];

  // ─── Data Fetching ──────────────────────────────────────────────────────────
  const fetchRecentSubmissions = useCallback(async () => {
    setLoading(true);
    const { data: subs, error: subError } = await supabase
      .from("workflow_submissions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    if (subError) {
      setLoading(false);
      return;
    }

    const { data: profs } = await supabase.from("profiles").select("id, email");

    const mergedData = subs.map((sub: any) => {
      const userProfile = profs?.find(p => p.id === sub.user_id);
      return {
        ...sub,
        submitter_email: userProfile ? userProfile.email : "Unknown Sender"
      };
    });

    setSubmissions(mergedData);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchRecentSubmissions(); }, [fetchRecentSubmissions]);

  const handleDownload = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const link = document.body.appendChild(document.createElement('a'));
      link.href = window.URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      link.remove();
    } catch (e) { console.error("Download error", e); }
  };

  const isImage = (fileName: string) => /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(fileName);

  return (
    <div className="w-full">
      {/* Header Section */}
      <div className="mb-8 max-md:mb-5">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Admin workspace
        </p>
        <h1 className={`${fonts.serif} text-[32px] leading-tight text-warm-text max-md:text-[26px]`}>Admin hub</h1>
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-text max-md:mt-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-approved-text" /> System status: online
        </p>
      </div>

      {/* Stat Cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 max-md:mb-6 max-md:gap-3">
        {statCards.map((card) => (
          <div key={card.label} className="min-h-39.5 rounded-2xl border border-warm-border bg-card p-5 max-md:min-h-0 max-md:p-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-muted-text">{card.label}</h2>
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-base ${card.iconStyles}`} aria-hidden="true">
                {card.icon}
              </span>
            </div>
            <p className={`${fonts.serif} mt-3 text-[34px] leading-none text-warm-text max-md:mt-2 max-md:text-[27px]`}>{card.value}</p>
            <p className="mt-3 text-[11px] text-muted-text max-md:mt-1.5">{card.hint}</p>
          </div>
        ))}
      </div>

      {/* Recent Submissions */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-warm-text">Recent submissions</h2>
          <span className="rounded-md bg-sidebar px-2 py-1 text-[10px] font-medium text-muted-text">{submissions.length}</span>
        </div>
        <span className="text-[11px] text-muted-text max-md:hidden">Latest 10 entries</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
          <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Syncing records...
        </div>
      ) : submissions.length === 0 ? (
        <div className="rounded-2xl border border-warm-border bg-card py-20 text-center">
          <p className={`${fonts.serif} text-2xl text-warm-text`}>No submissions yet</p>
          <p className="mt-2 text-xs text-muted-text">New submissions will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {submissions.map((sub) => (
            <article
              key={sub.id}
              className="group flex flex-col gap-5 rounded-2xl border border-warm-border bg-card px-5 py-5 transition-colors hover:border-[#d9cabb] sm:flex-row sm:items-center sm:justify-between max-md:gap-3 max-md:px-3.5 max-md:py-3.5"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-sidebar text-muted-text">
                  <span className="text-lg leading-4" aria-hidden="true">▤</span>
                  <span className="mt-1 text-[8px] font-semibold uppercase">
                    {sub.file_type?.split('/').at(-1)?.slice(0, 3) || 'Doc'}
                  </span>
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-warm-text group-hover:text-clay">{sub.file_name}</h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-text">
                    <span>{sub.tracking_number || 'Tracking pending'}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">From {sub.submitter_email}</span>
                    <span aria-hidden="true">·</span>
                    <span>{new Date(sub.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:justify-end max-md:w-full max-md:flex-col max-md:items-stretch">
                <div className="max-md:self-start">
                  <StatusStamp status={sub.status} />
                </div>
                <button
                  onClick={() => setPreviewFile({ url: `/api/workflow/files/${sub.id}?redirect=1`, name: sub.file_name })}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-warm-border px-4 text-xs font-medium text-warm-text transition-colors hover:bg-sidebar max-md:h-11 max-md:w-full max-md:justify-center"
                  aria-label={`Preview ${sub.file_name}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                  </svg>
                  Preview
                </button>
                <Link
                  href={`/workflow/admin/submissions/${sub.id}`}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text max-md:h-11 max-md:w-full max-md:justify-center"
                >
                  Manage <span aria-hidden="true">→</span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-100 flex flex-col bg-warm-text/75 backdrop-blur-sm animate-in fade-in duration-300 max-md:bg-card max-md:backdrop-blur-none">
          <div className="flex min-h-16 items-center justify-between border-b border-warm-border bg-card px-4 py-3 sm:px-8">
            <div className="flex min-w-0 flex-col">
              <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">Document preview</span>
              <h2 className="max-w-[55vw] truncate text-sm font-semibold text-warm-text">{previewFile.name}</h2>
            </div>
            <button
              onClick={() => setPreviewFile(null)}
              aria-label="Close preview"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-text transition-colors hover:bg-sidebar hover:text-warm-text max-md:h-11 max-md:w-11"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center overflow-hidden bg-cream p-3 sm:p-8 max-md:bg-card max-md:p-0">
            <div className="relative flex h-full w-full max-w-6xl items-center justify-center overflow-hidden rounded-xl border border-warm-border bg-card shadow-xl max-md:max-w-none max-md:rounded-none max-md:border-0 max-md:shadow-none">
              {isImage(previewFile.name) ? (
                <img src={previewFile.url} alt="Preview" className="max-h-full max-w-full object-contain p-4 animate-in zoom-in-95" />
              ) : (
                <iframe className="h-full w-full border-none bg-white" src={previewFile.url} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}