-- Clean CONNECT-Daet.ai schema, migration 6.
-- All callable mutations derive identity from private.current_user_id(), revalidate live scope,
-- serialize workflow decisions/responses on the submission row, and write
-- required history in the same transaction. Function bodies use no dynamic SQL.
--
-- Authorization overlap for role/membership revocation remains a Stage 5
-- technical dependency. These operations check current authority, but this
-- migration does not invent a separate grant/membership locking protocol.

BEGIN;

CREATE TYPE public.idempotency_claim AS (
  key_id uuid,
  replay boolean,
  result_id uuid
);

CREATE FUNCTION public.claim_workflow_idempotency(
  p_actor_profile_id uuid,
  p_operation_key text,
  p_resource_id uuid,
  p_idempotency_key text,
  p_request jsonb
)
RETURNS public.idempotency_claim
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $claim_workflow_idempotency$
DECLARE
  v_id uuid;
  v_fingerprint bytea;
  v_result_id uuid;
  v_claim public.idempotency_claim;
BEGIN
  IF p_actor_profile_id IS NULL OR p_actor_profile_id <> private.current_user_id()
    OR nullif(btrim(p_operation_key), '') IS NULL
    OR nullif(btrim(p_idempotency_key), '') IS NULL
    OR p_request IS NULL
  THEN
    RAISE EXCEPTION 'Invalid workflow request';
  END IF;

  v_fingerprint := extensions.digest(
    pg_catalog.convert_to(p_request::text, 'UTF8'),
    'sha256'
  );

  INSERT INTO public.idempotency_keys (
    actor_profile_id, operation_key, resource_id, idempotency_key, request_fingerprint
  )
  VALUES (
    p_actor_profile_id, p_operation_key, p_resource_id, p_idempotency_key, v_fingerprint
  )
  ON CONFLICT DO NOTHING;

  SELECT ik.id, ik.request_fingerprint, ik.result_id
    INTO v_id, v_fingerprint, v_result_id
  FROM public.idempotency_keys AS ik
  WHERE ik.actor_profile_id = p_actor_profile_id
    AND ik.operation_key = p_operation_key
    AND ik.resource_id IS NOT DISTINCT FROM p_resource_id
    AND ik.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unable to claim workflow request';
  END IF;

  IF v_fingerprint IS DISTINCT FROM extensions.digest(
    pg_catalog.convert_to(p_request::text, 'UTF8'),
    'sha256'
  ) THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different request';
  END IF;

  v_claim.key_id := v_id;
  v_claim.replay := v_result_id IS NOT NULL;
  v_claim.result_id := v_result_id;
  RETURN v_claim;
END;
$claim_workflow_idempotency$;

CREATE FUNCTION public.complete_workflow_idempotency(
  p_key_id uuid,
  p_result_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $complete_workflow_idempotency$
BEGIN
  UPDATE public.idempotency_keys
  SET result_id = p_result_id,
      completed_at = now()
  WHERE id = p_key_id
    AND actor_profile_id = private.current_user_id()
    AND result_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unable to complete workflow request';
  END IF;
END;
$complete_workflow_idempotency$;

CREATE FUNCTION public.require_active_workflow_grant(p_role public.workflow_role)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $require_active_workflow_grant$
DECLARE
  v_grant_id uuid;
BEGIN
  SELECT rg.id
    INTO v_grant_id
  FROM public.role_grants AS rg
  WHERE rg.profile_id = private.current_user_id()
    AND rg.role = p_role
    AND rg.revoked_at IS NULL
  ORDER BY rg.granted_at DESC
  LIMIT 1;

  IF v_grant_id IS NULL THEN
    RAISE EXCEPTION 'The requested workflow action is not authorized';
  END IF;

  RETURN v_grant_id;
END;
$require_active_workflow_grant$;

CREATE FUNCTION public.create_submission(
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

CREATE FUNCTION public.resubmit_submission(
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

CREATE FUNCTION public.create_routing_plan(
  p_submission_id uuid,
  p_mode public.routing_mode,
  p_assignments jsonb,
  p_reason text,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $create_routing_plan$
DECLARE
  v_actor uuid := private.current_user_id();
  v_approver_grant_id uuid;
  v_state public.submission_state;
  v_current_version_id uuid;
  v_last_mode public.routing_mode;
  v_last_round_number integer;
  v_round_id uuid;
  v_assignment_id uuid;
  v_responsibility_id uuid;
  v_revision_id uuid;
  v_cycle_id uuid;
  v_office_id uuid;
  v_assignment jsonb;
  v_responsibility jsonb;
  v_responsibilities jsonb;
  v_assignments jsonb := p_assignments;
  v_type public.responsibility_type;
  v_scope text;
  v_cycle_number integer;
  v_count integer;
  v_claim public.idempotency_claim;
BEGIN
  v_approver_grant_id := public.require_active_workflow_grant('approver');
  IF jsonb_typeof(v_assignments) <> 'array' OR jsonb_array_length(v_assignments) = 0 THEN
    RAISE EXCEPTION 'A routing plan requires manually selected offices';
  END IF;
  IF p_mode = 'one_at_a_time' AND jsonb_array_length(v_assignments) <> 1 THEN
    RAISE EXCEPTION 'One-at-a-time routing accepts one office per explicit action';
  END IF;

  v_claim := public.claim_workflow_idempotency(
    v_actor, 'create_routing_plan', p_submission_id, p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'mode', p_mode,
      'assignments', v_assignments,
      'reason', p_reason
    )
  );
  IF v_claim.replay THEN
    RETURN v_claim.result_id;
  END IF;

  SELECT s.state, s.current_version_id
    INTO v_state, v_current_version_id
  FROM public.submissions AS s
  WHERE s.id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND OR v_state NOT IN ('initial_review', 'office_review')
    OR v_current_version_id IS NULL
  THEN
    RAISE EXCEPTION 'Submission is not eligible for office routing';
  END IF;

  SELECT rr.mode, rr.round_number
    INTO v_last_mode, v_last_round_number
  FROM public.routing_rounds AS rr
  WHERE rr.submission_id = p_submission_id
  ORDER BY rr.round_number DESC
  LIMIT 1;

  IF v_state = 'office_review' THEN
    IF v_last_round_number IS NULL OR v_last_mode IS DISTINCT FROM p_mode THEN
      RAISE EXCEPTION 'Routing mode cannot be inferred or changed during a route';
    END IF;

    IF p_mode = 'simultaneous' THEN
      NULL;
    ELSIF EXISTS (
      SELECT 1
      FROM public.office_assignments AS oa
      JOIN public.routing_rounds AS rr
        ON rr.submission_id = oa.submission_id AND rr.id = oa.routing_round_id
      JOIN public.office_responsibilities AS r
        ON r.submission_id = oa.submission_id AND r.assignment_id = oa.id
      JOIN public.review_cycles AS rc
        ON rc.submission_id = r.submission_id AND rc.responsibility_id = r.id
      LEFT JOIN public.review_responses AS response
        ON response.review_cycle_id = rc.id
      LEFT JOIN public.tourism_officer_response_reviews AS review
        ON review.submission_id = response.submission_id
        AND review.review_response_id = response.id
      WHERE rr.submission_id = p_submission_id
        AND rr.round_number = v_last_round_number
        AND oa.cancelled_at IS NULL
        AND (response.id IS NULL OR review.id IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM public.review_cycle_events AS cycle_event
          WHERE cycle_event.submission_id = rc.submission_id
            AND cycle_event.review_cycle_id = rc.id
            AND cycle_event.event_kind = 'cycle_superseded_by_revision'
        )
    ) THEN
      RAISE EXCEPTION 'The previous one-at-a-time office response must be reviewed first';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_assignments) AS entry(value)
    GROUP BY (entry.value ->> 'office_id')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A routing plan cannot repeat an office';
  END IF;

  v_last_round_number := coalesce(v_last_round_number, 0) + 1;
  INSERT INTO public.routing_rounds (
    submission_id, round_number, mode, initiated_by_profile_id,
    initiating_approver_grant_id, reason
  )
  VALUES (
    p_submission_id, v_last_round_number, p_mode, v_actor, v_approver_grant_id, p_reason
  )
  RETURNING id INTO v_round_id;

  FOR v_assignment IN SELECT value FROM pg_catalog.jsonb_array_elements(v_assignments)
  LOOP
    BEGIN
      v_office_id := (v_assignment ->> 'office_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Routing plan contains an invalid office selection';
    END;

    v_responsibilities := v_assignment -> 'responsibilities';
    IF v_office_id IS NULL OR jsonb_typeof(v_responsibilities) <> 'array'
      OR jsonb_array_length(v_responsibilities) = 0
    THEN
      RAISE EXCEPTION 'Each selected office requires explicit responsibilities';
    END IF;

    INSERT INTO public.office_assignments (
      submission_id, routing_round_id, office_id, instructions,
      created_by_profile_id, created_by_approver_grant_id
    )
    VALUES (
      p_submission_id, v_round_id, v_office_id,
      nullif(v_assignment ->> 'instructions', ''),
      v_actor, v_approver_grant_id
    )
    RETURNING id INTO v_assignment_id;

    INSERT INTO public.office_assignment_events (
      submission_id, assignment_id, event_kind, actor_profile_id,
      approver_grant_id, reason, context
    )
    VALUES (
      p_submission_id, v_assignment_id, 'assignment_created',
      v_actor, v_approver_grant_id, p_reason,
      pg_catalog.jsonb_build_object('routing_round_id', v_round_id)
    );

    FOR v_responsibility IN
      SELECT value FROM pg_catalog.jsonb_array_elements(v_responsibilities)
    LOOP
      BEGIN
        v_type := (v_responsibility ->> 'responsibility_type')::public.responsibility_type;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Routing plan contains an invalid responsibility type';
      END;

      v_scope := nullif(btrim(v_responsibility ->> 'scope'), '');
      IF v_scope IS NULL THEN
        RAISE EXCEPTION 'Each responsibility requires an explicit scope';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.office_responsibility_authorities AS authority
        WHERE authority.office_id = v_office_id
          AND authority.responsibility_type = v_type
          AND authority.revoked_at IS NULL
      ) THEN
        RAISE EXCEPTION 'The selected office responsibility authority is not approved';
      END IF;

      INSERT INTO public.office_responsibilities (
        submission_id, assignment_id, responsibility_key,
        created_by_profile_id, created_by_approver_grant_id
      )
      VALUES (
        p_submission_id, v_assignment_id,
        nullif(v_responsibility ->> 'responsibility_key', ''),
        v_actor, v_approver_grant_id
      )
      RETURNING id INTO v_responsibility_id;

      INSERT INTO public.office_responsibility_revisions (
        submission_id, assignment_id, responsibility_id, revision_number,
        responsibility_type, scope, instructions, actor_profile_id,
        approver_grant_id, reason
      )
      VALUES (
        p_submission_id, v_assignment_id, v_responsibility_id, 1,
        v_type, v_scope, nullif(v_responsibility ->> 'instructions', ''),
        v_actor, v_approver_grant_id, p_reason
      )
      RETURNING id INTO v_revision_id;

      INSERT INTO public.office_responsibility_events (
        submission_id, assignment_id, responsibility_id,
        responsibility_revision_id, event_kind, actor_profile_id,
        approver_grant_id, reason
      )
      VALUES (
        p_submission_id, v_assignment_id, v_responsibility_id,
        v_revision_id, 'responsibility_created', v_actor,
        v_approver_grant_id, p_reason
      );

      INSERT INTO public.review_cycles (
        submission_id, assignment_id, office_id, responsibility_id,
        submission_version_id, responsibility_revision_id, cycle_number,
        created_by_profile_id, created_by_approver_grant_id
      )
      VALUES (
        p_submission_id, v_assignment_id, v_office_id, v_responsibility_id,
        v_current_version_id, v_revision_id, 1, v_actor, v_approver_grant_id
      )
      RETURNING id INTO v_cycle_id;

      INSERT INTO public.review_cycle_events (
        submission_id, review_cycle_id, event_kind, actor_profile_id,
        role_grant_id, reason
      )
      VALUES (
        p_submission_id, v_cycle_id, 'cycle_opened', v_actor,
        v_approver_grant_id, p_reason
      );
    END LOOP;
  END LOOP;

  IF v_state <> 'office_review' THEN
    UPDATE public.submissions
    SET state = 'office_review', updated_at = now()
    WHERE id = p_submission_id;

    INSERT INTO public.submission_status_history (
      submission_id, previous_state, new_state, actor_profile_id,
      role_grant_id, cause_code, reason
    )
    VALUES (
      p_submission_id, v_state, 'office_review', v_actor,
      v_approver_grant_id, 'manual_office_routing', p_reason
    );
  END IF;

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, submission_id, event_kind,
    correlation_id, idempotency_key_id, details
  )
  VALUES (
    v_actor, v_approver_grant_id, p_submission_id, 'routing_plan_created',
    v_round_id, v_claim.key_id,
    pg_catalog.jsonb_build_object('routing_round_id', v_round_id, 'mode', p_mode)
  );

  PERFORM public.complete_workflow_idempotency(v_claim.key_id, v_round_id);
  RETURN v_round_id;
END;
$create_routing_plan$;

CREATE FUNCTION public.revise_office_responsibility(
  p_submission_id uuid,
  p_responsibility_id uuid,
  p_expected_revision_id uuid,
  p_responsibility_type public.responsibility_type,
  p_scope text,
  p_instructions text,
  p_reason text,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $revise_office_responsibility$
DECLARE
  v_actor uuid := private.current_user_id();
  v_approver_grant_id uuid;
  v_state public.submission_state;
  v_current_version_id uuid;
  v_assignment_id uuid;
  v_office_id uuid;
  v_current_revision_id uuid;
  v_current_type public.responsibility_type;
  v_current_scope text;
  v_current_instructions text;
  v_new_scope text := nullif(btrim(p_scope), '');
  v_next_revision_number integer;
  v_revision_id uuid;
  v_claim public.idempotency_claim;
BEGIN
  v_approver_grant_id := public.require_active_workflow_grant('approver');
  IF p_responsibility_type IS NULL OR v_new_scope IS NULL
    OR nullif(btrim(p_reason), '') IS NULL
  THEN
    RAISE EXCEPTION 'Responsibility revision requires scope and reason';
  END IF;

  v_claim := public.claim_workflow_idempotency(
    v_actor, 'revise_office_responsibility', p_responsibility_id, p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'submission_id', p_submission_id,
      'expected_revision_id', p_expected_revision_id,
      'responsibility_type', p_responsibility_type,
      'scope', p_scope,
      'instructions', p_instructions,
      'reason', p_reason
    )
  );
  IF v_claim.replay THEN
    RETURN v_claim.result_id;
  END IF;

  SELECT submission.state, submission.current_version_id
    INTO v_state, v_current_version_id
  FROM public.submissions AS submission
  WHERE submission.id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND OR v_state NOT IN ('initial_review', 'office_review')
    OR v_current_version_id IS NULL
  THEN
    RAISE EXCEPTION 'Submission is not eligible for responsibility revision';
  END IF;

  SELECT responsibility.assignment_id, assignment.office_id,
    revision.id, revision.responsibility_type, revision.scope, revision.instructions
  INTO v_assignment_id, v_office_id, v_current_revision_id,
    v_current_type, v_current_scope, v_current_instructions
  FROM public.office_responsibilities AS responsibility
  JOIN public.office_assignments AS assignment
    ON assignment.id = responsibility.assignment_id
    AND assignment.submission_id = responsibility.submission_id
  JOIN LATERAL (
    SELECT revision_row.id, revision_row.responsibility_type,
      revision_row.scope, revision_row.instructions
    FROM public.office_responsibility_revisions AS revision_row
    WHERE revision_row.responsibility_id = responsibility.id
    ORDER BY revision_row.revision_number DESC
    LIMIT 1
  ) AS revision ON true
  WHERE responsibility.id = p_responsibility_id
    AND responsibility.submission_id = p_submission_id
    AND assignment.cancelled_at IS NULL
  FOR UPDATE OF responsibility, assignment;

  IF NOT FOUND OR v_current_revision_id IS DISTINCT FROM p_expected_revision_id THEN
    RAISE EXCEPTION 'Responsibility revision is stale or unavailable';
  END IF;

  IF v_current_type = 'mandatory_approval'
    AND p_responsibility_type <> 'mandatory_approval'
  THEN
    RAISE EXCEPTION 'A mandatory responsibility cannot be downgraded';
  END IF;

  IF v_current_type = p_responsibility_type
    AND v_current_scope = v_new_scope
    AND v_current_instructions IS NOT DISTINCT FROM p_instructions
  THEN
    RAISE EXCEPTION 'Responsibility revision contains no changes';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.office_responsibility_authorities AS authority
    WHERE authority.office_id = v_office_id
      AND authority.responsibility_type = p_responsibility_type
      AND authority.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'The selected office responsibility authority is not approved';
  END IF;

  SELECT coalesce(max(revision.revision_number), 0) + 1
    INTO v_next_revision_number
  FROM public.office_responsibility_revisions AS revision
  WHERE revision.responsibility_id = p_responsibility_id;

  INSERT INTO public.office_responsibility_revisions (
    submission_id, assignment_id, responsibility_id, revision_number,
    responsibility_type, scope, instructions, actor_profile_id,
    approver_grant_id, reason
  )
  VALUES (
    p_submission_id, v_assignment_id, p_responsibility_id, v_next_revision_number,
    p_responsibility_type, v_new_scope, p_instructions, v_actor,
    v_approver_grant_id, p_reason
  )
  RETURNING id INTO v_revision_id;

  INSERT INTO public.office_responsibility_events (
    submission_id, assignment_id, responsibility_id,
    responsibility_revision_id, event_kind, actor_profile_id,
    approver_grant_id, reason, context
  )
  VALUES (
    p_submission_id, v_assignment_id, p_responsibility_id, v_revision_id,
    'responsibility_revised', v_actor, v_approver_grant_id, p_reason,
    pg_catalog.jsonb_build_object('previous_revision_id', v_current_revision_id)
  );

  INSERT INTO public.review_cycle_events (
    submission_id, review_cycle_id, event_kind, actor_profile_id,
    role_grant_id, reason, context
  )
  SELECT cycle.submission_id, cycle.id, 'cycle_superseded_by_revision',
    v_actor, v_approver_grant_id, p_reason,
    pg_catalog.jsonb_build_object('new_responsibility_revision_id', v_revision_id)
  FROM public.review_cycles AS cycle
  WHERE cycle.submission_id = p_submission_id
    AND cycle.responsibility_id = p_responsibility_id
    AND cycle.responsibility_revision_id = v_current_revision_id
    AND cycle.submission_version_id = v_current_version_id
    AND NOT EXISTS (
      SELECT 1 FROM public.review_responses AS response
      WHERE response.review_cycle_id = cycle.id
    );

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, submission_id, event_kind,
    correlation_id, idempotency_key_id, details
  )
  VALUES (
    v_actor, v_approver_grant_id, p_submission_id, 'responsibility_revised',
    v_revision_id, v_claim.key_id,
    pg_catalog.jsonb_build_object(
      'responsibility_id', p_responsibility_id,
      'previous_revision_id', v_current_revision_id
    )
  );

  PERFORM public.complete_workflow_idempotency(v_claim.key_id, v_revision_id);
  RETURN v_revision_id;
END;
$revise_office_responsibility$;

CREATE FUNCTION public.submit_office_response(
  p_review_cycle_id uuid,
  p_outcome text,
  p_findings text,
  p_remarks text,
  p_attachment_ids uuid[],
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $submit_office_response$
DECLARE
  v_actor uuid := private.current_user_id();
  v_external_grant_id uuid;
  v_membership_id uuid;
  v_submission_id uuid;
  v_assignment_id uuid;
  v_office_id uuid;
  v_responsibility_id uuid;
  v_version_id uuid;
  v_revision_id uuid;
  v_responsibility_type public.responsibility_type;
  v_submission_state public.submission_state;
  v_response_id uuid;
  v_attachment_id uuid;
  v_claim public.idempotency_claim;
BEGIN
  v_external_grant_id := public.require_active_workflow_grant('external_approver');
  v_claim := public.claim_workflow_idempotency(
    v_actor, 'submit_office_response', p_review_cycle_id, p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'outcome', p_outcome,
      'findings', p_findings,
      'remarks', p_remarks,
      'attachment_ids', coalesce(to_jsonb(p_attachment_ids), '[]'::jsonb)
    )
  );
  IF v_claim.replay THEN
    RETURN v_claim.result_id;
  END IF;

  SELECT rc.submission_id, rc.assignment_id, rc.office_id, rc.responsibility_id,
    rc.submission_version_id, rc.responsibility_revision_id,
    revision.responsibility_type, submission.state
  INTO v_submission_id, v_assignment_id, v_office_id, v_responsibility_id,
    v_version_id, v_revision_id, v_responsibility_type, v_submission_state
  FROM public.review_cycles AS rc
  JOIN public.office_responsibility_revisions AS revision
    ON revision.id = rc.responsibility_revision_id
  JOIN public.submissions AS submission ON submission.id = rc.submission_id
  WHERE rc.id = p_review_cycle_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review cycle is unavailable';
  END IF;

  PERFORM 1 FROM public.submissions AS submission
  WHERE submission.id = v_submission_id
  FOR UPDATE;

  SELECT submission.state
    INTO v_submission_state
  FROM public.submissions AS submission
  WHERE submission.id = v_submission_id;

  IF v_submission_state <> 'office_review'
    OR NOT EXISTS (
      SELECT 1 FROM public.submissions AS submission
      WHERE submission.id = v_submission_id
        AND submission.current_version_id = v_version_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.office_assignments AS assignment
      WHERE assignment.id = v_assignment_id
        AND assignment.cancelled_at IS NULL
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.office_responsibility_revisions AS revision
      WHERE revision.id = v_revision_id
        AND revision.responsibility_id = v_responsibility_id
        AND revision.revision_number = (
          SELECT max(latest.revision_number)
          FROM public.office_responsibility_revisions AS latest
          WHERE latest.responsibility_id = v_responsibility_id
        )
    )
  THEN
    RAISE EXCEPTION 'Review cycle is no longer eligible for a response';
  END IF;

  SELECT membership.id INTO v_membership_id
  FROM public.office_memberships AS membership
  WHERE membership.profile_id = v_actor
    AND membership.office_id = v_office_id
    AND membership.ended_at IS NULL
  ORDER BY membership.started_at DESC
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION 'The requested workflow action is not authorized';
  END IF;

  IF v_responsibility_type = 'mandatory_approval'
    AND p_outcome NOT IN ('approved', 'denied')
  THEN
    RAISE EXCEPTION 'Mandatory responsibility outcome is invalid';
  END IF;
  IF nullif(btrim(p_outcome), '') IS NULL THEN
    RAISE EXCEPTION 'Response outcome is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.review_cycles AS other_cycle
    JOIN public.review_responses AS other_response
      ON other_response.review_cycle_id = other_cycle.id
    WHERE other_cycle.responsibility_id = v_responsibility_id
      AND other_cycle.submission_version_id = v_version_id
      AND other_cycle.responsibility_revision_id = v_revision_id
      AND other_cycle.id <> p_review_cycle_id
  ) OR EXISTS (
    SELECT 1
    FROM public.response_applicability AS applicability
    WHERE applicability.submission_id = v_submission_id
      AND applicability.responsibility_id = v_responsibility_id
      AND applicability.target_submission_version_id = v_version_id
      AND applicability.target_responsibility_revision_id = v_revision_id
      AND NOT EXISTS (
        SELECT 1 FROM public.response_applicability_events AS event
        WHERE event.submission_id = applicability.submission_id
          AND event.applicability_id = applicability.id
      )
  ) OR EXISTS (
    SELECT 1 FROM public.responsibility_resolutions AS resolution
    WHERE resolution.submission_id = v_submission_id
      AND resolution.responsibility_id = v_responsibility_id
      AND resolution.submission_version_id = v_version_id
      AND resolution.responsibility_revision_id = v_revision_id
  ) THEN
    RAISE EXCEPTION 'A different effective basis already exists for this responsibility target';
  END IF;

  INSERT INTO public.review_responses (
    submission_id, review_cycle_id, assignment_id, office_id, responsibility_id,
    submission_version_id, responsibility_revision_id, submitted_by_profile_id,
    office_membership_id, external_approver_grant_id, outcome, findings, remarks
  )
  VALUES (
    v_submission_id, p_review_cycle_id, v_assignment_id, v_office_id, v_responsibility_id,
    v_version_id, v_revision_id, v_actor, v_membership_id, v_external_grant_id,
    p_outcome, p_findings, p_remarks
  )
  RETURNING id INTO v_response_id;

  FOREACH v_attachment_id IN ARRAY coalesce(p_attachment_ids, ARRAY[]::uuid[])
  LOOP
    INSERT INTO public.review_response_attachments (
      submission_id, review_response_id, attachment_id
    )
    VALUES (v_submission_id, v_response_id, v_attachment_id);
  END LOOP;

  INSERT INTO public.review_cycle_events (
    submission_id, review_cycle_id, event_kind, actor_profile_id,
    role_grant_id, office_membership_id
  )
  VALUES (
    v_submission_id, p_review_cycle_id, 'response_received', v_actor,
    v_external_grant_id, v_membership_id
  );

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, office_membership_id, submission_id,
    event_kind, correlation_id, idempotency_key_id, details
  )
  VALUES (
    v_actor, v_external_grant_id, v_membership_id, v_submission_id,
    'office_response_submitted', v_response_id, v_claim.key_id,
    pg_catalog.jsonb_build_object('review_cycle_id', p_review_cycle_id)
  );

  PERFORM public.complete_workflow_idempotency(v_claim.key_id, v_response_id);
  RETURN v_response_id;
END;
$submit_office_response$;

CREATE FUNCTION public.record_officer_response_review(
  p_review_response_id uuid,
  p_disposition text,
  p_reason text,
  p_notes text,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $record_officer_response_review$
DECLARE
  v_actor uuid := private.current_user_id();
  v_approver_grant_id uuid;
  v_submission_id uuid;
  v_cycle_id uuid;
  v_review_id uuid;
  v_claim public.idempotency_claim;
BEGIN
  v_approver_grant_id := public.require_active_workflow_grant('approver');
  v_claim := public.claim_workflow_idempotency(
    v_actor, 'record_officer_response_review', p_review_response_id,
    p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'disposition', p_disposition, 'reason', p_reason, 'notes', p_notes
    )
  );
  IF v_claim.replay THEN
    RETURN v_claim.result_id;
  END IF;

  SELECT rr.submission_id, rr.review_cycle_id
    INTO v_submission_id, v_cycle_id
  FROM public.review_responses AS rr
  WHERE rr.id = p_review_response_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review response is unavailable';
  END IF;

  PERFORM 1 FROM public.submissions AS submission
  WHERE submission.id = v_submission_id
  FOR UPDATE;

  IF nullif(btrim(p_disposition), '') IS NULL THEN
    RAISE EXCEPTION 'Response review disposition is required';
  END IF;

  INSERT INTO public.tourism_officer_response_reviews (
    submission_id, review_response_id, actor_profile_id, approver_grant_id,
    disposition, reason, notes
  )
  VALUES (
    v_submission_id, p_review_response_id, v_actor, v_approver_grant_id,
    p_disposition, p_reason, p_notes
  )
  RETURNING id INTO v_review_id;

  INSERT INTO public.review_cycle_events (
    submission_id, review_cycle_id, event_kind, actor_profile_id,
    role_grant_id, reason, context
  )
  VALUES (
    v_submission_id, v_cycle_id, 'officer_response_reviewed', v_actor,
    v_approver_grant_id, p_reason,
    pg_catalog.jsonb_build_object('review_id', v_review_id, 'disposition', p_disposition)
  );

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, submission_id, event_kind,
    correlation_id, idempotency_key_id,
    details
  )
  VALUES (
    v_actor, v_approver_grant_id, v_submission_id,
    'office_response_reviewed', v_review_id, v_claim.key_id,
    pg_catalog.jsonb_build_object('response_id', p_review_response_id)
  );

  PERFORM public.complete_workflow_idempotency(v_claim.key_id, v_review_id);
  RETURN v_review_id;
END;
$record_officer_response_review$;

CREATE FUNCTION public.start_responsibility_reassessment(
  p_submission_id uuid,
  p_target_version_id uuid,
  p_responsibility_ids uuid[],
  p_applicability jsonb,
  p_reason text,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $start_responsibility_reassessment$
DECLARE
  v_actor uuid := private.current_user_id();
  v_approver_grant_id uuid;
  v_state public.submission_state;
  v_current_version_id uuid;
  v_responsibility_id uuid;
  v_assignment_id uuid;
  v_office_id uuid;
  v_revision_id uuid;
  v_cycle_id uuid;
  v_next_cycle_number integer;
  v_created_cycles uuid[] := ARRAY[]::uuid[];
  v_applicability_ids uuid[] := ARRAY[]::uuid[];
  v_applicability_entry jsonb;
  v_original_response_id uuid;
  v_source_outcome text;
  v_source_type public.responsibility_type;
  v_target_type public.responsibility_type;
  v_applicability_id uuid;
  v_applicability jsonb := coalesce(p_applicability, '[]'::jsonb);
  v_claim public.idempotency_claim;
BEGIN
  v_approver_grant_id := public.require_active_workflow_grant('approver');
  IF coalesce(cardinality(p_responsibility_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Reassessment requires an explicit responsibility selection';
  END IF;
  IF jsonb_typeof(v_applicability) <> 'array'
    OR nullif(btrim(p_reason), '') IS NULL
  THEN
    RAISE EXCEPTION 'Reassessment requires valid applicability data and a reason';
  END IF;
  IF cardinality(p_responsibility_ids) <> (
    SELECT count(DISTINCT selected.selected_id)
    FROM unnest(p_responsibility_ids) AS selected(selected_id)
  ) THEN
    RAISE EXCEPTION 'Reassessment cannot repeat a responsibility';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_applicability) AS entry(value)
    GROUP BY entry.value ->> 'original_response_id'
    HAVING nullif(entry.value ->> 'original_response_id', '') IS NULL
      OR count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Applicability selection contains a missing or repeated response';
  END IF;

  v_claim := public.claim_workflow_idempotency(
    v_actor, 'start_responsibility_reassessment', p_submission_id, p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'target_version_id', p_target_version_id,
      'responsibility_ids', to_jsonb(p_responsibility_ids),
      'applicability', v_applicability,
      'reason', p_reason
    )
  );
  IF v_claim.replay THEN
    RETURN v_claim.result_id;
  END IF;

  SELECT s.state, s.current_version_id
    INTO v_state, v_current_version_id
  FROM public.submissions AS s
  WHERE s.id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND OR v_state NOT IN ('initial_review', 'office_review')
    OR v_current_version_id IS DISTINCT FROM p_target_version_id
  THEN
    RAISE EXCEPTION 'Submission is not eligible for reassessment';
  END IF;

  IF v_state = 'initial_review' THEN
    UPDATE public.submissions
    SET state = 'office_review', updated_at = now()
    WHERE id = p_submission_id;

    INSERT INTO public.submission_status_history (
      submission_id, previous_state, new_state, actor_profile_id,
      role_grant_id, cause_code, reason
    )
    VALUES (
      p_submission_id, 'initial_review', 'office_review', v_actor,
      v_approver_grant_id, 'responsibility_reassessment_started', p_reason
    );
  END IF;

  FOREACH v_responsibility_id IN ARRAY p_responsibility_ids
  LOOP
    SELECT r.assignment_id, assignment.office_id, revision.id
      INTO v_assignment_id, v_office_id, v_revision_id
    FROM public.office_responsibilities AS r
    JOIN public.office_assignments AS assignment
      ON assignment.id = r.assignment_id AND assignment.submission_id = r.submission_id
    JOIN LATERAL (
      SELECT revision_row.id
      FROM public.office_responsibility_revisions AS revision_row
      WHERE revision_row.responsibility_id = r.id
      ORDER BY revision_row.revision_number DESC
      LIMIT 1
    ) AS revision ON true
    WHERE r.id = v_responsibility_id
      AND r.submission_id = p_submission_id
      AND assignment.cancelled_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected responsibility is unavailable';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.review_cycles AS cycle
      WHERE cycle.responsibility_id = v_responsibility_id
        AND cycle.submission_version_id = p_target_version_id
        AND cycle.responsibility_revision_id = v_revision_id
    ) THEN
      RAISE EXCEPTION 'A cycle already exists for a selected target';
    END IF;

    SELECT coalesce(max(cycle.cycle_number), 0) + 1
      INTO v_next_cycle_number
    FROM public.review_cycles AS cycle
    WHERE cycle.responsibility_id = v_responsibility_id;

    INSERT INTO public.review_cycles (
      submission_id, assignment_id, office_id, responsibility_id,
      submission_version_id, responsibility_revision_id, cycle_number,
      created_by_profile_id, created_by_approver_grant_id
    )
    VALUES (
      p_submission_id, v_assignment_id, v_office_id, v_responsibility_id,
      p_target_version_id, v_revision_id, v_next_cycle_number,
      v_actor, v_approver_grant_id
    )
    RETURNING id INTO v_cycle_id;

    INSERT INTO public.review_cycle_events (
      submission_id, review_cycle_id, event_kind, actor_profile_id,
      role_grant_id, reason
    )
    VALUES (
      p_submission_id, v_cycle_id, 'reassessment_cycle_opened', v_actor,
      v_approver_grant_id, p_reason
    );

    INSERT INTO public.office_responsibility_events (
      submission_id, assignment_id, responsibility_id,
      responsibility_revision_id, event_kind, actor_profile_id,
      approver_grant_id, reason, context
    )
    VALUES (
      p_submission_id, v_assignment_id, v_responsibility_id, v_revision_id,
      'reassessment_initiated', v_actor, v_approver_grant_id, p_reason,
      pg_catalog.jsonb_build_object(
        'target_submission_version_id', p_target_version_id,
        'review_cycle_id', v_cycle_id
      )
    );

    v_created_cycles := pg_catalog.array_append(v_created_cycles, v_cycle_id);
  END LOOP;

  FOR v_applicability_entry IN
    SELECT value FROM pg_catalog.jsonb_array_elements(v_applicability)
  LOOP
    BEGIN
      v_original_response_id :=
        (v_applicability_entry ->> 'original_response_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Applicability selection contains an invalid response ID';
    END;

    IF nullif(btrim(v_applicability_entry ->> 'reason'), '') IS NULL THEN
      RAISE EXCEPTION 'Each applicability confirmation requires a reason';
    END IF;

    SELECT response.responsibility_id, response.outcome,
      source_revision.responsibility_type
    INTO v_responsibility_id, v_source_outcome, v_source_type
    FROM public.review_responses AS response
    JOIN public.office_responsibility_revisions AS source_revision
      ON source_revision.id = response.responsibility_revision_id
    WHERE response.id = v_original_response_id
      AND response.submission_id = p_submission_id;

    IF NOT FOUND OR v_responsibility_id = ANY(p_responsibility_ids) THEN
      RAISE EXCEPTION 'Applicability response is unavailable or selected for reassessment';
    END IF;

    SELECT latest_revision.id, latest_revision.responsibility_type
      INTO v_revision_id, v_target_type
    FROM public.office_responsibilities AS responsibility
    JOIN public.office_assignments AS assignment
      ON assignment.id = responsibility.assignment_id
      AND assignment.submission_id = responsibility.submission_id
    JOIN LATERAL (
      SELECT revision.id, revision.responsibility_type
      FROM public.office_responsibility_revisions AS revision
      WHERE revision.responsibility_id = responsibility.id
      ORDER BY revision.revision_number DESC
      LIMIT 1
    ) AS latest_revision ON true
    WHERE responsibility.id = v_responsibility_id
      AND responsibility.submission_id = p_submission_id
      AND assignment.cancelled_at IS NULL;

    IF NOT FOUND OR v_source_type IS DISTINCT FROM v_target_type THEN
      RAISE EXCEPTION 'Applicability target is unavailable or has a different responsibility type';
    END IF;
    IF v_target_type = 'mandatory_approval' AND v_source_outcome <> 'approved' THEN
      RAISE EXCEPTION 'A denied mandatory response cannot be reused';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.review_cycles AS cycle
      WHERE cycle.submission_id = p_submission_id
        AND cycle.responsibility_id = v_responsibility_id
        AND cycle.submission_version_id = p_target_version_id
        AND cycle.responsibility_revision_id = v_revision_id
    ) OR EXISTS (
      SELECT 1 FROM public.response_applicability AS applicability
      WHERE applicability.submission_id = p_submission_id
        AND applicability.responsibility_id = v_responsibility_id
        AND applicability.target_submission_version_id = p_target_version_id
        AND applicability.target_responsibility_revision_id = v_revision_id
        AND NOT EXISTS (
          SELECT 1 FROM public.response_applicability_events AS event
          WHERE event.submission_id = applicability.submission_id
            AND event.applicability_id = applicability.id
        )
    ) OR EXISTS (
      SELECT 1 FROM public.responsibility_resolutions AS resolution
      WHERE resolution.submission_id = p_submission_id
        AND resolution.responsibility_id = v_responsibility_id
        AND resolution.submission_version_id = p_target_version_id
        AND resolution.responsibility_revision_id = v_revision_id
    ) THEN
      RAISE EXCEPTION 'Applicability target already has an effective review basis';
    END IF;

    INSERT INTO public.response_applicability (
      submission_id, responsibility_id, original_response_id,
      target_submission_version_id, target_responsibility_revision_id,
      confirming_profile_id, approver_grant_id, reason
    )
    VALUES (
      p_submission_id, v_responsibility_id, v_original_response_id,
      p_target_version_id, v_revision_id, v_actor, v_approver_grant_id,
      v_applicability_entry ->> 'reason'
    )
    RETURNING id INTO v_applicability_id;

    v_applicability_ids :=
      pg_catalog.array_append(v_applicability_ids, v_applicability_id);
  END LOOP;

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, submission_id, event_kind,
    correlation_id, idempotency_key_id, details
  )
  VALUES (
    v_actor, v_approver_grant_id, p_submission_id, 'reassessment_initiated',
    p_submission_id, v_claim.key_id,
    pg_catalog.jsonb_build_object(
      'target_version_id', p_target_version_id,
      'review_cycle_ids', to_jsonb(v_created_cycles),
      'applicability_ids', to_jsonb(v_applicability_ids)
    )
  );

  PERFORM public.complete_workflow_idempotency(v_claim.key_id, p_submission_id);
  RETURN p_submission_id;
END;
$start_responsibility_reassessment$;

CREATE FUNCTION public.confirm_response_applicability(
  p_original_response_id uuid,
  p_target_version_id uuid,
  p_reason text,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $confirm_response_applicability$
DECLARE
  v_actor uuid := private.current_user_id();
  v_approver_grant_id uuid;
  v_submission_id uuid;
  v_responsibility_id uuid;
  v_type public.responsibility_type;
  v_revision_id uuid;
  v_target_type public.responsibility_type;
  v_source_outcome text;
  v_applicability_id uuid;
  v_claim public.idempotency_claim;
BEGIN
  v_approver_grant_id := public.require_active_workflow_grant('approver');
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Applicability confirmation requires a reason';
  END IF;

  v_claim := public.claim_workflow_idempotency(
    v_actor, 'confirm_response_applicability', p_original_response_id,
    p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'target_version_id', p_target_version_id, 'reason', p_reason
    )
  );
  IF v_claim.replay THEN
    RETURN v_claim.result_id;
  END IF;

  SELECT response.submission_id, response.responsibility_id,
    response.outcome, revision.responsibility_type
  INTO v_submission_id, v_responsibility_id, v_source_outcome, v_type
  FROM public.review_responses AS response
  JOIN public.office_responsibility_revisions AS revision
    ON revision.id = response.responsibility_revision_id
  WHERE response.id = p_original_response_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source response is unavailable';
  END IF;

  PERFORM 1 FROM public.submissions AS submission
  WHERE submission.id = v_submission_id
  FOR UPDATE;

  SELECT revision.id, revision.responsibility_type
    INTO v_revision_id, v_target_type
  FROM public.office_responsibility_revisions AS revision
  WHERE revision.responsibility_id = v_responsibility_id
  ORDER BY revision.revision_number DESC
  LIMIT 1;

  IF NOT EXISTS (
    SELECT 1 FROM public.submissions AS submission
    WHERE submission.id = v_submission_id
      AND submission.current_version_id = p_target_version_id
  ) OR v_revision_id IS NULL THEN
    RAISE EXCEPTION 'Applicability target is not current';
  END IF;

  IF v_type IS DISTINCT FROM v_target_type THEN
    RAISE EXCEPTION 'Applicability cannot change responsibility type';
  END IF;

  IF v_type = 'mandatory_approval' AND v_source_outcome <> 'approved' THEN
    RAISE EXCEPTION 'A denied mandatory response cannot be reused';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.review_cycles AS cycle
    WHERE cycle.responsibility_id = v_responsibility_id
      AND cycle.submission_version_id = p_target_version_id
      AND cycle.responsibility_revision_id = v_revision_id
  ) OR EXISTS (
    SELECT 1 FROM public.response_applicability AS applicability
    WHERE applicability.submission_id = v_submission_id
      AND applicability.responsibility_id = v_responsibility_id
      AND applicability.target_submission_version_id = p_target_version_id
      AND applicability.target_responsibility_revision_id = v_revision_id
      AND NOT EXISTS (
        SELECT 1 FROM public.response_applicability_events AS event
        WHERE event.submission_id = applicability.submission_id
          AND event.applicability_id = applicability.id
      )
  ) OR EXISTS (
    SELECT 1 FROM public.responsibility_resolutions AS resolution
    WHERE resolution.submission_id = v_submission_id
      AND resolution.responsibility_id = v_responsibility_id
      AND resolution.submission_version_id = p_target_version_id
      AND resolution.responsibility_revision_id = v_revision_id
  ) THEN
    RAISE EXCEPTION 'A different effective basis already exists for this target';
  END IF;

  INSERT INTO public.response_applicability (
    submission_id, responsibility_id, original_response_id,
    target_submission_version_id, target_responsibility_revision_id,
    confirming_profile_id, approver_grant_id, reason
  )
  VALUES (
    v_submission_id, v_responsibility_id, p_original_response_id,
    p_target_version_id, v_revision_id, v_actor, v_approver_grant_id, p_reason
  )
  RETURNING id INTO v_applicability_id;

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, submission_id, event_kind,
    correlation_id, idempotency_key_id, details
  )
  VALUES (
    v_actor, v_approver_grant_id, v_submission_id, 'response_applicability_confirmed',
    v_applicability_id, v_claim.key_id,
    pg_catalog.jsonb_build_object(
      'original_response_id', p_original_response_id,
      'target_version_id', p_target_version_id,
      'target_responsibility_revision_id', v_revision_id
    )
  );

  PERFORM public.complete_workflow_idempotency(v_claim.key_id, v_applicability_id);
  RETURN v_applicability_id;
END;
$confirm_response_applicability$;

CREATE FUNCTION public.record_overall_decision(
  p_submission_id uuid,
  p_expected_version_id uuid,
  p_stage public.decision_stage,
  p_decision public.overall_decision_kind,
  p_reason text,
  p_correction_instructions text,
  p_evidence_links jsonb,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $record_overall_decision$
DECLARE
  v_actor uuid := private.current_user_id();
  v_approver_grant_id uuid;
  v_state public.submission_state;
  v_current_version_id uuid;
  v_new_state public.submission_state;
  v_decision_id uuid;
  v_basis_count integer;
  v_effective_outcome text;
  v_responsibility record;
  v_evidence jsonb := coalesce(p_evidence_links, '{}'::jsonb);
  v_evidence_item text;
  v_evidence_id uuid;
  v_claim public.idempotency_claim;
BEGIN
  v_approver_grant_id := public.require_active_workflow_grant('approver');
  IF jsonb_typeof(v_evidence) <> 'object'
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(v_evidence) AS evidence_key(key_name)
      WHERE evidence_key.key_name NOT IN (
        'attachments', 'responses', 'officer_reviews', 'applicability'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(v_evidence) AS evidence_entry(key_name, value)
      WHERE jsonb_typeof(evidence_entry.value) IS DISTINCT FROM 'array'
    )
  THEN
    RAISE EXCEPTION 'Decision evidence must use the approved typed link fields';
  END IF;

  v_claim := public.claim_workflow_idempotency(
    v_actor, 'record_overall_decision', p_submission_id, p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'expected_version_id', p_expected_version_id,
      'stage', p_stage,
      'decision', p_decision,
      'reason', p_reason,
      'correction_instructions', p_correction_instructions,
      'evidence_links', v_evidence
    )
  );
  IF v_claim.replay THEN
    RETURN v_claim.result_id;
  END IF;

  SELECT s.state, s.current_version_id
    INTO v_state, v_current_version_id
  FROM public.submissions AS s
  WHERE s.id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND OR v_current_version_id IS DISTINCT FROM p_expected_version_id THEN
    RAISE EXCEPTION 'Submission state or version is stale';
  END IF;

  IF p_stage = 'initial_review' THEN
    IF v_state <> 'initial_review' OR p_decision = 'approved' THEN
      RAISE EXCEPTION 'Invalid initial-review decision';
    END IF;
  ELSIF p_stage = 'final_review' THEN
    IF v_state NOT IN ('initial_review', 'office_review') THEN
      RAISE EXCEPTION 'Submission is not eligible for final review';
    END IF;
  END IF;

  IF p_decision <> 'approved' AND nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for return or rejection';
  END IF;
  IF p_decision = 'returned'
    AND nullif(btrim(p_correction_instructions), '') IS NULL
  THEN
    RAISE EXCEPTION 'Correction instructions are required for a return';
  END IF;

  IF p_stage = 'final_review' AND p_decision = 'approved' THEN
    FOR v_responsibility IN
      SELECT responsibility.id AS responsibility_id,
        responsibility.assignment_id,
        latest_revision.id AS revision_id,
        latest_revision.responsibility_type
      FROM public.office_responsibilities AS responsibility
      JOIN public.office_assignments AS assignment
        ON assignment.id = responsibility.assignment_id
        AND assignment.submission_id = responsibility.submission_id
      JOIN LATERAL (
        SELECT revision.id, revision.responsibility_type
        FROM public.office_responsibility_revisions AS revision
        WHERE revision.responsibility_id = responsibility.id
        ORDER BY revision.revision_number DESC
        LIMIT 1
      ) AS latest_revision ON true
      WHERE responsibility.submission_id = p_submission_id
        AND assignment.cancelled_at IS NULL
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.responsibility_resolutions AS resolution
        WHERE resolution.submission_id = p_submission_id
          AND resolution.responsibility_id = v_responsibility.responsibility_id
          AND resolution.responsibility_revision_id = v_responsibility.revision_id
          AND resolution.submission_version_id = v_current_version_id
      ) THEN
        RAISE EXCEPTION 'Unapproved responsibility resolutions cannot satisfy final review';
      END IF;

      SELECT count(*), min(effective_basis.outcome)
        INTO v_basis_count, v_effective_outcome
      FROM (
        SELECT response.outcome
        FROM public.review_cycles AS cycle
        JOIN public.review_responses AS response ON response.review_cycle_id = cycle.id
        WHERE cycle.submission_id = p_submission_id
          AND cycle.responsibility_id = v_responsibility.responsibility_id
          AND cycle.submission_version_id = v_current_version_id
          AND cycle.responsibility_revision_id = v_responsibility.revision_id
        UNION ALL
        SELECT original_response.outcome
        FROM public.response_applicability AS applicability
        JOIN public.review_responses AS original_response
          ON original_response.submission_id = applicability.submission_id
          AND original_response.id = applicability.original_response_id
        WHERE applicability.submission_id = p_submission_id
          AND applicability.responsibility_id = v_responsibility.responsibility_id
          AND applicability.target_submission_version_id = v_current_version_id
          AND applicability.target_responsibility_revision_id = v_responsibility.revision_id
          AND NOT EXISTS (
            SELECT 1 FROM public.response_applicability_events AS event
            WHERE event.submission_id = applicability.submission_id
              AND event.applicability_id = applicability.id
          )
      ) AS effective_basis;

      IF v_basis_count <> 1 THEN
        RAISE EXCEPTION 'Every active responsibility requires exactly one effective response';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM (
          SELECT response.id AS response_id
          FROM public.review_cycles AS cycle
          JOIN public.review_responses AS response
            ON response.review_cycle_id = cycle.id
          WHERE cycle.submission_id = p_submission_id
            AND cycle.responsibility_id = v_responsibility.responsibility_id
            AND cycle.submission_version_id = v_current_version_id
            AND cycle.responsibility_revision_id = v_responsibility.revision_id
          UNION ALL
          SELECT original_response.id AS response_id
          FROM public.response_applicability AS applicability
          JOIN public.review_responses AS original_response
            ON original_response.submission_id = applicability.submission_id
            AND original_response.id = applicability.original_response_id
          WHERE applicability.submission_id = p_submission_id
            AND applicability.responsibility_id = v_responsibility.responsibility_id
            AND applicability.target_submission_version_id = v_current_version_id
            AND applicability.target_responsibility_revision_id = v_responsibility.revision_id
            AND NOT EXISTS (
              SELECT 1 FROM public.response_applicability_events AS event
              WHERE event.submission_id = applicability.submission_id
                AND event.applicability_id = applicability.id
            )
        ) AS effective_response
        JOIN public.tourism_officer_response_reviews AS officer_review
          ON officer_review.submission_id = p_submission_id
          AND officer_review.review_response_id = effective_response.response_id
      ) THEN
        RAISE EXCEPTION
          'Every effective office response requires a Tourism Officer review';
      END IF;
      IF v_responsibility.responsibility_type = 'mandatory_approval'
        AND v_effective_outcome <> 'approved'
      THEN
        RAISE EXCEPTION 'A mandatory responsibility requires an approved office response';
      END IF;
    END LOOP;
  END IF;

  v_new_state := CASE p_decision
    WHEN 'approved' THEN 'approved'::public.submission_state
    WHEN 'returned' THEN 'returned'::public.submission_state
    WHEN 'rejected' THEN 'rejected'::public.submission_state
  END;

  INSERT INTO public.submission_decisions (
    submission_id, submission_version_id, actor_profile_id, approver_grant_id,
    decision_kind, stage, reason, correction_instructions, supporting_context
  )
  VALUES (
    p_submission_id, v_current_version_id, v_actor, v_approver_grant_id,
    p_decision, p_stage, p_reason, p_correction_instructions,
    '{}'::jsonb
  )
  RETURNING id INTO v_decision_id;

  FOR v_evidence_item IN
    SELECT jsonb_array_elements_text(coalesce(v_evidence -> 'attachments', '[]'::jsonb))
  LOOP
    BEGIN
      v_evidence_id := v_evidence_item::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Decision evidence contains an invalid attachment ID';
    END;
    IF NOT EXISTS (
      SELECT 1 FROM public.attachments AS attachment
      WHERE attachment.id = v_evidence_id
        AND attachment.submission_id = p_submission_id
    ) THEN
      RAISE EXCEPTION 'Decision attachment evidence belongs to another submission';
    END IF;
    INSERT INTO public.decision_attachment_links (
      submission_id, decision_id, attachment_id
    )
    VALUES (p_submission_id, v_decision_id, v_evidence_id);
  END LOOP;

  FOR v_evidence_item IN
    SELECT jsonb_array_elements_text(coalesce(v_evidence -> 'responses', '[]'::jsonb))
  LOOP
    BEGIN
      v_evidence_id := v_evidence_item::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Decision evidence contains an invalid response ID';
    END;
    IF NOT EXISTS (
      SELECT 1
      FROM public.review_responses AS response
      WHERE response.id = v_evidence_id
        AND response.submission_id = p_submission_id
        AND (
          p_decision <> 'approved'
          OR p_stage <> 'final_review'
          OR EXISTS (
            SELECT 1 FROM public.review_cycles AS cycle
            JOIN public.office_responsibility_revisions AS revision
              ON revision.id = cycle.responsibility_revision_id
            WHERE cycle.id = response.review_cycle_id
              AND cycle.submission_version_id = v_current_version_id
              AND revision.id = (
                SELECT latest.id
                FROM public.office_responsibility_revisions AS latest
                WHERE latest.responsibility_id = cycle.responsibility_id
                ORDER BY latest.revision_number DESC
                LIMIT 1
              )
          )
          OR EXISTS (
            SELECT 1 FROM public.response_applicability AS applicability
            WHERE applicability.submission_id = response.submission_id
              AND applicability.original_response_id = response.id
              AND applicability.target_submission_version_id = v_current_version_id
                AND applicability.target_responsibility_revision_id = (
                  SELECT latest.id
                  FROM public.office_responsibility_revisions AS latest
                  WHERE latest.responsibility_id = applicability.responsibility_id
                  ORDER BY latest.revision_number DESC
                  LIMIT 1
                )
                AND NOT EXISTS (
                SELECT 1 FROM public.response_applicability_events AS event
                WHERE event.submission_id = applicability.submission_id
                  AND event.applicability_id = applicability.id
              )
          )
        )
    ) THEN
      RAISE EXCEPTION 'Decision response evidence is unavailable or stale';
    END IF;
    INSERT INTO public.decision_response_links (
      submission_id, decision_id, review_response_id
    )
    VALUES (p_submission_id, v_decision_id, v_evidence_id);
  END LOOP;

  FOR v_evidence_item IN
    SELECT jsonb_array_elements_text(coalesce(v_evidence -> 'officer_reviews', '[]'::jsonb))
  LOOP
    BEGIN
      v_evidence_id := v_evidence_item::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Decision evidence contains an invalid Officer review ID';
    END;
    IF NOT EXISTS (
      SELECT 1 FROM public.tourism_officer_response_reviews AS officer_review
      WHERE officer_review.id = v_evidence_id
        AND officer_review.submission_id = p_submission_id
    ) THEN
      RAISE EXCEPTION 'Decision Officer-review evidence belongs to another submission';
    END IF;
    INSERT INTO public.decision_officer_review_links (
      submission_id, decision_id, officer_response_review_id
    )
    VALUES (p_submission_id, v_decision_id, v_evidence_id);
  END LOOP;

  FOR v_evidence_item IN
    SELECT jsonb_array_elements_text(coalesce(v_evidence -> 'applicability', '[]'::jsonb))
  LOOP
    BEGIN
      v_evidence_id := v_evidence_item::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Decision evidence contains an invalid applicability ID';
    END;
    IF NOT EXISTS (
      SELECT 1 FROM public.response_applicability AS applicability
      WHERE applicability.id = v_evidence_id
        AND applicability.submission_id = p_submission_id
        AND (
          p_decision <> 'approved'
          OR p_stage <> 'final_review'
          OR (
            applicability.target_submission_version_id = v_current_version_id
            AND applicability.target_responsibility_revision_id = (
              SELECT latest.id
              FROM public.office_responsibility_revisions AS latest
              WHERE latest.responsibility_id = applicability.responsibility_id
              ORDER BY latest.revision_number DESC
              LIMIT 1
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.response_applicability_events AS event
              WHERE event.submission_id = applicability.submission_id
                AND event.applicability_id = applicability.id
            )
          )
        )
    ) THEN
      RAISE EXCEPTION 'Decision applicability evidence is unavailable or stale';
    END IF;
    INSERT INTO public.decision_applicability_links (
      submission_id, decision_id, applicability_id
    )
    VALUES (p_submission_id, v_decision_id, v_evidence_id);
  END LOOP;

  UPDATE public.submissions
  SET state = v_new_state, updated_at = now()
  WHERE id = p_submission_id;

  INSERT INTO public.submission_status_history (
    submission_id, previous_state, new_state, actor_profile_id,
    role_grant_id, decision_id, reason
  )
  VALUES (
    p_submission_id, v_state, v_new_state, v_actor,
    v_approver_grant_id, v_decision_id, p_reason
  );

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, submission_id, event_kind,
    correlation_id, idempotency_key_id, details
  )
  VALUES (
    v_actor, v_approver_grant_id, p_submission_id, 'overall_decision_recorded',
    v_decision_id, v_claim.key_id,
    pg_catalog.jsonb_build_object('decision', p_decision, 'stage', p_stage)
  );

  INSERT INTO public.notifications (
    recipient_profile_id, submission_id, decision_id, event_key, title, message
  )
  SELECT submission.submitter_profile_id, submission.id, v_decision_id,
    'decision:' || v_decision_id::text, 'Submission status updated',
    'A Tourism Officer recorded a submission decision.'
  FROM public.submissions AS submission
  WHERE submission.id = p_submission_id;

  PERFORM public.complete_workflow_idempotency(v_claim.key_id, v_decision_id);
  RETURN v_decision_id;
END;
$record_overall_decision$;

DO $prepare_executor_ownership$
DECLARE
  current_role_is_superuser boolean;
  current_role_has_executor_admin_option boolean;
BEGIN
  PERFORM pg_catalog.set_config(
    'connect_daet.temporary_executor_membership', 'false', true
  );
  PERFORM pg_catalog.set_config(
    'connect_daet.temporary_executor_schema_create', 'false', true
  );
  IF NOT pg_catalog.pg_has_role(
    current_user, 'connect_daet_workflow_executor', 'SET'
  ) THEN
    SELECT role_row.rolsuper
      INTO current_role_is_superuser
    FROM pg_catalog.pg_roles AS role_row
    WHERE role_row.rolname = current_user;
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS executor
        ON executor.oid = membership.roleid
      JOIN pg_catalog.pg_roles AS actor
        ON actor.oid = membership.member
      WHERE executor.rolname = 'connect_daet_workflow_executor'
        AND actor.rolname = current_user
        AND membership.admin_option
    )
      INTO current_role_has_executor_admin_option;
    IF current_role_is_superuser IS DISTINCT FROM true
      AND current_role_has_executor_admin_option IS DISTINCT FROM true
    THEN
      RAISE EXCEPTION
        'Migration role must be able to SET ROLE to the workflow executor or have ADMIN OPTION to grant itself SET membership';
    END IF;
    EXECUTE format(
      'GRANT connect_daet_workflow_executor TO %I WITH SET TRUE', current_user
    );
    PERFORM pg_catalog.set_config(
      'connect_daet.temporary_executor_membership', 'true', true
    );
  END IF;
  IF NOT pg_catalog.has_schema_privilege(
    'connect_daet_workflow_executor', 'public', 'CREATE'
  ) THEN
    EXECUTE 'GRANT CREATE ON SCHEMA public TO connect_daet_workflow_executor';
    PERFORM pg_catalog.set_config(
      'connect_daet.temporary_executor_schema_create', 'true', true
    );
  END IF;
END;
$prepare_executor_ownership$;

ALTER FUNCTION public.claim_workflow_idempotency(uuid, text, uuid, text, jsonb)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.complete_workflow_idempotency(uuid, uuid)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.require_active_workflow_grant(public.workflow_role)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.create_submission(text, text, uuid, text, text, jsonb, text)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.resubmit_submission(uuid, uuid, text, jsonb, text)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.create_routing_plan(uuid, public.routing_mode, jsonb, text, text)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.revise_office_responsibility(
  uuid, uuid, uuid, public.responsibility_type, text, text, text, text
) OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.submit_office_response(uuid, text, text, text, uuid[], text)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.record_officer_response_review(uuid, text, text, text, text)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.start_responsibility_reassessment(
  uuid, uuid, uuid[], jsonb, text, text
)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.confirm_response_applicability(uuid, uuid, text, text)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.record_overall_decision(
  uuid, uuid, public.decision_stage, public.overall_decision_kind, text, text, jsonb, text
) OWNER TO connect_daet_workflow_executor;
DO $cleanup_executor_ownership$
BEGIN
  IF pg_catalog.current_setting(
    'connect_daet.temporary_executor_schema_create'
  ) = 'true' THEN
    EXECUTE 'REVOKE CREATE ON SCHEMA public FROM connect_daet_workflow_executor';
  END IF;
  IF pg_catalog.current_setting(
    'connect_daet.temporary_executor_membership'
  ) = 'true' THEN
    EXECUTE format(
      'REVOKE connect_daet_workflow_executor FROM %I', current_user
    );
  END IF;
END;
$cleanup_executor_ownership$;

REVOKE ALL ON FUNCTION public.claim_workflow_idempotency(uuid, text, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_workflow_idempotency(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.require_active_workflow_grant(public.workflow_role)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_submission(text, text, uuid, text, text, jsonb, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resubmit_submission(uuid, uuid, text, jsonb, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_routing_plan(uuid, public.routing_mode, jsonb, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revise_office_responsibility(
  uuid, uuid, uuid, public.responsibility_type, text, text, text, text
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_office_response(uuid, text, text, text, uuid[], text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_officer_response_review(uuid, text, text, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_responsibility_reassessment(
  uuid, uuid, uuid[], jsonb, text, text
)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_response_applicability(uuid, uuid, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_overall_decision(
  uuid, uuid, public.decision_stage, public.overall_decision_kind, text, text, jsonb, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_submission(text, text, uuid, text, text, jsonb, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_submission(uuid, uuid, text, jsonb, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_routing_plan(uuid, public.routing_mode, jsonb, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.revise_office_responsibility(
  uuid, uuid, uuid, public.responsibility_type, text, text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_office_response(uuid, text, text, text, uuid[], text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_officer_response_review(uuid, text, text, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_responsibility_reassessment(
  uuid, uuid, uuid[], jsonb, text, text
)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_response_applicability(uuid, uuid, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_overall_decision(
  uuid, uuid, public.decision_stage, public.overall_decision_kind, text, text, jsonb, text
) TO authenticated;

COMMIT;
