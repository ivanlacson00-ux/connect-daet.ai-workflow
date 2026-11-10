-- Validate private Storage objects before creating attachment metadata.
-- The executor can inspect only the authenticated user's objects in this bucket.

BEGIN;

DO $check_attachment_object_keys$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.attachments
    GROUP BY object_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate attachment object keys exist; resolve them before adding the unique index';
  END IF;
END;
$check_attachment_object_keys$;

CREATE UNIQUE INDEX attachments_object_key_unique_idx
  ON public.attachments (object_key)
  WHERE object_key IS NOT NULL;

GRANT USAGE ON SCHEMA storage TO connect_daet_workflow_executor;
GRANT SELECT ON storage.objects TO connect_daet_workflow_executor;

CREATE POLICY clean_submission_objects_executor_validation_read
  ON storage.objects
  FOR SELECT
  TO connect_daet_workflow_executor
  USING (
    bucket_id = 'connect-daet-submissions'
    AND cardinality(storage.foldername(name)) = 1
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (owner IS NOT NULL OR owner_id IS NOT NULL)
    AND (owner IS NULL OR owner = (SELECT auth.uid()))
    AND (owner_id IS NULL OR owner_id = (SELECT auth.uid())::text)
  );

CREATE OR REPLACE FUNCTION private.validate_submission_attachment_object(
  p_object_key text,
  p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $validate_submission_attachment_object$
BEGIN
  IF p_actor IS NULL
    OR p_actor IS DISTINCT FROM private.current_user_id()
    OR nullif(btrim(p_object_key), '') IS NULL
    OR cardinality(storage.foldername(p_object_key)) <> 1
    OR (storage.foldername(p_object_key))[1] IS DISTINCT FROM p_actor::text
  THEN
    RAISE EXCEPTION
      'Attachment object key must be a single-folder path owned by the authenticated uploader';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_object_key, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.attachments AS attachment
    WHERE attachment.object_key = p_object_key
  ) THEN
    RAISE EXCEPTION 'Attachment object key has already been linked';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects AS object
    WHERE object.bucket_id = 'connect-daet-submissions'
      AND object.name = p_object_key
      AND cardinality(storage.foldername(object.name)) = 1
      AND (storage.foldername(object.name))[1] = p_actor::text
      AND (object.owner IS NOT NULL OR object.owner_id IS NOT NULL)
      AND (object.owner IS NULL OR object.owner = p_actor)
      AND (object.owner_id IS NULL OR object.owner_id = p_actor::text)
  ) THEN
    RAISE EXCEPTION
      'Attachment object must exist in the private submission bucket and belong to the authenticated uploader';
  END IF;
END;
$validate_submission_attachment_object$;

ALTER FUNCTION private.validate_submission_attachment_object(text, uuid)
  OWNER TO connect_daet_workflow_executor;
REVOKE ALL ON FUNCTION private.validate_submission_attachment_object(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.validate_submission_attachment_object(text, uuid)
  TO connect_daet_workflow_executor;

CREATE OR REPLACE FUNCTION public.create_submission(
  p_title text,
  p_description text,
  p_document_type_id uuid,
  p_destination_department text,
  p_version_description text,
  p_attachment_metadata jsonb,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $create_submission$
DECLARE
  v_actor uuid := private.current_user_id();
  v_user_grant_id uuid;
  v_submission_id uuid;
  v_tracking_number text;
  v_version_id uuid;
  v_attachment_id uuid;
  v_item jsonb;
  v_attachments jsonb := coalesce(p_attachment_metadata, '[]'::jsonb);
  v_claim public.idempotency_claim;
BEGIN
  v_user_grant_id := public.require_active_workflow_grant('user');

  IF nullif(btrim(p_title), '') IS NULL OR jsonb_typeof(v_attachments) <> 'array' THEN
    RAISE EXCEPTION 'Invalid submission content';
  END IF;

  IF p_document_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.document_types AS dt
    WHERE dt.id = p_document_type_id AND dt.is_active
  ) THEN
    RAISE EXCEPTION 'The selected document type is unavailable';
  END IF;

  v_claim := public.claim_workflow_idempotency(
    v_actor, 'create_submission', NULL, p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'title', p_title,
      'description', p_description,
      'document_type_id', p_document_type_id,
      'destination_department', p_destination_department,
      'version_description', p_version_description,
      'attachment_metadata', v_attachments
    )
  );
  IF v_claim.replay THEN
    RETURN v_claim.result_id;
  END IF;

  v_tracking_number := public.generate_workflow_tracking_number();
  INSERT INTO public.submissions (
    submitter_profile_id, document_type_id, tracking_number, title, description,
    destination_department, state
  )
  VALUES (
    v_actor, p_document_type_id, v_tracking_number, p_title, p_description,
    p_destination_department, 'initial_review'
  )
  RETURNING id INTO v_submission_id;

  INSERT INTO public.submission_versions (
    submission_id, version_number, uploaded_by_profile_id, description
  )
  VALUES (v_submission_id, 1, v_actor, p_version_description)
  RETURNING id INTO v_version_id;

  UPDATE public.submissions
  SET current_version_id = v_version_id,
      updated_at = now()
  WHERE id = v_submission_id;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_attachments)
  LOOP
    IF nullif(btrim(v_item ->> 'original_filename'), '') IS NULL
      OR nullif(btrim(v_item ->> 'object_key'), '') IS NULL
    THEN
      RAISE EXCEPTION 'Invalid attachment metadata';
    END IF;

    PERFORM private.validate_submission_attachment_object(
      v_item ->> 'object_key', v_actor
    );

    INSERT INTO public.attachments (
      submission_id, uploaded_by_profile_id, original_filename,
      content_type, byte_size, object_key
    )
    VALUES (
      v_submission_id,
      v_actor,
      v_item ->> 'original_filename',
      nullif(v_item ->> 'content_type', ''),
      CASE
        WHEN nullif(v_item ->> 'byte_size', '') IS NULL THEN NULL
        ELSE (v_item ->> 'byte_size')::bigint
      END,
      v_item ->> 'object_key'
    )
    RETURNING id INTO v_attachment_id;

    INSERT INTO public.submission_version_attachments (
      submission_id, submission_version_id, attachment_id
    )
    VALUES (v_submission_id, v_version_id, v_attachment_id);
  END LOOP;

  INSERT INTO public.submission_status_history (
    submission_id, previous_state, new_state, actor_profile_id, role_grant_id,
    cause_code, reason
  )
  VALUES (
    v_submission_id, NULL, 'initial_review', v_actor, v_user_grant_id,
    'submission_submitted', NULL
  );

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, submission_id, event_kind, details
  )
  VALUES (
    v_actor, v_user_grant_id, v_submission_id, 'submission_submitted',
    pg_catalog.jsonb_build_object('version_id', v_version_id)
  );

  PERFORM public.complete_workflow_idempotency(v_claim.key_id, v_submission_id);
  RETURN v_submission_id;
END;
$create_submission$;

CREATE OR REPLACE FUNCTION public.resubmit_submission(
  p_submission_id uuid,
  p_expected_version_id uuid,
  p_version_description text,
  p_attachment_metadata jsonb,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $resubmit_submission$
DECLARE
  v_actor uuid := private.current_user_id();
  v_user_grant_id uuid;
  v_state public.submission_state;
  v_current_version_id uuid;
  v_next_version_number integer;
  v_version_id uuid;
  v_attachment_id uuid;
  v_item jsonb;
  v_attachments jsonb := coalesce(p_attachment_metadata, '[]'::jsonb);
  v_claim public.idempotency_claim;
BEGIN
  v_user_grant_id := public.require_active_workflow_grant('user');
  v_claim := public.claim_workflow_idempotency(
    v_actor, 'resubmit_submission', p_submission_id, p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'expected_version_id', p_expected_version_id,
      'version_description', p_version_description,
      'attachment_metadata', v_attachments
    )
  );
  IF v_claim.replay THEN
    RETURN v_claim.result_id;
  END IF;

  SELECT s.state, s.current_version_id
    INTO v_state, v_current_version_id
  FROM public.submissions AS s
  WHERE s.id = p_submission_id
    AND s.submitter_profile_id = v_actor
  FOR UPDATE;

  IF NOT FOUND OR v_state <> 'returned'
    OR v_current_version_id IS DISTINCT FROM p_expected_version_id
    OR jsonb_typeof(v_attachments) <> 'array'
  THEN
    RAISE EXCEPTION 'Submission is not eligible for resubmission';
  END IF;

  SELECT coalesce(max(sv.version_number), 0) + 1
    INTO v_next_version_number
  FROM public.submission_versions AS sv
  WHERE sv.submission_id = p_submission_id;

  INSERT INTO public.submission_versions (
    submission_id, version_number, uploaded_by_profile_id, description
  )
  VALUES (p_submission_id, v_next_version_number, v_actor, p_version_description)
  RETURNING id INTO v_version_id;

  UPDATE public.submissions
  SET current_version_id = v_version_id,
      state = 'initial_review',
      updated_at = now()
  WHERE id = p_submission_id;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_attachments)
  LOOP
    IF nullif(btrim(v_item ->> 'original_filename'), '') IS NULL
      OR nullif(btrim(v_item ->> 'object_key'), '') IS NULL
    THEN
      RAISE EXCEPTION 'Invalid attachment metadata';
    END IF;

    PERFORM private.validate_submission_attachment_object(
      v_item ->> 'object_key', v_actor
    );

    INSERT INTO public.attachments (
      submission_id, uploaded_by_profile_id, original_filename,
      content_type, byte_size, object_key
    )
    VALUES (
      p_submission_id, v_actor, v_item ->> 'original_filename',
      nullif(v_item ->> 'content_type', ''),
      CASE
        WHEN nullif(v_item ->> 'byte_size', '') IS NULL THEN NULL
        ELSE (v_item ->> 'byte_size')::bigint
      END,
      v_item ->> 'object_key'
    )
    RETURNING id INTO v_attachment_id;

    INSERT INTO public.submission_version_attachments (
      submission_id, submission_version_id, attachment_id
    )
    VALUES (p_submission_id, v_version_id, v_attachment_id);
  END LOOP;

  INSERT INTO public.submission_status_history (
    submission_id, previous_state, new_state, actor_profile_id, role_grant_id,
    cause_code, reason
  )
  VALUES (
    p_submission_id, 'returned', 'initial_review', v_actor, v_user_grant_id,
    'corrected_resubmission', NULL
  );

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, submission_id, event_kind, details
  )
  VALUES (
    v_actor, v_user_grant_id, p_submission_id, 'corrected_resubmission',
    pg_catalog.jsonb_build_object('version_id', v_version_id)
  );

  PERFORM public.complete_workflow_idempotency(v_claim.key_id, v_version_id);
  RETURN v_version_id;
END;
$resubmit_submission$;

ALTER FUNCTION public.create_submission(
  text, text, uuid, text, text, jsonb, text
) OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.resubmit_submission(uuid, uuid, text, jsonb, text)
  OWNER TO connect_daet_workflow_executor;

REVOKE ALL ON FUNCTION public.create_submission(
  text, text, uuid, text, text, jsonb, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resubmit_submission(
  uuid, uuid, text, jsonb, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_submission(
  text, text, uuid, text, text, jsonb, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resubmit_submission(
  uuid, uuid, text, jsonb, text
) TO authenticated, service_role;

COMMIT;
