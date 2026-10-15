'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import FilePreview, { downloadFile, getFileUrl } from '@/components/FilePreview';

// ─── Styles & Fonts (synced with dashboard) ──────────────────────────────────
const fonts = {
  serif: "font-serif",
  mono: "font-sans text-xs",
};

interface PreviewSubmission {
  file_name: string;
  file_url: string;
  file_path?: string | null;
  file_type?: string | null;
}

export default function UserFileRegistry() {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewFile, setPreviewFile] = useState<PreviewSubmission | null>(null);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (!previewFile) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewFile(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [previewFile]);

  useEffect(() => {
    async function fetchUserFiles() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('workflow_submissions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (!error) setSubmissions(data || []);
      setLoading(false);
    }
    fetchUserFiles();
  }, [supabase]);

  const filteredSubmissions = submissions.filter(file => {
    const title = file.file_name || '';
    const matchesSearch = title.toLowerCase().includes(searchQuery.toLowerCase());

    let matchesFilter = true;
    if (activeFilter === 'PENDING') {
      matchesFilter = file.status.includes('pending');
    } else if (activeFilter === 'APPROVED') {
      matchesFilter = file.status === 'approved';
    } else if (activeFilter === 'REJECTED') {
      matchesFilter = file.status.includes('declined') || file.status.includes('rejected');
    }

    return matchesSearch && matchesFilter;
  });

  return (
    <div className="w-full">
      <div>

        {/* HEADER */}
        <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-center max-md:mb-5 max-md:gap-3">
          <div>
            <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
              <span className="h-1.5 w-1.5 rounded-full bg-clay" /> User Portal // My Submissions
            </p>
            <h1 className={`${fonts.serif} text-[32px] leading-tight text-warm-text max-md:text-[26px]`}>Files.</h1>
          </div>
          <Link
            href="/workflow/user/upload"
            className="inline-flex h-11 items-center justify-center gap-2 self-start rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text sm:self-auto max-md:w-full max-md:self-stretch"
          >
            <span className="text-lg font-normal leading-none" aria-hidden="true">+</span> Upload New File
          </Link>
        </div>

        {/* TOOLBAR */}
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xl lg:flex-1">
            <span className="pointer-events-none absolute left-5 top-1/2 z-10 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">SEARCH //</span>
            <input
              type="text"
              placeholder="Find a file by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-12 w-full rounded-full border border-warm-border bg-card pl-28 pr-5 text-sm text-warm-text outline-none transition-colors placeholder:text-muted-text/60 focus:border-clay max-md:h-11"
            />
          </div>

          {/* Filter pills (scroll inside their own row on mobile) */}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
            {['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map((f) => {
              const active = activeFilter === f;
              return (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  aria-pressed={active}
                  className={`inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-xs font-medium transition-colors max-md:h-11 ${
                    active
                      ? 'border-clay bg-clay text-white'
                      : 'border-warm-border bg-card text-warm-text hover:bg-sidebar'
                  }`}
                >
                  {f}
                </button>
              );
            })}
          </div>
        </div>

        {/* FILE LIST */}
        <div>
          {loading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
              <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Loading your files...
            </div>
          ) : filteredSubmissions.length === 0 ? (
            <div className="rounded-2xl border border-warm-border bg-card py-16 text-center">
              <p className={`${fonts.serif} text-2xl text-warm-text`}>Nothing here</p>
              <p className="mt-2 text-xs text-muted-text">
                No files found for "{searchQuery || activeFilter}"
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSubmissions.map((file) => (
                <article
                  key={file.id}
                  className="group flex flex-col gap-5 rounded-2xl border border-warm-border bg-card px-5 py-5 transition-colors hover:border-[#d9cabb] sm:flex-row sm:items-center sm:justify-between max-md:gap-3 max-md:px-3.5 max-md:py-3.5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-sidebar text-muted-text">
                      <span className="text-lg leading-4" aria-hidden="true">▤</span>
                      <span className="mt-1 text-[8px] font-semibold uppercase">{file.file_type?.split('/').at(-1)?.slice(0, 3) || 'File'}</span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-clay-soft px-2 py-1 text-[10px] font-medium text-clay">
                          {file.category || "General"}
                        </span>
                        <span className="text-[11px] text-muted-text">
                          ID: {file.id.slice(0, 8)}
                        </span>
                      </div>

                      <h3 className="truncate text-sm font-semibold text-warm-text group-hover:text-clay">
                        {file.file_name}
                      </h3>

                      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-medium text-muted-text">Date Uploaded</span>
                          <span className="text-[11px] text-warm-text">{new Date(file.created_at).toLocaleDateString()}</span>
                        </div>
                        <div className="flex flex-col border-l border-warm-border pl-5">
                          <span className="text-[10px] font-medium text-muted-text">Size</span>
                          <span className="text-[11px] text-warm-text">{(file.file_size / 1024).toFixed(1)} KB</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 sm:justify-end max-md:w-full max-md:flex-col max-md:items-stretch">
                    <div className="flex flex-col items-start gap-1.5 sm:items-end max-md:self-start">
                      <span className="text-[10px] font-medium text-muted-text">Current Status</span>
                      <StatusBadge status={file.status} />
                    </div>

                    <div className="flex items-center gap-2 max-md:w-full max-md:flex-col max-md:items-stretch">
                      <button
                        onClick={() => setPreviewFile(file)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-warm-border text-warm-text transition-colors hover:bg-sidebar max-md:h-11 max-md:w-full"
                        title="Quick Preview"
                        aria-label="Quick Preview"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>

                      <Link
                        href={`/workflow/user/file_registry/${file.id}`}
                        className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text max-md:h-11 max-md:w-full"
                      >
                        View Details <span aria-hidden="true">→</span>
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      {previewFile && (
        <div className="fixed inset-0 z-100 flex flex-col bg-warm-text/75 backdrop-blur-sm animate-in fade-in duration-300 max-md:bg-card max-md:backdrop-blur-none">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`Preview ${previewFile.file_name}`}
            className="flex h-full flex-col"
          >
            <header className="flex min-h-16 items-center justify-between gap-4 border-b border-warm-border bg-card px-4 py-3 sm:px-8">
              <div className="flex min-w-0 flex-col">
                <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">Document preview</span>
                <h2 className="max-w-[55vw] truncate text-sm font-semibold text-warm-text">{previewFile.file_name}</h2>
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    const url = await getFileUrl(supabase, previewFile);
                    await downloadFile(url, previewFile.file_name);
                  }}
                  className="inline-flex h-10 items-center rounded-full border border-warm-border px-4 text-[11px] font-medium text-warm-text transition-colors hover:bg-sidebar max-md:h-11"
                >
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewFile(null)}
                  className="inline-flex h-10 items-center rounded-full bg-clay px-4 text-[11px] font-semibold text-white transition-colors hover:bg-warm-text max-md:h-11"
                >
                  Close
                </button>
              </div>
            </header>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-cream p-3 sm:p-8 max-md:bg-card max-md:p-0">
              <div className="relative flex h-full w-full max-w-6xl items-center justify-center overflow-hidden rounded-xl border border-warm-border bg-card shadow-xl max-md:max-w-none max-md:rounded-none max-md:border-0 max-md:shadow-none">
                <FilePreview file={previewFile} />
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const getStatusDisplay = (s: string) => {
    switch (s) {
      case 'pending':
      case 'pending_approver':
        return { label: 'PENDING', styles: "bg-pending-bg text-pending-text" };
      case 'pending_admin':
        return { label: 'UNDER REVIEW', styles: "bg-review-bg text-review-text" };
      case 'approved':
        return { label: 'APPROVED', styles: "bg-approved-bg text-approved-text" };
      case 'declined_by_approver':
      case 'declined_by_admin':
        return { label: 'REJECTED', styles: "bg-rejected-bg text-rejected-text" };
      default:
        return { label: s.toUpperCase().replace('_', ' '), styles: "bg-sidebar text-muted-text" };
    }
  };

  const { label, styles } = getStatusDisplay(status);

  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-medium ${styles}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}