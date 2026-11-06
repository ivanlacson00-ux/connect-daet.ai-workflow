'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
<<<<<<< Updated upstream
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
=======
import { OFFICE_CONFIG } from '@/lib/workflow/offices';
import {
  getWorkflowFileMimeType,
  getWorkflowFilesTypeError,
  WORKFLOW_ATTACHMENT_ACCEPT,
  WORKFLOW_DOCUMENT_ACCEPT,
} from '@/lib/workflow/file-types';
>>>>>>> Stashed changes

// ─── Styles & Fonts (synced with dashboard) ──────────────────────────────────
const fonts = {
  serif: "font-serif",
};

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
<<<<<<< Updated upstream
  const category = 'General'; // document type picker comes later; the destination is now chosen below
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [loadingDepartments, setLoadingDepartments] = useState(true);
=======
  const [intendedRecipient, setIntendedRecipient] = useState('');
  const [category, setCategory] = useState<string>(
    OFFICE_CONFIG.municipal_treasurer.categories[0]
  );
>>>>>>> Stashed changes
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [showPreview, setShowPreview] = useState(false);
  const [fileCheck, setFileCheck] = useState<FileCheck | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
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

<<<<<<< Updated upstream
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
=======
  const selectMainFile = (selectedFile: File) => {
    const fileError = getWorkflowFilesTypeError([selectedFile], false);
    if (fileError) {
      setFile(null);
      setMessage({ text: fileError, type: 'error' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setFile(selectedFile);
    setTitle((currentTitle) => currentTitle || selectedFile.name.split('.')[0]);
    setMessage(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      selectMainFile(e.target.files[0]);
>>>>>>> Stashed changes
    }

    setFile(selectedFile);
    setFileCheck(check);
    if (!title) setTitle(selectedFile.name.split('.')[0]);
    setMessage(null);
  };

  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files ?? []);
    const fileError = getWorkflowFilesTypeError(selectedFiles);
    if (fileError) {
      setAttachments([]);
      setMessage({ text: fileError, type: 'error' });
      e.target.value = '';
      return;
    }
    setAttachments(selectedFiles);
    setMessage(null);
  };

  const handleUpload = async () => {
<<<<<<< Updated upstream
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
=======
    if (!file || !title.trim() || !description.trim()) {
      setMessage({ text: 'Complete the document title, request summary, and main document before submitting.', type: 'error' });
      return;
    }
    const fileError = getWorkflowFilesTypeError([file], false)
      || getWorkflowFilesTypeError(attachments);
    if (fileError) {
      setMessage({ text: fileError, type: 'error' });
>>>>>>> Stashed changes
      return;
    }

    setUploading(true);
    setMessage(null);

    const uploadedFilePaths: string[] = [];
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

<<<<<<< Updated upstream
      // 3. Upload to Storage (content type comes from the verified extension, not the browser)
      const fileExt = check.ext;
      const filePath = `${user.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('workflow_uploads')
        .upload(filePath, file, {
          contentType: check.mime,
          cacheControl: '3600',
          upsert: false
=======
      // 3. Upload to Storage
      const uploadToStorage = async (uploadFile: File, index: number) => {
        const safeName = uploadFile.name.replace(/[^\w.-]/g, '_');
        const filePath = `${user.id}/${crypto.randomUUID()}-${index}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from('workflow_uploads')
          .upload(filePath, uploadFile, {
            contentType: getWorkflowFileMimeType(uploadFile.name) || undefined,
            cacheControl: '3600',
            upsert: false,
          });
        if (uploadError) throw uploadError;
        uploadedFilePaths.push(filePath);
        return filePath;
      };

      const filePath = await uploadToStorage(file, 0);
      const attachmentRecords = [];
      for (const [index, attachment] of attachments.entries()) {
        attachmentRecords.push({
          file_name: attachment.name,
          file_path: await uploadToStorage(attachment, index + 1),
          file_type: getWorkflowFileMimeType(attachment.name),
          file_size: attachment.size,
>>>>>>> Stashed changes
        });
      }

      const { data: { publicUrl } } = supabase.storage
        .from('workflow_uploads')
        .getPublicUrl(filePath);

<<<<<<< Updated upstream
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
=======
      const fileExt = file.name.split('.').pop();
      const fileNameWithExt = title.toLowerCase().endsWith(`.${fileExt?.toLowerCase()}`)
        ? title
        : `${title}.${fileExt}`;

      const { data, error: dbError } = await supabase.rpc('create_workflow_submission', {
        submission_title: fileNameWithExt,
        submission_file_path: filePath,
        submission_file_url: publicUrl,
        submission_file_type: getWorkflowFileMimeType(file.name) || 'application/octet-stream',
        submission_file_size: file.size,
        submission_document_type: category,
        submission_description: description.trim(),
        submission_purpose: null,
        submission_requested_action: null,
        submission_intended_recipient: intendedRecipient.trim() || null,
        attachment_records: attachmentRecords,
>>>>>>> Stashed changes
      });

      if (dbError) throw dbError;
      const submission = Array.isArray(data) ? data[0] : data;
      if (!submission?.tracking_number) throw new Error('Submission was saved without a tracking number.');
      uploadedFilePaths.length = 0;

      setMessage({
        text: `Document submitted. Tracking Number: ${submission.tracking_number}. Redirecting...`,
        type: 'success'
      });
      setTimeout(() => router.push('/workflow/user'), 1500);

    } catch (error: unknown) {
      console.error("Upload Error:", error);
      if (uploadedFilePaths.length > 0) {
        try {
          const { error: cleanupError } = await supabase.storage
            .from('workflow_uploads')
            .remove(uploadedFilePaths);
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

<<<<<<< Updated upstream
  const labelClass = "mb-2 block text-xs font-medium text-muted-text";
  const fieldClass = "w-full rounded-xl border border-warm-border bg-card px-4 text-sm text-warm-text outline-none transition-colors placeholder:text-muted-text/60 focus:border-clay";
  const canSubmit = !!file && !!fileCheck && fileCheck.ok && !uploading;
=======
  const labelClass = 'mb-2 block text-[11px] font-semibold uppercase tracking-wide text-warm-text';
  const fieldClass = 'h-11 w-full rounded-xl border border-warm-border bg-card px-4 text-sm text-warm-text outline-none transition-colors placeholder:text-muted-text/70 focus:border-clay focus:ring-2 focus:ring-clay/10';
>>>>>>> Stashed changes

  return (
    <div className="mx-auto w-full max-w-5xl rounded-2xl border border-warm-border bg-card p-5 shadow-sm sm:p-8">
      <header className="mb-6 flex flex-col gap-4 border-b border-warm-border pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-clay">
            Document intake
          </p>
          <h1 className="text-2xl font-bold leading-tight text-warm-text sm:text-[28px]">
            Submit a New Document
          </h1>
          <p className="mt-2 text-xs text-muted-text">
            Provide the request details and upload the document for review.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/workflow/user')}
          className="inline-flex h-10 items-center justify-center rounded-full border border-warm-border px-5 text-xs font-medium text-warm-text transition-colors hover:bg-sidebar"
        >
          Cancel
        </button>
      </header>

      <div className="grid grid-cols-1 gap-x-4 gap-y-5 md:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="submission-title">Document title / subject</label>
          <input
            id="submission-title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Request for municipal assistance"
            className={fieldClass}
            required
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="submission-category">Classification / document type</label>
          <select
            id="submission-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className={`${fieldClass} cursor-pointer`}
          >
            {Object.values(OFFICE_CONFIG).map((office) => (
              <optgroup key={office.label} label={office.label}>
                {office.categories.map((officeCategory) => (
                  <option key={officeCategory} value={officeCategory}>
                    {officeCategory}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

<<<<<<< Updated upstream
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
=======
        <div>
          <label className={labelClass} htmlFor="submission-context">Request summary / context</label>
          <textarea
            id="submission-context"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Briefly explain what this submission is about."
            className={`${fieldClass} h-auto resize-y py-3 leading-relaxed`}
            required
          />
>>>>>>> Stashed changes
        </div>

        <div>
          <label className={labelClass} htmlFor="intended-recipient">Intended recipient (optional)</label>
          <input
            id="intended-recipient"
            type="text"
            value={intendedRecipient}
            onChange={(event) => setIntendedRecipient(event.target.value)}
            placeholder="Office or recipient, if known"
            className={fieldClass}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-muted-text">
            The approver will confirm the appropriate municipal office during review.
          </p>
        </div>

      </div>

      <section className="mt-6">
        <label className={`${labelClass} mb-1`} htmlFor="main-document">Main document</label>
        <p className="mb-3 text-[11px] text-muted-text">
          PDF, DOC/DOCX, XLS/XLSX, CSV, PPT/PPTX, JPG/JPEG, or PNG.
        </p>
        <input
          id="main-document"
          type="file"
          accept={WORKFLOW_DOCUMENT_ACCEPT}
          ref={fileInputRef}
          onChange={handleFileChange}
          className="sr-only"
        />
        <div
          onDragEnter={(event) => {
            event.preventDefault();
            if (!uploading) setIsDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!uploading) setIsDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIsDragging(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            if (!uploading && event.dataTransfer.files[0]) {
              selectMainFile(event.dataTransfer.files[0]);
            }
          }}
          className={`flex min-h-44 flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-7 text-center transition-colors sm:min-h-48 ${
            isDragging
              ? 'border-clay bg-clay-soft'
              : file
                ? 'border-approved-bg bg-approved-bg/20'
                : 'border-warm-border bg-sidebar/60'
          }`}
        >
          {file ? (
            <div className="flex w-full flex-col items-center">
              {fileKind === 'image' && previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt={file.name}
                  className="mb-3 max-h-24 max-w-full rounded-lg border border-warm-border bg-card object-contain"
                />
              ) : (
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-card text-lg text-clay" aria-hidden="true">
                  ▤
                </span>
              )}
              <p className="max-w-full break-all text-sm font-semibold text-warm-text">{file.name}</p>
              <p className="mt-1 text-[11px] text-muted-text">{(file.size / 1024).toFixed(1)} KB</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPreview(true)}
                  className="inline-flex h-9 items-center rounded-full border border-warm-border bg-card px-4 text-[11px] font-medium text-warm-text hover:bg-sidebar"
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="inline-flex h-9 items-center rounded-full border border-warm-border bg-card px-4 text-[11px] font-medium text-warm-text hover:bg-sidebar"
                >
                  Remove file
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex h-9 items-center rounded-full border border-warm-border bg-card px-4 text-[11px] font-medium text-warm-text hover:bg-sidebar"
                >
                  Replace file
                </button>
              </div>
            </div>
          ) : (
            <>
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-clay-soft text-xl text-clay" aria-hidden="true">
                ↑
              </span>
              <p className="text-sm font-semibold text-warm-text">
                Drag and drop your document here
              </p>
              <p className="mt-1 text-xs text-muted-text">or choose a file from your device</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 inline-flex h-9 items-center rounded-full border border-warm-border bg-card px-5 text-xs font-semibold text-warm-text transition-colors hover:border-clay hover:text-clay"
              >
                Choose document
              </button>
            </>
          )}
        </div>
      </section>

      <section className="mt-5 rounded-xl border border-warm-border bg-card p-4">
        <label className={`${labelClass} mb-1`} htmlFor="supporting-attachments">
          Supporting attachments (optional)
        </label>
        <p className="mb-3 text-[11px] text-muted-text">
          PDF, DOC/DOCX, XLS/XLSX, CSV, PPT/PPTX, JPG/JPEG, PNG, or ZIP.
        </p>
        <input
          id="supporting-attachments"
          ref={attachmentInputRef}
          type="file"
          accept={WORKFLOW_ATTACHMENT_ACCEPT}
          multiple
          onChange={handleAttachmentChange}
          className="block w-full text-xs text-muted-text file:mr-3 file:rounded-full file:border-0 file:bg-clay-soft file:px-4 file:py-2 file:text-xs file:font-semibold file:text-clay"
        />
        {attachments.length > 0 && (
          <ul className="mt-3 space-y-2 text-[11px] text-warm-text">
            {attachments.map((attachment, attachmentIndex) => (
              <li
                key={`${attachment.name}-${attachment.size}`}
                className="flex items-center justify-between gap-3 rounded-lg bg-sidebar px-3 py-2"
              >
                <span className="min-w-0 break-all">
                  {attachment.name} ({(attachment.size / 1024).toFixed(1)} KB)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAttachments((currentAttachments) =>
                      currentAttachments.filter((_, index) => index !== attachmentIndex)
                    );
                    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
                  }}
                  aria-label={`Remove ${attachment.name}`}
                  className="shrink-0 rounded-full px-3 py-1.5 font-medium text-rejected-text transition-colors hover:bg-rejected-bg"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-6 flex flex-col gap-4 border-t border-warm-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-lg text-xs leading-relaxed text-muted-text">
          After submission, you’ll receive a tracking number and can follow the review progress from your dashboard.
        </p>
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading || !file}
          className={`inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-full px-7 text-xs font-semibold transition-colors sm:w-auto ${
            uploading || !file
              ? 'cursor-not-allowed bg-sidebar text-muted-text'
              : 'bg-clay text-white hover:bg-warm-text'
          }`}
        >
          {uploading ? (
            <>
              <span className="h-2 w-2 animate-pulse rounded-full bg-current" /> Submitting...
            </>
          ) : (
            'Submit document →'
          )}
        </button>
      </footer>

      {message && (
        <div
          role="status"
          className={`mt-4 rounded-xl border p-4 ${
            message.type === 'success'
              ? 'border-approved-bg bg-approved-bg/50 text-approved-text'
              : 'border-rejected-bg bg-rejected-bg/50 text-rejected-text'
          }`}
        >
          <p className="text-sm leading-relaxed">{message.text}</p>
        </div>
      )}

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