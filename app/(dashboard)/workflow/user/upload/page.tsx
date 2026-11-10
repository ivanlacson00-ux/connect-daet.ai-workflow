'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  getWorkflowFileMimeType,
  getWorkflowFilesTypeError,
  WORKFLOW_ATTACHMENT_ACCEPT,
  WORKFLOW_DOCUMENT_ACCEPT,
} from '@/lib/workflow/file-types';

type UploadMessage = { type: 'success' | 'error'; text: string };
type UploadedMetadata = {
  original_filename: string;
  object_key: string;
  content_type: string;
  byte_size: number;
};

const STORAGE_BUCKET = 'connect-daet-submissions';

export default function UploadPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const mainFileRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<HTMLInputElement>(null);
  const [mainFile, setMainFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [destinationDepartment, setDestinationDepartment] = useState('');
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [expectedVersionId, setExpectedVersionId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<UploadMessage | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const resubmitId = query.get('resubmit');
    if (!resubmitId) return;

    let active = true;
    void supabase
      .from('submissions')
      .select('id, title, description, state, current_version_id')
      .eq('id', resubmitId)
      .single()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setMessage({ type: 'error', text: 'This submission cannot be loaded for resubmission.' });
          return;
        }
        if (data.state !== 'returned') {
          setMessage({ type: 'error', text: 'Only a returned submission can be resubmitted.' });
          return;
        }
        setSubmissionId(data.id);
        setExpectedVersionId(data.current_version_id);
        setTitle(data.title);
        setDescription(data.description ?? '');
      });

    return () => {
      active = false;
    };
  }, [supabase]);

  const handleMainFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) return;
    const error = getWorkflowFilesTypeError([selected], false);
    if (error) {
      setMainFile(null);
      setMessage({ type: 'error', text: error });
      event.target.value = '';
      return;
    }
    setMainFile(selected);
    setMessage(null);
  };

  const handleAttachments = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const error = getWorkflowFilesTypeError(selected);
    if (error) {
      setAttachments([]);
      setMessage({ type: 'error', text: error });
      event.target.value = '';
      return;
    }
    setAttachments(selected);
    setMessage(null);
  };

  const handleSubmit = async () => {
    if (uploading) return;
    if (!title.trim() || !description.trim() || !mainFile) {
      setMessage({ type: 'error', text: 'Enter a title and summary, then select the main document.' });
      return;
    }

    const fileError = getWorkflowFilesTypeError([mainFile], false)
      ?? getWorkflowFilesTypeError(attachments);
    if (fileError) {
      setMessage({ type: 'error', text: fileError });
      return;
    }

    setUploading(true);
    setMessage(null);
    const uploadedKeys: string[] = [];
    let submissionSaved = false;

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('Your session has expired. Sign in again to continue.');

      const files = [mainFile, ...attachments];
      const metadata: UploadedMetadata[] = [];
      for (const [index, file] of files.entries()) {
        const contentType = getWorkflowFileMimeType(file.name);
        if (!contentType) throw new Error(`Unsupported file type: ${file.name}`);

        const safeName = file.name.replace(/[^\w.-]/g, '_');
        const objectKey = `${user.id}/${crypto.randomUUID()}-${index}-${safeName}`;
        const { error: storageError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(objectKey, file, {
            contentType,
            cacheControl: '3600',
            upsert: false,
          });
        if (storageError) throw storageError;

        uploadedKeys.push(objectKey);
        metadata.push({
          original_filename: file.name,
          object_key: objectKey,
          content_type: contentType,
          byte_size: file.size,
        });
      }

      if (submissionId && expectedVersionId) {
        const { error: resubmitError } = await supabase.rpc('resubmit_submission', {
          p_submission_id: submissionId,
          p_expected_version_id: expectedVersionId,
          p_version_description: description.trim(),
          p_attachment_metadata: metadata,
          p_idempotency_key: crypto.randomUUID(),
        });
        if (resubmitError) throw resubmitError;
        submissionSaved = true;
      } else {
        const { data, error: submissionError } = await supabase.rpc('create_submission', {
          p_title: title.trim(),
          p_description: description.trim(),
          p_document_type_id: null,
          p_destination_department: destinationDepartment.trim() || null,
          p_version_description: 'Initial submission',
          p_attachment_metadata: metadata,
          p_idempotency_key: crypto.randomUUID(),
        });
        if (submissionError) throw submissionError;
        if (typeof data !== 'string') throw new Error('The submission operation returned no submission ID.');
        submissionSaved = true;

        const { data: submission, error: trackingError } = await supabase
          .from('submissions')
          .select('tracking_number')
          .eq('id', data)
          .single();
        if (trackingError) {
          console.error('Submission saved, but tracking number could not be loaded:', trackingError);
          setMessage({ type: 'success', text: 'Submission saved. Its tracking number is temporarily unavailable; view it from your submissions.' });
          router.push('/workflow/user');
          return;
        }
        setMessage({ type: 'success', text: `Submission received. Tracking number: ${submission.tracking_number}` });
      }

      uploadedKeys.length = 0;
      setTimeout(() => router.push('/workflow/user'), 800);
    } catch (error: unknown) {
      console.error('Submission upload failed:', error);
      let cleanupMessage = '';
      if (!submissionSaved && uploadedKeys.length > 0) {
        const { error: cleanupError } = await supabase.storage.from(STORAGE_BUCKET).remove(uploadedKeys);
        if (cleanupError) {
          console.error('Failed to remove unattached uploaded objects:', cleanupError);
          cleanupMessage = ' Some uploaded files may need administrator cleanup.';
        }
      }
      const errorText = error instanceof Error ? error.message : 'Unexpected submission error.';
      setMessage({ type: 'error', text: `${errorText}${cleanupMessage}` });
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="mx-auto max-w-3xl rounded-2xl border border-warm-border bg-card p-6">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-clay">
          {submissionId ? 'Corrected version' : 'New submission'}
        </p>
        <h1 className="mt-2 font-serif text-2xl text-warm-text">
          {submissionId ? 'Resubmit your document' : 'Submit a document'}
        </h1>
        <p className="mt-2 text-sm text-muted-text">
          Every submission is first reviewed by the Tourism Officer. Municipal offices are selected by that officer when required.
        </p>
      </header>

      {submissionId && (
        <p className="mb-5 rounded-xl border border-pending-bg bg-pending-bg/40 p-3 text-sm text-pending-text">
          Resubmission creates a new version. Earlier files and office responses remain in the history.
        </p>
      )}

      <div className="grid gap-5">
        <label className="grid gap-2 text-sm font-medium text-warm-text">
          Document title
          <input value={title} onChange={(event) => setTitle(event.target.value)} required className="rounded-xl border border-warm-border bg-white px-4 py-3" />
        </label>
        <label className="grid gap-2 text-sm font-medium text-warm-text">
          Request summary
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} required className="resize-y rounded-xl border border-warm-border bg-white px-4 py-3" />
        </label>
        {!submissionId && (
          <label className="grid gap-2 text-sm font-medium text-warm-text">
            Destination department (optional)
            <input value={destinationDepartment} onChange={(event) => setDestinationDepartment(event.target.value)} className="rounded-xl border border-warm-border bg-white px-4 py-3" />
            <span className="text-xs font-normal text-muted-text">This information does not automatically route your submission.</span>
          </label>
        )}
        <label className="grid gap-2 text-sm font-medium text-warm-text">
          Main document
          <input ref={mainFileRef} type="file" accept={WORKFLOW_DOCUMENT_ACCEPT} onChange={handleMainFile} required className="rounded-xl border border-warm-border bg-white p-3 text-sm" />
          <span className="text-xs font-normal text-muted-text">PDF, Word, Excel, CSV, PowerPoint, JPEG, or PNG.</span>
        </label>
        <label className="grid gap-2 text-sm font-medium text-warm-text">
          Supporting attachments (optional)
          <input ref={attachmentsRef} type="file" accept={WORKFLOW_ATTACHMENT_ACCEPT} multiple onChange={handleAttachments} className="rounded-xl border border-warm-border bg-white p-3 text-sm" />
          <span className="text-xs font-normal text-muted-text">ZIP files are accepted only as supporting attachments.</span>
        </label>
        {(mainFile || attachments.length > 0) && (
          <ul className="rounded-xl bg-sidebar p-4 text-xs text-muted-text">
            {mainFile && <li>Main: {mainFile.name} ({Math.ceil(mainFile.size / 1024)} KB)</li>}
            {attachments.map((attachment) => <li key={`${attachment.name}-${attachment.size}`}>Attachment: {attachment.name} ({Math.ceil(attachment.size / 1024)} KB)</li>)}
          </ul>
        )}
        {message && (
          <p role={message.type === 'error' ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${message.type === 'success' ? 'border-approved-bg bg-approved-bg/50 text-approved-text' : 'border-rejected-bg bg-rejected-bg/50 text-rejected-text'}`}>
            {message.text}
          </p>
        )}
        <button type="button" onClick={handleSubmit} disabled={uploading} className="rounded-full bg-clay px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {uploading ? 'Uploading securely...' : submissionId ? 'Resubmit corrected version' : 'Submit for Tourism Officer review'}
        </button>
      </div>
    </section>
  );
}
