'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import FilePreview from '@/components/FilePreview';
import {
  ACCEPT_ATTR,
  SUPPORTED_TEXT,
  MAX_FILE_BYTES,
  formatSize,
  getExtension,
  isWebImage,
  typeLabel,
  validateUploadFile,
  type FileCheck,
} from '@/lib/uploadRules';

// ─── Styles & Fonts (synced with dashboard) ──────────────────────────────────
const fonts = {
  serif: "font-serif",
  mono: "font-sans text-xs",
};

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const category = 'General'; // document type picker comes later; the destination is now chosen below
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [loadingDepartments, setLoadingDepartments] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [showPreview, setShowPreview] = useState(false);
  const [fileCheck, setFileCheck] = useState<FileCheck | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);

  // Load active departments for the destination dropdown
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('departments')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setMessage({ text: `Could not load departments: ${error.message}`, type: 'error' });
        } else {
          setDepartments(data ?? []);
        }
        setLoadingDepartments(false);
      });
    return () => { cancelled = true; };
  }, [supabase]);

  // Local object URL so the selected file can be previewed before uploading
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const ext = file ? getExtension(file.name) : '';

  // Close preview with Escape
  useEffect(() => {
    if (!showPreview) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowPreview(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPreview]);

  // Close preview if the file is removed
  useEffect(() => { if (!file) setShowPreview(false); }, [file]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const selectedFile = input.files?.[0];
    if (!selectedFile) return;

    const check = await validateUploadFile(selectedFile);
    input.value = ''; // lets the same file be picked again after a rejection

    if (!check.ok) {
      setFile(null);
      setFileCheck(null);
      setMessage({ text: check.error, type: 'error' });
      return;
    }

    setFile(selectedFile);
    setFileCheck(check);
    if (!title) setTitle(selectedFile.name.split('.')[0]);
    setMessage(null);
  };

  const handleUpload = async () => {
    if (!file || !title || !departmentId) {
      setMessage({ text: 'Incomplete Manifest: Title, Department and File required.', type: 'error' });
      return;
    }

    // Check the file again right before uploading
    const check = await validateUploadFile(file);
    if (!check.ok) {
      setFile(null);
      setFileCheck(null);
      setMessage({ text: check.error, type: 'error' });
      return;
    }

    setUploading(true);
    setMessage(null);

    let uploadedFilePath: string | null = null;
    try {
      // 1. Identify User
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Auth Session Expired");

      // 2. Verify Profile exists (Prevents Foreign Key Constraint Error)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .single();

      if (profileError || !profile) {
        throw new Error("User profile registry not found. Please contact an admin or re-login.");
      }

      // 3. Upload to Storage (content type comes from the verified extension, not the browser)
      const fileExt = check.ext;
      const filePath = `${user.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('workflow_uploads')
        .upload(filePath, file, {
          contentType: check.mime,
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;
      uploadedFilePath = filePath;

      const { data: { publicUrl } } = supabase.storage
        .from('workflow_uploads')
        .getPublicUrl(filePath);

      const fileNameWithExt = title.toLowerCase().endsWith(`.${fileExt}`)
        ? title
        : `${title}.${fileExt}`;

      // 4. Create the submission through the workflow function
      const { data: submission, error: dbError } = await supabase.rpc('submit_document', {
        p_file_url: publicUrl,
        p_file_path: filePath,
        p_file_name: fileNameWithExt,
        p_file_size: file.size,
        p_file_type: check.mime,
        p_category: category,
        p_description: description,
        p_destination_department_id: departmentId,
      });

      if (dbError) throw dbError;
      uploadedFilePath = null;

      setMessage({
        text: `Data Logged Successfully. Tracking Number: ${submission.tracking_number}. Redirecting...`,
        type: 'success'
      });
      setTimeout(() => router.push('/workflow/user'), 1500);

    } catch (error: unknown) {
      console.error("Upload Error:", error);
      if (uploadedFilePath) {
        try {
          const { error: cleanupError } = await supabase.storage
            .from('workflow_uploads')
            .remove([uploadedFilePath]);
          if (cleanupError) console.error('Uploaded file cleanup error:', cleanupError);
        } catch (cleanupError) {
          console.error('Uploaded file cleanup error:', cleanupError);
        }
      }
      const text =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message: unknown }).message)
            : 'An unexpected upload error occurred.';
      setMessage({ text, type: 'error' });
      setUploading(false);
    }
  };

  const labelClass = "mb-2 block text-xs font-medium text-muted-text";
  const fieldClass = "w-full rounded-xl border border-warm-border bg-card px-4 text-sm text-warm-text outline-none transition-colors placeholder:text-muted-text/60 focus:border-clay";
  const canSubmit = !!file && !!fileCheck && fileCheck.ok && !uploading;

  return (
    <div className="w-full">
      <div>
        {/* Header */}
        <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-center max-md:mb-5 max-md:gap-3">
          <div>
            <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
              <span className="h-1.5 w-1.5 rounded-full bg-clay" /> System_Entry // Inbound_File
            </p>
            <h1 className={`${fonts.serif} text-[32px] leading-tight text-warm-text max-md:text-[26px]`}>New Log</h1>
          </div>
          <button
            onClick={() => router.push('/workflow/user')}
            className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-full border border-warm-border px-5 text-xs font-medium text-warm-text transition-colors hover:bg-sidebar sm:self-auto max-md:h-11 max-md:w-full max-md:self-stretch"
          >
            [ Cancel_Exit ]
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 max-md:gap-3">
          {/* Form column */}
          <div className="space-y-4 lg:col-span-7 max-md:space-y-3">
            <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
              <label className={labelClass}>01. Document_Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Name your submission..."
                className={`${fieldClass} h-12 ${fonts.serif} text-lg`}
              />
            </section>

            <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
              <label className={labelClass}>02. Destination_Department</label>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                disabled={loadingDepartments}
                className={`${fieldClass} h-12 cursor-pointer max-md:h-11`}
              >
                <option value="">
                  {loadingDepartments ? 'Loading departments...' : 'Select a department...'}
                </option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-text">
                *This department will review your document first.
              </p>
            </section>

            <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
              <label className={labelClass}>03. Context_Brief</label>
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Provide a brief context for the approver..."
                className={`${fieldClass} resize-none py-3 leading-relaxed`}
              />
            </section>
          </div>

          {/* File + submit column */}
          <div className="lg:col-span-5">
            <div className="space-y-4 lg:sticky lg:top-10 max-md:space-y-3">
              <div className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
                <label className={labelClass}>04. Source_File</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`group relative flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed p-8 transition-colors max-md:aspect-auto max-md:py-10
                    ${file ? 'border-clay bg-clay-soft' : 'border-warm-border bg-sidebar hover:border-clay'}`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept={ACCEPT_ATTR}
                    className="hidden"
                  />
                  {!file ? (
                    <>
                      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-card text-muted-text transition-colors group-hover:text-clay">
                        <span className="text-2xl font-medium" aria-hidden="true">↑</span>
                      </div>
                      <span className="text-center text-xs font-medium text-warm-text">Initialize<br />Upload</span>
                    </>
                  ) : (
                    <div className="animate-in zoom-in-95 flex w-full flex-col items-center text-center duration-300">
                      {isWebImage(ext) && previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={previewUrl}
                          alt={file.name}
                          className="mb-4 max-h-40 w-auto max-w-full rounded-lg border border-warm-border bg-card object-contain"
                        />
                      ) : (
                        <div className="mx-auto mb-4 flex h-14 w-14 flex-col items-center justify-center rounded-xl bg-card text-muted-text">
                          <span className="text-lg leading-4" aria-hidden="true">▤</span>
                          <span className="mt-1 text-[8px] font-semibold uppercase">{ext.slice(0, 4) || 'File'}</span>
                        </div>
                      )}
                      <p className="break-all text-xs font-semibold text-warm-text">{file.name}</p>
                      <p className="mt-1 text-[11px] text-muted-text">{typeLabel(ext)} · {formatSize(file.size)}</p>
                      <div className="mt-5 flex flex-wrap items-center justify-center gap-2 max-md:w-full max-md:flex-col max-md:items-stretch">
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowPreview(true); }}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-warm-border bg-card px-4 text-[11px] font-medium text-warm-text transition-colors hover:bg-sidebar max-md:h-11"
                        >
                          <span aria-hidden="true">⌕</span> Preview
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setFile(null); setFileCheck(null); }}
                          className="inline-flex h-9 items-center justify-center rounded-full bg-rejected-bg px-4 text-[11px] font-medium text-rejected-text transition-opacity hover:opacity-80 max-md:h-11"
                        >
                          [ Remove ]
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-text">
                  {SUPPORTED_TEXT}. Up to {formatSize(MAX_FILE_BYTES)}.
                </p>
              </div>

              <button
                onClick={handleUpload}
                disabled={!canSubmit}
                className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-6 text-xs font-semibold transition-colors
                  ${!canSubmit ? 'cursor-not-allowed bg-sidebar text-muted-text' : 'bg-clay text-white hover:bg-warm-text'}`}
              >
                {uploading ? (
                  <>
                    <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> SYNCING...
                  </>
                ) : (
                  'EXECUTE_SUBMISSION →'
                )}
              </button>

              {message && (
                <div
                  className={`rounded-2xl border p-5 max-md:p-3.5 ${
                    message.type === 'success'
                      ? 'border-approved-bg bg-approved-bg/50 text-approved-text'
                      : 'border-rejected-bg bg-rejected-bg/50 text-rejected-text'
                  }`}
                >
                  <p className="mb-1.5 text-xs font-semibold">STATUS: {message.type.toUpperCase()}</p>
                  <p className="text-sm leading-relaxed text-warm-text">{message.text}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showPreview && file && previewUrl && (
        <div className="fixed inset-0 z-100 flex flex-col bg-warm-text/75 backdrop-blur-sm animate-in fade-in duration-300 max-md:bg-card max-md:backdrop-blur-none">
          <div className="flex min-h-16 items-center justify-between border-b border-warm-border bg-card px-4 py-3 sm:px-8">
            <div className="flex min-w-0 flex-col">
              <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">Document preview</span>
              <h2 className="max-w-[55vw] truncate text-sm font-semibold text-warm-text">{file.name}</h2>
              <span className="text-[11px] text-muted-text">{typeLabel(ext)} · {formatSize(file.size)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-4">
              {(ext === 'pdf' || isWebImage(ext)) && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-warm-border px-4 py-2 text-[11px] font-medium text-warm-text transition-colors hover:bg-sidebar max-md:h-11 max-md:content-center"
                >
                  Open
                </a>
              )}
              <a
                href={previewUrl}
                download={file.name}
                aria-label="Download preview file"
                className="rounded-full border border-warm-border px-4 py-2 text-[11px] font-medium text-warm-text transition-colors hover:bg-sidebar max-md:flex max-md:h-11 max-md:w-11 max-md:items-center max-md:justify-center max-md:border-0 max-md:p-0"
              >
                <svg className="hidden max-md:block" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3" />
                </svg>
                <span className="max-md:sr-only">Download</span>
              </a>
              <button
                onClick={() => setShowPreview(false)}
                aria-label="Close preview"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-text transition-colors hover:bg-sidebar hover:text-warm-text max-md:h-11 max-md:w-11"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center overflow-hidden bg-cream p-3 sm:p-8 max-md:bg-card max-md:p-0">
            <div className="relative flex h-full w-full max-w-6xl items-center justify-center overflow-hidden rounded-xl border border-warm-border bg-card shadow-xl max-md:max-w-none max-md:rounded-none max-md:border-0 max-md:shadow-none">
              <FilePreview
                file={{
                  file_name: file.name,
                  file_url: previewUrl,
                  file_type: fileCheck && fileCheck.ok ? fileCheck.mime : file.type,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}