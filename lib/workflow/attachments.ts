import type { SupabaseClient } from '@supabase/supabase-js';

const STORAGE_BUCKET = 'connect-daet-submissions';

export async function downloadWorkflowAttachment(
  supabase: SupabaseClient,
  attachmentId: string
): Promise<Blob> {
  const { data: objectKey, error: authorizationError } = await supabase.rpc(
    'get_authorized_attachment_object_key',
    { p_attachment_id: attachmentId }
  );
  if (authorizationError) {
    throw new Error(`Attachment access could not be verified: ${authorizationError.message}`);
  }
  if (typeof objectKey !== 'string' || objectKey.length === 0) {
    throw new Error('Attachment access could not be verified.');
  }

  const { data, error: downloadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(objectKey);
  if (downloadError) {
    throw new Error(`Attachment download failed: ${downloadError.message}`);
  }
  return data;
}

export function saveDownload(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
