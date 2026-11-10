-- Private object storage for clean-schema submission attachments.
-- Objects are initially staged under the authenticated uploader's UUID folder.
-- After create_submission records their object keys, reads are authorized through
-- the clean attachment metadata and can_read_attachment().
-- Keep the 20 MiB bucket limit aligned with lib/uploadRules.ts.

BEGIN;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  allowed_mime_types,
  file_size_limit
)
VALUES (
  'connect-daet-submissions',
  'connect-daet-submissions',
  false,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'application/zip'
  ]::text[],
  20971520
)
ON CONFLICT (id) DO NOTHING;

DO $verify_private_bucket$
DECLARE
  v_bucket storage.buckets%ROWTYPE;
BEGIN
  SELECT bucket.*
    INTO v_bucket
  FROM storage.buckets AS bucket
  WHERE bucket.id = 'connect-daet-submissions';

  IF NOT FOUND
    OR v_bucket.name IS DISTINCT FROM 'connect-daet-submissions'
    OR v_bucket.public IS DISTINCT FROM false
    OR v_bucket.allowed_mime_types IS DISTINCT FROM ARRAY[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg',
      'image/png',
      'application/zip'
    ]::text[]
    OR v_bucket.file_size_limit IS DISTINCT FROM 20971520
  THEN
    RAISE EXCEPTION
      'The submission bucket must have the expected name, private setting, MIME allowlist, and 20 MiB file-size limit';
  END IF;
END;
$verify_private_bucket$;

CREATE POLICY clean_submission_objects_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'connect-daet-submissions'
    AND cardinality(storage.foldername(name)) = 1
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

CREATE POLICY clean_submission_objects_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'connect-daet-submissions'
    AND EXISTS (
      SELECT 1
      FROM public.attachments AS attachment
      WHERE attachment.object_key = storage.objects.name
        AND public.can_read_attachment(attachment.id)
    )
  );

CREATE POLICY clean_submission_objects_delete_unlinked
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'connect-daet-submissions'
    AND cardinality(storage.foldername(name)) = 1
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND NOT EXISTS (
      SELECT 1
      FROM public.attachments AS attachment
      WHERE attachment.object_key = storage.objects.name
    )
  );

COMMIT;
