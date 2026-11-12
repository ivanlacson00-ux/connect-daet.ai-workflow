'use client';

'use client';

import { useEffect, useState } from 'react';

interface CloseSubmissionDialogProps {
  open: boolean;
  pendingAssignmentCount: number;
  updating: boolean;
  error?: string;
  accept?: string;
  note?: string;
  file?: File | null;
  onCancel: () => void;
  onConfirm: (note: string, file: File | null) => void;
}

export default function CloseSubmissionDialog({
  open,
  pendingAssignmentCount,
  updating,
  error,
  accept,
  note = '',
  file = null,
  onCancel,
  onConfirm,
}: CloseSubmissionDialogProps) {
  const [localNote, setLocalNote] = useState('');
  const [localFile, setLocalFile] = useState<File | null>(null);
  const controlled = note !== undefined || file !== undefined;
  const currentNote = controlled ? note ?? '' : localNote;
  const currentFile = controlled ? file ?? null : localFile;
  useEffect(() => {
    if (!open) {
      setLocalNote('');
      setLocalFile(null);
    }
  }, [open]);
  if (!open) return null;

  const assignmentsPending = pendingAssignmentCount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-submission-title"
        aria-describedby="close-submission-description"
        className="w-full max-w-md rounded-2xl border border-warm-border bg-card p-6 shadow-xl"
      >
        <h2 id="close-submission-title" className="font-serif text-xl text-warm-text">
          Complete submission?
        </h2>
        <p id="close-submission-description" className="mt-3 text-sm leading-relaxed text-muted-text">
          Completing confirms that the responsible office has finished processing this request; it records completion, not approval.
          Pending required office assignments must be finished first.
        </p>
        {assignmentsPending && (
          <p role="status" className="mt-4 rounded-xl border border-pending-bg bg-pending-bg/50 px-4 py-3 text-xs font-medium text-pending-text">
            {pendingAssignmentCount} required office {pendingAssignmentCount === 1 ? 'assignment is' : 'assignments are'} still pending. Complete them before completing the submission.
          </p>
        )}
        {controlled ? (
          <div className="mt-4 space-y-3 rounded-xl bg-sidebar/60 p-3 text-xs">
            <div>
              <p className="font-semibold text-warm-text">Completion note</p>
              <p className="mt-1 whitespace-pre-wrap text-muted-text">{currentNote || 'No note'}</p>
            </div>
            <div>
              <p className="font-semibold text-warm-text">Completion document</p>
              <p className="mt-1 break-all text-muted-text">{currentFile?.name ?? 'No file attached'}</p>
            </div>
          </div>
        ) : (
          <>
            <label htmlFor="closure-note" className="mt-4 block text-xs font-semibold text-warm-text">
              Completion note (optional)
            </label>
            <textarea
              id="closure-note"
              value={currentNote}
              onChange={(event) => setLocalNote(event.target.value)}
              disabled={updating}
              maxLength={5000}
              rows={3}
              className="mt-2 w-full resize-y rounded-xl border border-warm-border bg-card px-3 py-2 text-xs text-warm-text outline-none focus:border-clay"
            />
            <label htmlFor="closure-file" className="mt-4 block text-xs font-semibold text-warm-text">
              Completion document (optional)
            </label>
            <input
              id="closure-file"
              type="file"
              accept={accept}
              onChange={(event) => setLocalFile(event.target.files?.[0] ?? null)}
              disabled={updating}
              className="mt-2 block w-full text-xs text-muted-text"
            />
          </>
        )}
        {error && <p role="alert" className="mt-3 text-xs text-rejected-text">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-11 items-center justify-center rounded-full border border-warm-border px-5 text-xs font-semibold text-warm-text hover:bg-sidebar"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(currentNote, currentFile)}
            disabled={updating || assignmentsPending}
            className="inline-flex h-11 items-center justify-center rounded-full bg-clay px-5 text-xs font-semibold text-white hover:bg-warm-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updating ? 'Completing...' : 'Confirm completion'}
          </button>
        </div>
      </section>
    </div>
  );
}
