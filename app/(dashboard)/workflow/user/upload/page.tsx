'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import FilePreview from '@/components/FilePreview';
import { createClient } from '@/lib/supabase/client';
import {
  getWorkflowFileMimeType,
  getWorkflowFilesTypeError,
} from '@/lib/workflow/file-types';
import {
  SUBMISSION_DESTINATION_CONFIG,
  TOURISM_OFFICE_ROLE,
  type SubmissionDestinationRole,
} from '@/lib/workflow/offices';
import { useRouter } from 'next/navigation';

type UploadMessage = {
  text: string;
  type: 'success' | 'error';
};

export default function UploadPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const otherDocumentTypeRef = useRef<HTMLTextAreaElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedOfficeRole, setSelectedOfficeRole] = useState<SubmissionDestinationRole | ''>('');
  const [category, setCategory] = useState('');
  const [otherDocumentType, setOtherDocumentType] = useState('');
  const [selectionNotice, setSelectionNotice] = useState('');
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [message, setMessage] = useState<UploadMessage | null>(null);

  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file]
  );
  const extension = file?.name.split('.').pop()?.toLowerCase() ?? '';
  const mimeType = file ? getWorkflowFileMimeType(file.name) : null;
  const availableDocumentTypes: readonly string[] = selectedOfficeRole
    ? SUBMISSION_DESTINATION_CONFIG[selectedOfficeRole].categories
    : [];

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!file) setShowPreview(false);
  }, [file]);

  useEffect(() => {
    const textarea = otherDocumentTypeRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [category, otherDocumentType]);

  useEffect(() => {
    if (!showPreview) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowPreview(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showPreview]);

  const selectMainFile = (selectedFile: File) => {
    const fileError = getWorkflowFilesTypeError([selectedFile], false);
    if (fileError) {
      setFile(null);
      setMessage({ text: fileError, type: 'error' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setFile(selectedFile);
    setTitle((currentTitle) => currentTitle || selectedFile.name.replace(/\.[^.]+$/, ''));
    setMessage(null);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) selectMainFile(selectedFile);
  };

  const handleAttachmentChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    const fileError = getWorkflowFilesTypeError(selectedFiles);
    if (fileError) {
      setAttachments([]);
      setMessage({ text: fileError, type: 'error' });
      event.target.value = '';
      return;
    }

    setAttachments(selectedFiles);
    setMessage(null);
  };

  const handleUpload = async () => {
    if (uploading) return;
    if (
      !file
      || !title.trim()
      || !description.trim()
      || !selectedOfficeRole
      || !category
      || !availableDocumentTypes.includes(category)
      || (category === 'Other' && !otherDocumentType.trim())
    ) {
      setMessage({
        text: 'Complete the destination, classification, document title, request summary, and main document before submitting.',
        type: 'error',
      });
      return;
    }

    const fileError =
      getWorkflowFilesTypeError([file], false) ||
      getWorkflowFilesTypeError(attachments);
    if (fileError) {
      setMessage({ text: fileError, type: 'error' });
      return;
    }

    setUploading(true);
    setMessage(null);
    const uploadedFilePaths: string[] = [];

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) throw new Error('Your session has expired. Please sign in again.');

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .single();
      if (profileError) throw profileError;
      if (!profile) {
        throw new Error('Your user profile was not found. Please contact an administrator.');
      }

      const uploadToStorage = async (uploadFile: File, index: number) => {
        const contentType = getWorkflowFileMimeType(uploadFile.name);
        if (!contentType) {
          throw new Error(`Unsupported file type: ${uploadFile.name}`);
        }

        const safeName = uploadFile.name.replace(/[^\w.-]/g, '_');
        const filePath = `${user.id}/${crypto.randomUUID()}-${index}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from('workflow_uploads')
          .upload(filePath, uploadFile, {
            contentType,
            cacheControl: '3600',
            upsert: false,
          });
        if (uploadError) throw uploadError;

        uploadedFilePaths.push(filePath);
        return { filePath, contentType };
      };

      const { filePath, contentType } = await uploadToStorage(file, 0);
      const attachmentRecords: {
        file_name: string;
        file_path: string;
        file_type: string;
        file_size: number;
      }[] = [];

      for (const [index, attachment] of attachments.entries()) {
        const uploadedAttachment = await uploadToStorage(attachment, index + 1);
        attachmentRecords.push({
          file_name: attachment.name,
          file_path: uploadedAttachment.filePath,
          file_type: uploadedAttachment.contentType,
          file_size: attachment.size,
        });
      }

      const { data: publicUrlData } = supabase.storage
        .from('workflow_uploads')
        .getPublicUrl(filePath);

      const fileName = title.trim().toLowerCase().endsWith(`.${extension}`)
        ? title.trim()
        : `${title.trim()}.${extension}`;
      const { data, error: submissionError } = await supabase.rpc(
        'create_workflow_submission',
        {
          submission_title: fileName,
          submission_file_path: filePath,
          submission_file_url: publicUrlData.publicUrl,
          submission_file_type: contentType,
          submission_file_size: file.size,
          submission_document_type: category,
          submission_description: description.trim(),
          submission_purpose: null,
          submission_requested_action: null,
          submission_intended_recipient: null,
          submission_office_role: selectedOfficeRole,
          attachment_records: attachmentRecords,
          ...(category === 'Other'
            ? { submission_other_document_type: otherDocumentType.trim() }
            : {}),
        }
      );
      if (submissionError) throw submissionError;

      const submission = Array.isArray(data) ? data[0] : data;
      if (!submission?.tracking_number) {
        throw new Error('The submission was saved without a tracking number.');
      }

      uploadedFilePaths.length = 0;
      setMessage({
        text: `Document submitted. Tracking number: ${submission.tracking_number}. Redirecting...`,
        type: 'success',
      });
      setTimeout(() => router.push('/workflow/user'), 1500);
    } catch (error: unknown) {
      console.error('Upload error:', error);
      if (uploadedFilePaths.length > 0) {
        try {
          const { error: cleanupError } = await supabase.storage
            .from('workflow_uploads')
            .remove(uploadedFilePaths);
          if (cleanupError) {
            console.error('Uploaded file cleanup error:', cleanupError);
          }
        } catch (cleanupError) {
          console.error('Uploaded file cleanup error:', cleanupError);
        }
      }

      const errorText =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error !== null && 'message' in error
            ? String(error.message)
            : 'An unexpected upload error occurred.';
      setMessage({ text: errorText, type: 'error' });
      setUploading(false);
    }
  };

  const labelClass =
    'mb-2 block text-[11px] font-semibold uppercase tracking-wide text-warm-text';
  const fieldClass =
    'h-11 w-full rounded-xl border border-warm-border bg-card px-4 text-sm text-warm-text outline-none transition-colors placeholder:text-muted-text/70 focus:border-clay focus:ring-2 focus:ring-clay/10';
  const handleDestinationChange = (nextOfficeRole: SubmissionDestinationRole | '') => {
    setSelectedOfficeRole(nextOfficeRole);
    if (category || otherDocumentType) {
      setSelectionNotice('The document type was cleared because it depends on the selected office.');
    } else {
      setSelectionNotice('');
    }
    setCategory('');
    setOtherDocumentType('');
  };

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
          <label className={labelClass} htmlFor="submission-destination">
            Destination office
          </label>
          <select
            id="submission-destination"
            value={selectedOfficeRole}
            onChange={(event) => handleDestinationChange(event.target.value as SubmissionDestinationRole | '')}
            className={`${fieldClass} cursor-pointer`}
            required
          >
            <option value="" disabled>Select the office that should receive this submission</option>
            {Object.entries(SUBMISSION_DESTINATION_CONFIG).map(([officeRole, office]) => (
              <option key={officeRole} value={officeRole}>{office.label}</option>
            ))}
          </select>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-text">
            {selectedOfficeRole === TOURISM_OFFICE_ROLE
              ? 'Your submission goes directly to the Daet Tourism Office for review and municipal-office assignment.'
              : 'Your submission goes directly to this office. It does not need Tourism Officer review first.'}
          </p>
          {selectionNotice && (
            <p role="status" className="mt-2 text-[11px] text-pending-text">
              {selectionNotice}
            </p>
          )}
        </div>

        <div>
          <label className={labelClass} htmlFor="submission-category">
            Classification / document type
          </label>
          <select
            id="submission-category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              if (event.target.value !== 'Other') setOtherDocumentType('');
            }}
            className={`${fieldClass} cursor-pointer`}
            disabled={!selectedOfficeRole}
            required
          >
            <option value="">
              {!selectedOfficeRole
                ? 'Select a destination office first'
                : 'Select a classification / document type'}
            </option>
            {availableDocumentTypes.map((documentType) => (
              <option key={documentType} value={documentType}>{documentType}</option>
            ))}
          </select>
          {selectedOfficeRole ? (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-text">
              Options are specific to {SUBMISSION_DESTINATION_CONFIG[selectedOfficeRole].label}.
            </p>
          ) : null}
        </div>

        {category === 'Other' && (
          <div className="md:col-span-2">
            <label className={labelClass} htmlFor="other-document-type">
              Please specify the document type
            </label>
            <textarea
              id="other-document-type"
              ref={otherDocumentTypeRef}
              value={otherDocumentType}
              onChange={(event) => setOtherDocumentType(event.target.value)}
              maxLength={120}
              placeholder="Enter the document type"
              rows={2}
              className={`${fieldClass} h-auto min-h-20 resize-none overflow-hidden py-3 leading-relaxed`}
              required
            />
            <p className="mt-1 text-[10px] text-muted-text">Up to 120 characters; the field expands as you type.</p>
          </div>
        )}

        <div>
          <label className={labelClass} htmlFor="submission-title">
            Document title / subject
          </label>
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
          <label className={labelClass} htmlFor="submission-context">
            Request summary / context
          </label>
          <textarea
            id="submission-context"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Briefly explain what this submission is about."
            className={`${fieldClass} h-auto resize-y py-3 leading-relaxed`}
            required
          />
        </div>

      </div>

      <section className="mt-6">
        <label className={`${labelClass} mb-1`} htmlFor="main-document">
          Main document
        </label>
        <input
          id="main-document"
          type="file"
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
              {extension.match(/^(jpe?g|png)$/) && previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt={file.name}
                  className="mb-3 max-h-24 max-w-full rounded-lg border border-warm-border bg-card object-contain"
                />
              ) : (
                <span
                  className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-card text-lg text-clay"
                  aria-hidden="true"
                >
                  ▤
                </span>
              )}
              <p className="max-w-full break-all text-sm font-semibold text-warm-text">
                {file.name}
              </p>
              <p className="mt-1 text-[11px] text-muted-text">
                {(file.size / 1024).toFixed(1)} KB
              </p>
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
              <span
                className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-clay-soft text-xl text-clay"
                aria-hidden="true"
              >
                ↑
              </span>
              <p className="text-sm font-semibold text-warm-text">
                Drag and drop your document here
              </p>
              <p className="mt-1 text-xs text-muted-text">
                or choose a file from your device
              </p>
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
        <input
          id="supporting-attachments"
          ref={attachmentInputRef}
          type="file"
          multiple
          onChange={handleAttachmentChange}
          className="block w-full text-xs text-muted-text file:mr-3 file:rounded-full file:border-0 file:bg-clay-soft file:px-4 file:py-2 file:text-xs file:font-semibold file:text-clay"
        />
        {attachments.length > 0 && (
          <ul className="mt-3 space-y-2 text-[11px] text-warm-text">
            {attachments.map((attachment, attachmentIndex) => (
              <li
                key={`${attachment.name}-${attachment.size}-${attachmentIndex}`}
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
                    if (attachmentInputRef.current) {
                      attachmentInputRef.current.value = '';
                    }
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
              <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
              Submitting...
            </>
          ) : (
            'Submit document →'
          )}
        </button>
      </footer>

      {message && (
        <div
          role={message.type === 'error' ? 'alert' : 'status'}
          className={`mt-4 rounded-xl border p-4 ${
            message.type === 'success'
              ? 'border-approved-bg bg-approved-bg/50 text-approved-text'
              : 'border-rejected-bg bg-rejected-bg/50 text-rejected-text'
          }`}
        >
          <p className="text-sm leading-relaxed">{message.text}</p>
        </div>
      )}

      {showPreview && file && previewUrl && mimeType && (
        <div className="fixed inset-0 z-100 flex flex-col bg-warm-text/75 backdrop-blur-sm animate-in fade-in duration-300 max-md:bg-card max-md:backdrop-blur-none">
          <div className="flex min-h-16 items-center justify-between border-b border-warm-border bg-card px-4 py-3 sm:px-8">
            <div className="flex min-w-0 flex-col">
              <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">
                Document preview
              </span>
              <h2 className="max-w-[55vw] truncate text-sm font-semibold text-warm-text">
                {file.name}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              aria-label="Close preview"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-text transition-colors hover:bg-sidebar hover:text-warm-text max-md:h-11 max-md:w-11"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden bg-cream p-3 sm:p-8 max-md:bg-card max-md:p-0">
            <div className="relative flex h-full w-full max-w-6xl items-center justify-center overflow-hidden rounded-xl border border-warm-border bg-card shadow-xl max-md:max-w-none max-md:rounded-none max-md:border-0 max-md:shadow-none">
              <FilePreview
                file={{
                  file_name: file.name,
                  file_url: previewUrl,
                  file_type: mimeType,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
