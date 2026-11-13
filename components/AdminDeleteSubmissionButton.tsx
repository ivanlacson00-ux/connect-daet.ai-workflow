'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface AdminDeleteSubmissionButtonProps {
  submissionId: string;
  fileName: string;
  onDeleted: () => void;
  className?: string;
}

interface DeletedSubmissionFiles {
  workflow_uploads: string[];
  workflow_message_attachments: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export default function AdminDeleteSubmissionButton({
  submissionId,
  fileName,
  onDeleted,
  className = '',
}: AdminDeleteSubmissionButtonProps) {
  const supabase = useMemo(() => createClient(), []);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const deleteSubmission = async () => {
    const confirmed = window.confirm(
      `Permanently delete "${fileName}" and all of its submission history, messages, assignments, notifications, and uploaded files?\n\nThis cannot be undone.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setError('');
    try {
      const { data, error: deleteError } = await supabase.rpc(
        'admin_delete_workflow_submission',
        { target_submission_id: submissionId },
      );
      if (deleteError) throw new Error(deleteError.message);
      onDeleted();

      if (
        !data
        || !isStringArray(data.workflow_uploads)
        || !isStringArray(data.workflow_message_attachments)
      ) {
        console.error('Submission was deleted, but its stored-file cleanup details were unavailable:', data);
        window.alert(
          'The submission record was deleted, but uploaded files could not be verified for cleanup. Contact your system administrator.',
        );
        return;
      }

      const files: DeletedSubmissionFiles = data;
      const cleanupErrors: string[] = [];
      for (const [bucket, paths] of Object.entries(files)) {
        for (let offset = 0; offset < paths.length; offset += 100) {
          const { error: storageError } = await supabase.storage
            .from(bucket)
            .remove(paths.slice(offset, offset + 100));
          if (storageError) cleanupErrors.push(`${bucket}: ${storageError.message}`);
        }
      }

      if (cleanupErrors.length > 0) {
        console.error('Submission was deleted, but uploaded files could not all be removed:', cleanupErrors);
        window.alert(
          'The submission record was deleted, but some uploaded files could not be removed. Contact your system administrator to finish storage cleanup.',
        );
      }
    } catch (deleteError) {
      const message = deleteError instanceof Error
        ? deleteError.message
        : 'Could not delete this submission.';
      console.error('Could not delete workflow submission:', deleteError);
      setError(message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => void deleteSubmission()}
        disabled={deleting}
        className="inline-flex h-10 w-full items-center justify-center rounded-full border border-rejected-text px-4 text-xs font-semibold text-rejected-text transition-colors hover:bg-rejected-bg disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        {deleting ? 'Deleting...' : 'Delete permanently'}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-rejected-text">
          {error}
        </p>
      )}
    </div>
  );
}
