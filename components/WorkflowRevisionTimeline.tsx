'use client';

import { useMemo, useState } from 'react';
import FilePreview from '@/components/FilePreview';
import { createClient } from '@/lib/supabase/client';
import type {
  WorkflowChangeRequest,
  WorkflowRevisionAuditEvent,
  WorkflowRevisionFile,
  WorkflowRevisionHistory,
  WorkflowSubmissionRevision,
} from '@/lib/workflow/revisions';

type TimelineEntry =
  | { id: string; createdAt: string; type: 'revision'; revision: WorkflowSubmissionRevision }
  | { id: string; createdAt: string; type: 'request'; request: WorkflowChangeRequest }
  | { id: string; createdAt: string; type: 'event'; event: WorkflowRevisionAuditEvent };

const officeLabels: Record<string, string> = {
  tourism_officer: 'Daet Tourism Office',
  municipal_treasurer: 'Municipal Treasurer',
  mayor_office: 'Mayor’s Office',
  sangguniang_bayan: 'Sangguniang Bayan',
  approver: 'Tourism Office (legacy role)',
};

const formatTimestamp = (value: string) =>
  new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

const changeLabels: Record<WorkflowRevisionFile['changeKind'], string> = {
  added: 'Added',
  replaced: 'Replaced',
  carried: 'Carried forward',
  removed: 'Removed',
};

const formFieldLabels: Record<string, string> = {
  title: 'Title',
  category: 'Document type',
  other_document_type: 'Other document type',
  description: 'Description',
  purpose: 'Purpose',
  requested_action: 'Requested action',
  intended_recipient: 'Intended recipient',
  initial_destination_role: 'Initial destination',
  selected_office_role: 'Responsible office',
};

function isRequestEvent(event: WorkflowRevisionAuditEvent) {
  return isRequestActionType(event.actionType);
}

function isRequestActionType(actionType: string) {
  return actionType === 'CHANGES_REQUESTED' || actionType === 'ROUTE_REQUIREMENTS_REQUESTED';
}

function legacyEventLabel(actionType: string) {
  if (isRequestActionType(actionType)) return 'Changes requested';
  if (actionType === 'CHANGES_RESPONDED' || actionType === 'REQUIREMENTS_RESUBMITTED') {
    return 'Submitter responded to the request';
  }
  return 'Revision submitted';
}

function RevisionFile({
  file,
  onDownload,
  onPreview,
  downloading,
  previewing,
}: {
  file: WorkflowRevisionFile;
  onDownload: (file: WorkflowRevisionFile) => void;
  onPreview: (file: WorkflowRevisionFile) => void;
  downloading: boolean;
  previewing: boolean;
}) {
  const isRemoved = file.changeKind === 'removed';

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warm-border bg-sidebar/60 px-3 py-2.5">
      <div className="min-w-0">
        <p className="break-words text-xs font-semibold text-warm-text">{file.fileName}</p>
        <p className="mt-0.5 text-[10px] text-muted-text">
          {file.fileRole === 'primary' ? 'Primary document' : 'Supporting document'}
          {' · '}
          {changeLabels[file.changeKind]}
        </p>
      </div>
      {!isRemoved && (
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => onPreview(file)}
            disabled={previewing || downloading}
            className="rounded-full border border-warm-border px-3 py-1.5 text-[10px] font-semibold text-clay transition-colors hover:bg-card disabled:cursor-wait disabled:opacity-60"
          >
            {previewing ? 'Preparing…' : 'Preview'}
          </button>
          <button
            type="button"
            onClick={() => onDownload(file)}
            disabled={downloading || previewing}
            className="rounded-full border border-warm-border px-3 py-1.5 text-[10px] font-semibold text-clay transition-colors hover:bg-card disabled:cursor-wait disabled:opacity-60"
          >
            {downloading ? 'Preparing…' : 'Download'}
          </button>
        </div>
      )}
    </li>
  );
}

export default function WorkflowRevisionTimeline({
  history,
  loading = false,
  error = null,
}: {
  history: WorkflowRevisionHistory | null;
  loading?: boolean;
  error?: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [previewingFileId, setPreviewingFileId] = useState<string | null>(null);
  const [previewingFile, setPreviewingFile] = useState<{
    file: WorkflowRevisionFile;
    signedUrl: string;
  } | null>(null);

  const entries = useMemo<TimelineEntry[]>(() => {
    if (!history) return [];

    const requestEventIds = new Set(
      history.changeRequests
        .map((request) => request.sourceAuditEventId)
        .filter((id): id is string => id !== null),
    );
    const legacyEvents = history.auditEvents
      .filter((event) =>
        isRequestEvent(event)
        || event.actionType === 'CHANGES_RESPONDED'
        || event.actionType === 'REQUIREMENTS_RESUBMITTED'
        || event.actionType === 'SUBMISSION_REOPENED'
      )
      .filter((event) => !requestEventIds.has(event.id));

    return [
      ...history.revisions.map((revision): TimelineEntry => ({
        id: revision.id,
        createdAt: revision.createdAt,
        type: 'revision',
        revision,
      })),
      ...history.changeRequests.map((request): TimelineEntry => ({
        id: request.id,
        createdAt: request.createdAt,
        type: 'request',
        request,
      })),
      ...legacyEvents.map((event): TimelineEntry => ({
        id: event.id,
        createdAt: event.createdAt,
        type: 'event',
        event,
      })),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }, [history]);

  const handleDownload = async (file: WorkflowRevisionFile) => {
    setDownloadError(null);
    setDownloadingFileId(file.id);

    try {
      const { data, error: signedUrlError } = await supabase.storage
        .from('workflow_uploads')
        .createSignedUrl(file.storagePath, 60);
      if (signedUrlError) throw new Error(signedUrlError.message);
      if (!data?.signedUrl) throw new Error('The secure download link was not returned.');

      const response = await fetch(data.signedUrl);
      if (!response.ok) throw new Error(`The file download failed (${response.status}).`);

      const objectUrl = window.URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = file.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
    } catch (downloadErrorValue) {
      const message = downloadErrorValue instanceof Error
        ? downloadErrorValue.message
        : 'Could not download this revision file.';
      console.error('Revision file download failed:', downloadErrorValue);
      setDownloadError(message);
    } finally {
      setDownloadingFileId(null);
    }
  };

  const handlePreview = async (file: WorkflowRevisionFile) => {
    setDownloadError(null);
    setPreviewingFileId(file.id);

    try {
      const { data, error: signedUrlError } = await supabase.storage
        .from('workflow_uploads')
        .createSignedUrl(file.storagePath, 60);
      if (signedUrlError) throw new Error(signedUrlError.message);
      if (!data?.signedUrl) throw new Error('The secure preview link was not returned.');
      setPreviewingFile({ file, signedUrl: data.signedUrl });
    } catch (previewErrorValue) {
      const message = previewErrorValue instanceof Error
        ? previewErrorValue.message
        : 'Could not preview this revision file.';
      console.error('Revision file preview failed:', previewErrorValue);
      setDownloadError(message);
    } finally {
      setPreviewingFileId(null);
    }
  };

  return (
    <>
    <section className="mt-5 rounded-2xl border border-warm-border bg-card p-5 md:p-6" aria-labelledby="revision-history-heading">
      <header className="mb-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-clay">File history</p>
        <h2 id="revision-history-heading" className="mt-1 font-serif text-xl font-semibold text-warm-text">
          Submission versions
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-text">
          Each version is retained with the change request and files available at that point.
        </p>
      </header>

      {history?.changeRequestRepairNeeded && (
        <p className="mb-4 rounded-xl border border-pending-text/20 bg-pending-bg px-3 py-2.5 text-xs text-pending-text" role="status">
          This legacy request needs staff repair because its original request details could not be recovered.
        </p>
      )}

      {loading ? (
        <p className="text-xs text-muted-text" role="status">Loading revision history…</p>
      ) : error ? (
        <p className="rounded-xl border border-rejected-text/20 bg-rejected-bg px-3 py-2.5 text-xs text-rejected-text" role="alert">
          {error}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-text">No revision or change-request history recorded yet.</p>
      ) : (
        <ol className="space-y-5">
          {entries.map((entry) => (
            <li key={`${entry.type}-${entry.id}`} className="relative border-l border-warm-border pl-4">
              <span className="absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full bg-clay ring-4 ring-card" />
              {entry.type === 'revision' ? (
                <>
                  <p className="text-xs font-semibold text-warm-text">Revision {entry.revision.revisionNo}</p>
                  <time dateTime={entry.createdAt} className="mt-0.5 block text-[10px] text-muted-text">
                    Submitted by the applicant · {formatTimestamp(entry.createdAt)}
                  </time>
                  {entry.revision.submitterMessage && (
                    <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-sidebar px-3 py-2 text-[11px] leading-relaxed text-warm-text">
                      {entry.revision.submitterMessage}
                    </p>
                  )}
                  {entry.revision.formSnapshot && (
                    <dl className="mt-3 grid gap-2 rounded-xl border border-warm-border bg-sidebar/60 p-3 sm:grid-cols-2">
                      {Object.entries(formFieldLabels).map(([field, label]) => {
                        const value = entry.revision.formSnapshot?.[field];
                        if (typeof value !== 'string' || value.length === 0) return null;
                        return (
                          <div key={field} className="min-w-0">
                            <dt className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-text">{label}</dt>
                            <dd className="mt-0.5 whitespace-pre-wrap break-words text-[11px] text-warm-text">{value}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  )}
                  {entry.revision.backfillQuality === 'partial' && (
                    <p className="mt-2 text-[10px] text-muted-text">
                      Some older form or file-change details were not recorded and cannot be reconstructed.
                    </p>
                  )}
                  {entry.revision.files.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {entry.revision.files.map((file) => (
                        <RevisionFile
                          key={file.id}
                          file={file}
                          onDownload={handleDownload}
                          onPreview={handlePreview}
                          downloading={downloadingFileId === file.id}
                          previewing={previewingFileId === file.id}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[10px] text-muted-text">No file snapshot is available for this version.</p>
                  )}
                </>
              ) : entry.type === 'request' ? (
                <>
                  <p className="text-xs font-semibold text-warm-text">
                    Changes requested by {officeLabels[entry.request.requestedByOffice] ?? entry.request.requestedByOffice}
                  </p>
                  <time dateTime={entry.createdAt} className="mt-0.5 block text-[10px] text-muted-text">
                    {formatTimestamp(entry.createdAt)}
                  </time>
                  <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-sidebar px-3 py-2 text-[11px] leading-relaxed text-warm-text">
                    {entry.request.message}
                  </p>
                  <p className="mt-1 text-[10px] font-medium text-muted-text">
                    {entry.request.status === 'open'
                      ? 'Awaiting the applicant'
                      : entry.request.status === 'fulfilled'
                        ? 'Fulfilled by a submitted revision'
                        : 'Abandoned when the submission was permanently closed'}
                    {entry.request.backfillQuality === 'partial' ? ' · Legacy record' : ''}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-warm-text">{legacyEventLabel(entry.event.actionType)}</p>
                  <time dateTime={entry.createdAt} className="mt-0.5 block text-[10px] text-muted-text">
                    {formatTimestamp(entry.createdAt)} · Legacy activity
                  </time>
                  {entry.event.comments && (
                    <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-sidebar px-3 py-2 text-[11px] leading-relaxed text-warm-text">
                      {entry.event.comments}
                    </p>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {downloadError && (
        <p className="mt-3 text-xs text-rejected-text" role="alert">{downloadError}</p>
      )}
    </section>
    {previewingFile && (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${previewingFile.file.fileName}`}
      >
        <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-warm-border px-4 py-3">
            <p className="min-w-0 break-words text-sm font-semibold text-warm-text">{previewingFile.file.fileName}</p>
            <button
              type="button"
              onClick={() => setPreviewingFile(null)}
              className="shrink-0 rounded-full border border-warm-border px-3 py-1.5 text-xs font-semibold text-clay hover:bg-sidebar"
              aria-label="Close preview"
            >
              Close
            </button>
          </div>
          <div className="min-h-[55vh] flex-1 overflow-auto">
            <FilePreview file={{
              file_name: previewingFile.file.fileName,
              file_url: previewingFile.signedUrl,
              file_type: previewingFile.file.fileType,
            }} />
          </div>
        </div>
      </div>
    )}
    </>
  );
}
