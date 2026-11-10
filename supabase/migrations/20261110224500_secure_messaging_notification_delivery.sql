-- Clean-schema submission conversations and notification delivery processing.

BEGIN;

ALTER TABLE public.thread_participants
  ADD COLUMN last_read_at timestamptz;

GRANT SELECT (is_active) ON public.offices TO authenticated;
GRANT SELECT (last_read_at) ON public.thread_participants TO authenticated;
GRANT INSERT (submission_id, visibility, created_by_profile_id)
  ON public.message_threads TO connect_daet_workflow_executor;
GRANT INSERT (submission_id, thread_id, profile_id, added_by_profile_id, participation_basis)
  ON public.thread_participants TO connect_daet_workflow_executor;
GRANT INSERT (submission_id, thread_id, author_profile_id, body)
  ON public.messages TO connect_daet_workflow_executor;
GRANT INSERT (submission_id, message_id, attachment_id)
  ON public.message_attachments TO connect_daet_workflow_executor;
GRANT UPDATE (last_read_at) ON public.thread_participants
  TO connect_daet_workflow_executor;
GRANT INSERT (notification_id, recipient_profile_id, channel, scheduled_at)
  ON public.notification_deliveries TO connect_daet_workflow_executor;
GRANT INSERT (delivery_id, outcome, attempted_at, safe_error_metadata)
  ON public.notification_delivery_attempts TO connect_daet_workflow_executor;
GRANT UPDATE (status, attempt_count, next_attempt_at, lease_token,
  lease_expires_at, provider_message_id, last_error, completed_at)
  ON public.notification_deliveries TO connect_daet_workflow_executor;
GRANT INSERT (profile_id, role, granted_by_profile_id, authorizing_role_grant_id)
  ON public.role_grants TO connect_daet_workflow_executor;
GRANT INSERT (role_grant_id, event_kind, actor_profile_id, reason)
  ON public.role_grant_events TO connect_daet_workflow_executor;
GRANT INSERT (profile_id, office_id, granted_by_profile_id, authorizing_admin_grant_id)
  ON public.office_memberships TO connect_daet_workflow_executor;
GRANT INSERT (membership_id, event_kind, actor_profile_id, reason)
  ON public.office_membership_events TO connect_daet_workflow_executor;
GRANT UPDATE (revoked_at, revoked_by_profile_id, revocation_reason)
  ON public.role_grants TO connect_daet_workflow_executor;
GRANT UPDATE (ended_at, ended_by_profile_id, end_reason)
  ON public.office_memberships TO connect_daet_workflow_executor;
GRANT SELECT ON public.offices TO connect_daet_workflow_executor;
GRANT INSERT (code, name) ON public.offices TO connect_daet_workflow_executor;
GRANT UPDATE (is_active) ON public.offices
  TO connect_daet_workflow_executor;

ALTER TABLE public.notification_deliveries
  ADD COLUMN status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'accepted', 'delivered', 'failed')),
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN provider_message_id text,
  ADD COLUMN last_error text,
  ADD COLUMN completed_at timestamptz,
  ADD CONSTRAINT notification_deliveries_lease_shape_check CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (status <> 'processing' AND lease_token IS NULL AND lease_expires_at IS NULL)
  );

CREATE INDEX notification_deliveries_queue_idx
  ON public.notification_deliveries (next_attempt_at, created_at)
  WHERE status IN ('queued', 'processing');
DO $check_provider_message_ids$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.notification_deliveries
    WHERE provider_message_id IS NOT NULL
    GROUP BY provider_message_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate provider message IDs exist; resolve them before adding the unique index';
  END IF;
END;
$check_provider_message_ids$;

CREATE UNIQUE INDEX notification_deliveries_provider_message_id_unique_idx
  ON public.notification_deliveries (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE public.notification_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id text NOT NULL UNIQUE,
  provider_event_type text NOT NULL,
  provider_message_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  safe_event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_provider_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_provider_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_provider_events TO connect_daet_workflow_executor;
GRANT INSERT (provider_event_id, provider_event_type, provider_message_id, occurred_at, safe_event_data)
  ON public.notification_provider_events TO connect_daet_workflow_executor;
CREATE POLICY notification_provider_events_executor_access
  ON public.notification_provider_events
  TO connect_daet_workflow_executor
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.can_read_message_thread(p_thread_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $can_read_message_thread$
  SELECT EXISTS (
    SELECT 1
    FROM public.message_threads AS thread
    WHERE thread.id = p_thread_id
      AND public.can_read_submission(thread.submission_id)
      AND (
        (
          thread.visibility = 'staff_private'
          AND public.has_active_workflow_role('approver')
        )
        OR EXISTS (
          SELECT 1
          FROM public.thread_participants AS participant
          WHERE participant.thread_id = thread.id
            AND participant.profile_id = private.current_user_id()
            AND participant.ended_at IS NULL
        )
      )
  );
$can_read_message_thread$;

CREATE OR REPLACE FUNCTION public.can_read_attachment(p_attachment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $can_read_attachment$
  SELECT EXISTS (
    SELECT 1
    FROM public.attachments AS a
    JOIN public.submissions AS s ON s.id = a.submission_id
    WHERE a.id = p_attachment_id
      AND (
        (s.submitter_profile_id = private.current_user_id()
          AND a.uploaded_by_profile_id = private.current_user_id())
        OR EXISTS (
          SELECT 1 FROM public.role_grants AS rg
          WHERE rg.profile_id = private.current_user_id()
            AND rg.role = 'approver' AND rg.revoked_at IS NULL
        )
        OR EXISTS (
          SELECT 1
          FROM public.submission_version_attachments AS sva
          JOIN public.review_cycles AS rc
            ON rc.submission_id = sva.submission_id
            AND rc.submission_version_id = sva.submission_version_id
          JOIN public.office_assignments AS oa
            ON oa.submission_id = rc.submission_id AND oa.id = rc.assignment_id
          JOIN public.office_memberships AS om ON om.office_id = oa.office_id
          JOIN public.role_grants AS rg ON rg.profile_id = om.profile_id
          WHERE sva.submission_id = a.submission_id
            AND sva.attachment_id = a.id
            AND oa.cancelled_at IS NULL
            AND om.profile_id = private.current_user_id()
            AND om.ended_at IS NULL
            AND rg.role = 'external_approver'
            AND rg.revoked_at IS NULL
        )
        OR EXISTS (
          SELECT 1
          FROM public.review_response_attachments AS rra
          JOIN public.review_responses AS rr
            ON rr.submission_id = rra.submission_id AND rr.id = rra.review_response_id
          JOIN public.review_cycles AS rc ON rc.id = rr.review_cycle_id
          JOIN public.office_assignments AS oa ON oa.id = rc.assignment_id
          JOIN public.office_memberships AS om ON om.office_id = oa.office_id
          JOIN public.role_grants AS rg ON rg.profile_id = om.profile_id
          WHERE rra.submission_id = a.submission_id
            AND rra.attachment_id = a.id
            AND oa.cancelled_at IS NULL
            AND om.profile_id = private.current_user_id()
            AND om.ended_at IS NULL
            AND rg.role = 'external_approver'
            AND rg.revoked_at IS NULL
        )
        OR EXISTS (
          SELECT 1
          FROM public.message_attachments AS message_attachment
          JOIN public.messages AS message
            ON message.submission_id = message_attachment.submission_id
            AND message.id = message_attachment.message_id
          WHERE message_attachment.submission_id = a.submission_id
            AND message_attachment.attachment_id = a.id
            AND public.can_read_message_thread(message.thread_id)
        )
      )
  );
$can_read_attachment$;

ALTER FUNCTION public.can_read_message_thread(uuid)
  OWNER TO connect_daet_workflow_executor;
REVOKE ALL ON FUNCTION public.can_read_message_thread(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_message_thread(uuid)
  TO authenticated, service_role, connect_daet_workflow_executor;

CREATE OR REPLACE FUNCTION public.open_submission_message_thread(
  p_submission_id uuid,
  p_visibility public.thread_visibility
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $open_submission_message_thread$
DECLARE
  v_actor uuid := private.current_user_id();
  v_thread_id uuid;
  v_submitter_id uuid;
  v_visibility public.thread_visibility := coalesce(p_visibility, 'participants');
BEGIN
  IF v_actor IS NULL OR NOT public.can_read_submission(p_submission_id) THEN
    RAISE EXCEPTION 'Submission conversation is unavailable to this account';
  END IF;
  IF v_visibility = 'staff_private' THEN
    PERFORM public.require_active_workflow_grant('approver');
  END IF;

  SELECT submission.submitter_profile_id
    INTO v_submitter_id
  FROM public.submissions AS submission
  WHERE submission.id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission conversation is unavailable';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_submission_id::text || ':' || v_visibility::text, 0)
  );

  SELECT thread.id
    INTO v_thread_id
  FROM public.message_threads AS thread
  WHERE thread.submission_id = p_submission_id
    AND thread.visibility = v_visibility
  ORDER BY thread.created_at
  LIMIT 1;

  IF v_thread_id IS NOT NULL THEN
    INSERT INTO public.thread_participants (
      submission_id, thread_id, profile_id, added_by_profile_id, participation_basis
    )
    VALUES (
      p_submission_id, v_thread_id, v_actor, v_actor,
      CASE
        WHEN v_visibility = 'staff_private' THEN 'active_tourism_officer'
        WHEN v_actor = v_submitter_id THEN 'submission_owner'
        WHEN public.has_active_workflow_role('approver') THEN 'active_tourism_officer'
        ELSE 'assigned_office_member'
      END
    )
    ON CONFLICT (thread_id, profile_id) WHERE ended_at IS NULL DO NOTHING;
    RETURN v_thread_id;
  END IF;

  INSERT INTO public.message_threads (
    submission_id, visibility, created_by_profile_id
  )
  VALUES (p_submission_id, v_visibility, v_actor)
  RETURNING id INTO v_thread_id;

  IF v_visibility = 'staff_private' THEN
    INSERT INTO public.thread_participants (
      submission_id, thread_id, profile_id, added_by_profile_id, participation_basis
    )
    SELECT p_submission_id, v_thread_id, grant_row.profile_id, v_actor, 'active_tourism_officer'
    FROM public.role_grants AS grant_row
    WHERE grant_row.role = 'approver'
      AND grant_row.revoked_at IS NULL
    ON CONFLICT (thread_id, profile_id) WHERE ended_at IS NULL DO NOTHING;
  ELSE
    INSERT INTO public.thread_participants (
      submission_id, thread_id, profile_id, added_by_profile_id, participation_basis
    )
    SELECT p_submission_id, v_thread_id, v_submitter_id, v_actor, 'submission_owner'
    ON CONFLICT (thread_id, profile_id) WHERE ended_at IS NULL DO NOTHING;

    INSERT INTO public.thread_participants (
      submission_id, thread_id, profile_id, added_by_profile_id, participation_basis
    )
    SELECT p_submission_id, v_thread_id, eligible.profile_id, v_actor, eligible.basis
    FROM (
      SELECT DISTINCT ON (eligible_profile.profile_id)
        eligible_profile.profile_id,
        eligible_profile.basis
      FROM (
        SELECT grant_row.profile_id, 'active_tourism_officer'::text AS basis
        FROM public.role_grants AS grant_row
        WHERE grant_row.role = 'approver'
          AND grant_row.revoked_at IS NULL
        UNION ALL
        SELECT membership.profile_id, 'assigned_office_member'::text
        FROM public.office_assignments AS assignment
        JOIN public.office_memberships AS membership
          ON membership.office_id = assignment.office_id
        JOIN public.role_grants AS office_grant
          ON office_grant.profile_id = membership.profile_id
        WHERE assignment.submission_id = p_submission_id
          AND assignment.cancelled_at IS NULL
          AND membership.ended_at IS NULL
          AND office_grant.role = 'external_approver'
          AND office_grant.revoked_at IS NULL
      ) AS eligible_profile
      ORDER BY eligible_profile.profile_id, eligible_profile.basis
    ) AS eligible
    WHERE eligible.profile_id <> v_submitter_id
    ON CONFLICT (thread_id, profile_id) WHERE ended_at IS NULL DO NOTHING;
  END IF;

  RETURN v_thread_id;
END;
$open_submission_message_thread$;

CREATE OR REPLACE FUNCTION public.send_submission_message(
  p_thread_id uuid,
  p_body text,
  p_attachment_metadata jsonb,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $send_submission_message$
DECLARE
  v_actor uuid := private.current_user_id();
  v_submission_id uuid;
  v_submitter_id uuid;
  v_visibility public.thread_visibility;
  v_message_id uuid;
  v_attachment_id uuid;
  v_item jsonb;
  v_attachments jsonb := coalesce(p_attachment_metadata, '[]'::jsonb);
  v_claim public.idempotency_claim;
  v_attachment_count integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in to send a submission message';
  END IF;
  IF nullif(btrim(p_body), '') IS NULL OR length(p_body) > 5000
    OR jsonb_typeof(v_attachments) <> 'array'
  THEN
    RAISE EXCEPTION 'Message text or attachment metadata is invalid';
  END IF;
  v_attachment_count := jsonb_array_length(v_attachments);
  IF v_attachment_count > 5 THEN
    RAISE EXCEPTION 'A message may include no more than five attachments';
  END IF;

  SELECT thread.submission_id, thread.visibility, submission.submitter_profile_id
    INTO v_submission_id, v_visibility, v_submitter_id
  FROM public.message_threads AS thread
  JOIN public.submissions AS submission ON submission.id = thread.submission_id
  WHERE thread.id = p_thread_id;
  IF NOT FOUND OR NOT public.can_read_message_thread(p_thread_id) THEN
    RAISE EXCEPTION 'You are not authorized to send to this conversation';
  END IF;
  IF v_visibility = 'staff_private' THEN
    PERFORM public.require_active_workflow_grant('approver');
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.thread_participants AS participant
    WHERE participant.thread_id = p_thread_id
      AND participant.profile_id = v_actor
      AND participant.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Only active conversation participants may send messages';
  END IF;

  v_claim := public.claim_workflow_idempotency(
    v_actor, 'send_submission_message', p_thread_id, p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'body', p_body,
      'attachment_metadata', v_attachments
    )
  );
  IF v_claim.replay THEN
    RETURN v_claim.result_id;
  END IF;

  INSERT INTO public.messages (submission_id, thread_id, author_profile_id, body)
  VALUES (v_submission_id, p_thread_id, v_actor, btrim(p_body))
  RETURNING id INTO v_message_id;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_attachments)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
      OR nullif(btrim(v_item ->> 'original_filename'), '') IS NULL
      OR nullif(btrim(v_item ->> 'object_key'), '') IS NULL
      OR length(v_item ->> 'original_filename') > 255
      OR coalesce((v_item ->> 'byte_size')::bigint, 0) > 20971520
      OR coalesce((v_item ->> 'byte_size')::bigint, 0) < 0
    THEN
      RAISE EXCEPTION 'Invalid message attachment metadata';
    END IF;

    PERFORM private.validate_submission_attachment_object(
      v_item ->> 'object_key', v_actor
    );

    INSERT INTO public.attachments (
      submission_id, uploaded_by_profile_id, original_filename,
      content_type, byte_size, object_key
    )
    VALUES (
      v_submission_id, v_actor, v_item ->> 'original_filename',
      nullif(v_item ->> 'content_type', ''),
      CASE
        WHEN nullif(v_item ->> 'byte_size', '') IS NULL THEN NULL
        ELSE (v_item ->> 'byte_size')::bigint
      END,
      v_item ->> 'object_key'
    )
    RETURNING id INTO v_attachment_id;

    INSERT INTO public.message_attachments (
      submission_id, message_id, attachment_id
    )
    VALUES (v_submission_id, v_message_id, v_attachment_id);
  END LOOP;

  INSERT INTO public.notifications (
    recipient_profile_id, submission_id, event_key, title, message
  )
  SELECT participant.profile_id, v_submission_id,
    'message:' || v_message_id::text || ':' || participant.profile_id::text,
    'New submission message',
    'A participant added a message to a submission conversation.'
  FROM public.thread_participants AS participant
  WHERE participant.thread_id = p_thread_id
    AND participant.profile_id <> v_actor
    AND participant.ended_at IS NULL
    AND (
      (
        v_visibility = 'staff_private'
        AND EXISTS (
          SELECT 1 FROM public.role_grants AS grant_row
          WHERE grant_row.profile_id = participant.profile_id
            AND grant_row.role = 'approver'
            AND grant_row.revoked_at IS NULL
        )
      )
      OR (
        v_visibility = 'participants'
        AND (
          participant.profile_id = v_submitter_id
          OR EXISTS (
            SELECT 1 FROM public.role_grants AS grant_row
            WHERE grant_row.profile_id = participant.profile_id
              AND grant_row.role = 'approver'
              AND grant_row.revoked_at IS NULL
          )
          OR EXISTS (
            SELECT 1
            FROM public.office_assignments AS assignment
            JOIN public.office_memberships AS membership
              ON membership.office_id = assignment.office_id
            JOIN public.role_grants AS office_grant
              ON office_grant.profile_id = membership.profile_id
            WHERE assignment.submission_id = v_submission_id
              AND assignment.cancelled_at IS NULL
              AND membership.profile_id = participant.profile_id
              AND membership.ended_at IS NULL
              AND office_grant.role = 'external_approver'
              AND office_grant.revoked_at IS NULL
          )
        )
      )
    );

  INSERT INTO public.audit_events (
    actor_profile_id, submission_id, event_kind, details
  )
  VALUES (
    v_actor, v_submission_id, 'submission_message_sent',
    pg_catalog.jsonb_build_object(
      'message_id', v_message_id,
      'visibility', v_visibility,
      'attachment_count', v_attachment_count
    )
  );

  PERFORM public.complete_workflow_idempotency(v_claim.key_id, v_message_id);
  RETURN v_message_id;
END;
$send_submission_message$;

CREATE OR REPLACE FUNCTION public.mark_submission_message_thread_read(
  p_thread_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $mark_submission_message_thread_read$
DECLARE
  v_actor uuid := private.current_user_id();
BEGIN
  IF v_actor IS NULL OR NOT public.can_read_message_thread(p_thread_id) THEN
    RAISE EXCEPTION 'Conversation is unavailable to this account';
  END IF;

  UPDATE public.thread_participants
  SET last_read_at = now()
  WHERE thread_id = p_thread_id
    AND profile_id = v_actor
    AND ended_at IS NULL;
END;
$mark_submission_message_thread_read$;

CREATE OR REPLACE FUNCTION public.get_authorized_attachment_object_key(
  p_attachment_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $get_authorized_attachment_object_key$
DECLARE
  v_object_key text;
BEGIN
  IF private.current_user_id() IS NULL
    OR NOT public.can_read_attachment(p_attachment_id)
  THEN
    RAISE EXCEPTION 'Attachment is unavailable to this account';
  END IF;

  SELECT attachment.object_key
    INTO v_object_key
  FROM public.attachments AS attachment
  WHERE attachment.id = p_attachment_id;

  IF v_object_key IS NULL THEN
    RAISE EXCEPTION 'Attachment is unavailable to this account';
  END IF;
  RETURN v_object_key;
END;
$get_authorized_attachment_object_key$;

CREATE OR REPLACE FUNCTION public.admin_grant_workflow_role(
  p_profile_id uuid,
  p_role public.workflow_role,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $admin_grant_workflow_role$
DECLARE
  v_actor uuid := private.current_user_id();
  v_admin_grant_id uuid;
  v_role_grant_id uuid;
BEGIN
  IF p_profile_id IS NULL OR p_role IS NULL
    OR nullif(btrim(p_reason), '') IS NULL OR length(p_reason) > 500
  THEN
    RAISE EXCEPTION 'A target account, workflow role, and reason are required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('connect-daet-admin-role-changes', 0)
  );
  v_admin_grant_id := public.require_active_workflow_grant('admin');

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_profile_id::text || ':' || p_role::text, 0)
  );
  SELECT grant_row.id
    INTO v_role_grant_id
  FROM public.role_grants AS grant_row
  WHERE grant_row.profile_id = p_profile_id
    AND grant_row.role = p_role
    AND grant_row.revoked_at IS NULL
  FOR UPDATE;
  IF v_role_grant_id IS NOT NULL THEN
    INSERT INTO public.audit_events (
      actor_profile_id, role_grant_id, event_kind, details
    )
    VALUES (
      v_actor, v_admin_grant_id, 'workflow_role_grant_confirmed',
      pg_catalog.jsonb_build_object(
        'target_profile_id', p_profile_id,
        'role_grant_id', v_role_grant_id,
        'role', p_role
      )
    );
    RETURN v_role_grant_id;
  END IF;

  INSERT INTO public.role_grants (
    profile_id, role, granted_by_profile_id, authorizing_role_grant_id
  )
  VALUES (
    p_profile_id,
    p_role,
    CASE WHEN p_role = 'user' THEN NULL ELSE v_actor END,
    CASE WHEN p_role = 'user' THEN NULL ELSE v_admin_grant_id END
  )
  RETURNING id INTO v_role_grant_id;

  INSERT INTO public.role_grant_events (role_grant_id, event_kind, actor_profile_id, reason)
  VALUES (v_role_grant_id, 'granted', v_actor, btrim(p_reason));

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, event_kind, details
  )
  VALUES (
    v_actor, v_admin_grant_id, 'workflow_role_granted',
    pg_catalog.jsonb_build_object(
      'target_profile_id', p_profile_id,
      'role_grant_id', v_role_grant_id,
      'role', p_role
    )
  );

  RETURN v_role_grant_id;
END;
$admin_grant_workflow_role$;

CREATE OR REPLACE FUNCTION public.admin_revoke_workflow_role(
  p_role_grant_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $admin_revoke_workflow_role$
DECLARE
  v_actor uuid := private.current_user_id();
  v_admin_grant_id uuid;
  v_role_grant public.role_grants%ROWTYPE;
  v_active_admin_count bigint;
BEGIN
  IF p_role_grant_id IS NULL OR nullif(btrim(p_reason), '') IS NULL
    OR length(p_reason) > 500
  THEN
    RAISE EXCEPTION 'A role grant and revocation reason are required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('connect-daet-admin-role-changes', 0)
  );
  v_admin_grant_id := public.require_active_workflow_grant('admin');

  SELECT grant_row.*
    INTO v_role_grant
  FROM public.role_grants AS grant_row
  WHERE grant_row.id = p_role_grant_id
  FOR UPDATE;
  IF NOT FOUND OR v_role_grant.revoked_at IS NOT NULL THEN
    RETURN false;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_role_grant.profile_id::text || ':' || v_role_grant.role::text, 0
    )
  );
  SELECT grant_row.*
    INTO v_role_grant
  FROM public.role_grants AS grant_row
  WHERE grant_row.id = p_role_grant_id
  FOR UPDATE;
  IF NOT FOUND OR v_role_grant.revoked_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF v_role_grant.role = 'admin' THEN
    SELECT count(*)
      INTO v_active_admin_count
    FROM public.role_grants AS grant_row
    WHERE grant_row.role = 'admin'
      AND grant_row.revoked_at IS NULL;
    IF v_active_admin_count <= 1 THEN
      RAISE EXCEPTION 'The final active administrator role cannot be revoked';
    END IF;
  END IF;

  UPDATE public.role_grants
  SET revoked_at = now(),
      revoked_by_profile_id = v_actor,
      revocation_reason = btrim(p_reason)
  WHERE id = p_role_grant_id;

  INSERT INTO public.role_grant_events (role_grant_id, event_kind, actor_profile_id, reason)
  VALUES (p_role_grant_id, 'revoked', v_actor, btrim(p_reason));

  IF v_role_grant.role = 'external_approver' THEN
    WITH ended_memberships AS (
      UPDATE public.office_memberships
      SET ended_at = now(),
          ended_by_profile_id = v_actor,
          end_reason = btrim(p_reason)
      WHERE profile_id = v_role_grant.profile_id
        AND ended_at IS NULL
      RETURNING id
    )
    INSERT INTO public.office_membership_events (
      membership_id, event_kind, actor_profile_id, reason
    )
    SELECT ended.id, 'revoked', v_actor, btrim(p_reason)
    FROM ended_memberships AS ended;
  END IF;

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, event_kind, details
  )
  VALUES (
    v_actor, v_admin_grant_id, 'workflow_role_revoked',
    pg_catalog.jsonb_build_object(
      'target_profile_id', v_role_grant.profile_id,
      'role_grant_id', p_role_grant_id,
      'role', v_role_grant.role,
      'reason', btrim(p_reason)
    )
  );
  RETURN true;
END;
$admin_revoke_workflow_role$;

CREATE OR REPLACE FUNCTION public.admin_grant_office_membership(
  p_profile_id uuid,
  p_office_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $admin_grant_office_membership$
DECLARE
  v_actor uuid := private.current_user_id();
  v_admin_grant_id uuid;
  v_membership_id uuid;
BEGIN
  IF p_profile_id IS NULL OR p_office_id IS NULL
    OR nullif(btrim(p_reason), '') IS NULL OR length(p_reason) > 500
  THEN
    RAISE EXCEPTION 'A target account, office, and reason are required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('connect-daet-admin-role-changes', 0)
  );
  v_admin_grant_id := public.require_active_workflow_grant('admin');

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_profile_id::text || ':external_approver', 0)
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.offices AS office
    WHERE office.id = p_office_id AND office.is_active
  ) OR NOT EXISTS (
    SELECT 1 FROM public.role_grants AS grant_row
    WHERE grant_row.profile_id = p_profile_id
      AND grant_row.role = 'external_approver'
      AND grant_row.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An active office and external_approver role are required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_profile_id::text || ':' || p_office_id::text, 0)
  );
  SELECT membership.id
    INTO v_membership_id
  FROM public.office_memberships AS membership
  WHERE membership.profile_id = p_profile_id
    AND membership.office_id = p_office_id
    AND membership.ended_at IS NULL
  FOR UPDATE;
  IF v_membership_id IS NOT NULL THEN
    RETURN v_membership_id;
  END IF;

  INSERT INTO public.office_memberships (
    profile_id, office_id, granted_by_profile_id, authorizing_admin_grant_id
  )
  VALUES (p_profile_id, p_office_id, v_actor, v_admin_grant_id)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.office_membership_events (
    membership_id, event_kind, actor_profile_id, reason
  )
  VALUES (v_membership_id, 'granted', v_actor, btrim(p_reason));

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, office_membership_id, event_kind, details
  )
  VALUES (
    v_actor, v_admin_grant_id, v_membership_id, 'office_membership_granted',
    pg_catalog.jsonb_build_object('target_profile_id', p_profile_id, 'office_id', p_office_id)
  );
  RETURN v_membership_id;
END;
$admin_grant_office_membership$;

CREATE OR REPLACE FUNCTION public.admin_revoke_office_membership(
  p_membership_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $admin_revoke_office_membership$
DECLARE
  v_actor uuid := private.current_user_id();
  v_admin_grant_id uuid;
  v_membership public.office_memberships%ROWTYPE;
BEGIN
  IF p_membership_id IS NULL OR nullif(btrim(p_reason), '') IS NULL
    OR length(p_reason) > 500
  THEN
    RAISE EXCEPTION 'A membership and revocation reason are required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('connect-daet-admin-role-changes', 0)
  );
  v_admin_grant_id := public.require_active_workflow_grant('admin');

  SELECT membership.*
    INTO v_membership
  FROM public.office_memberships AS membership
  WHERE membership.id = p_membership_id
  FOR UPDATE;
  IF NOT FOUND OR v_membership.ended_at IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE public.office_memberships
  SET ended_at = now(),
      ended_by_profile_id = v_actor,
      end_reason = btrim(p_reason)
  WHERE id = p_membership_id;

  INSERT INTO public.office_membership_events (
    membership_id, event_kind, actor_profile_id, reason
  )
  VALUES (p_membership_id, 'revoked', v_actor, btrim(p_reason));

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, office_membership_id, event_kind, details
  )
  VALUES (
    v_actor, v_admin_grant_id, p_membership_id, 'office_membership_revoked',
    pg_catalog.jsonb_build_object(
      'target_profile_id', v_membership.profile_id,
      'office_id', v_membership.office_id,
      'reason', btrim(p_reason)
    )
  );
  RETURN true;
END;
$admin_revoke_office_membership$;

CREATE OR REPLACE FUNCTION public.admin_create_office(
  p_code text,
  p_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $admin_create_office$
DECLARE
  v_actor uuid := private.current_user_id();
  v_admin_grant_id uuid;
  v_office_id uuid;
BEGIN
  IF nullif(btrim(p_code), '') IS NULL OR length(p_code) > 30
    OR nullif(btrim(p_name), '') IS NULL OR length(p_name) > 200
  THEN
    RAISE EXCEPTION 'Office code and name are required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('connect-daet-admin-role-changes', 0)
  );
  v_admin_grant_id := public.require_active_workflow_grant('admin');

  INSERT INTO public.offices (code, name)
  VALUES (btrim(p_code), btrim(p_name))
  RETURNING id INTO v_office_id;

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, event_kind, details
  )
  VALUES (
    v_actor, v_admin_grant_id, 'office_created',
    pg_catalog.jsonb_build_object('office_id', v_office_id, 'code', btrim(p_code), 'name', btrim(p_name))
  );
  RETURN v_office_id;
END;
$admin_create_office$;

CREATE OR REPLACE FUNCTION public.admin_set_office_active(
  p_office_id uuid,
  p_is_active boolean,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $admin_set_office_active$
DECLARE
  v_actor uuid := private.current_user_id();
  v_admin_grant_id uuid;
BEGIN
  IF p_office_id IS NULL OR p_is_active IS NULL
    OR nullif(btrim(p_reason), '') IS NULL OR length(p_reason) > 500
  THEN
    RAISE EXCEPTION 'An office status and reason are required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('connect-daet-admin-role-changes', 0)
  );
  v_admin_grant_id := public.require_active_workflow_grant('admin');

  UPDATE public.offices
  SET is_active = p_is_active
  WHERE id = p_office_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, event_kind, details
  )
  VALUES (
    v_actor, v_admin_grant_id, 'office_status_changed',
    pg_catalog.jsonb_build_object('office_id', p_office_id, 'is_active', p_is_active, 'reason', btrim(p_reason))
  );
  RETURN true;
END;
$admin_set_office_active$;

CREATE OR REPLACE FUNCTION private.queue_notification_email_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $queue_notification_email_delivery$
BEGIN
  INSERT INTO public.notification_deliveries (
    notification_id, recipient_profile_id, channel, scheduled_at
  )
  VALUES (NEW.id, NEW.recipient_profile_id, 'email', now())
  ON CONFLICT (notification_id, channel) DO NOTHING;
  RETURN NEW;
END;
$queue_notification_email_delivery$;

CREATE OR REPLACE FUNCTION private.notify_submission_initial_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $notify_submission_initial_review$
BEGIN
  IF NEW.state = 'initial_review'
    AND (
      TG_OP = 'INSERT'
      OR OLD.state IS DISTINCT FROM NEW.state
    )
  THEN
    INSERT INTO public.notifications (
      recipient_profile_id, submission_id, event_key, title, message
    )
    SELECT grant_row.profile_id, NEW.id,
      'initial-review:' || NEW.id::text || ':' || coalesce(NEW.current_version_id::text, 'initial'),
      'Submission awaiting Tourism Officer review',
      'A submission is ready for initial review: ' || NEW.tracking_number || ' - ' || NEW.title
    FROM public.role_grants AS grant_row
    WHERE grant_row.role = 'approver'
      AND grant_row.revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$notify_submission_initial_review$;

CREATE OR REPLACE FUNCTION private.notify_office_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $notify_office_assignment$
DECLARE
  v_tracking_number text;
  v_submission_title text;
  v_office_name text;
BEGIN
  SELECT submission.tracking_number, submission.title, office.name
    INTO v_tracking_number, v_submission_title, v_office_name
  FROM public.submissions AS submission
  JOIN public.offices AS office ON office.id = NEW.office_id
  WHERE submission.id = NEW.submission_id;

  INSERT INTO public.notifications (
    recipient_profile_id, submission_id, event_key, title, message
  )
  SELECT membership.profile_id, NEW.submission_id,
    'office-assignment:' || NEW.id::text || ':' || membership.profile_id::text,
    'New office review assignment',
    v_tracking_number || ' - ' || v_submission_title
      || ' was assigned to ' || v_office_name || '.'
  FROM public.office_memberships AS membership
  JOIN public.role_grants AS grant_row
    ON grant_row.profile_id = membership.profile_id
  WHERE membership.office_id = NEW.office_id
    AND membership.ended_at IS NULL
    AND grant_row.role = 'external_approver'
    AND grant_row.revoked_at IS NULL;
  RETURN NEW;
END;
$notify_office_assignment$;

CREATE OR REPLACE FUNCTION private.notify_tourism_officers_of_office_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $notify_tourism_officers_of_office_response$
DECLARE
  v_tracking_number text;
BEGIN
  SELECT submission.tracking_number
    INTO v_tracking_number
  FROM public.submissions AS submission
  WHERE submission.id = NEW.submission_id;

  INSERT INTO public.notifications (
    recipient_profile_id, submission_id, event_key, title, message
  )
  SELECT grant_row.profile_id, NEW.submission_id,
    'office-response:' || NEW.id::text || ':' || grant_row.profile_id::text,
    'Municipal office response received',
    'A response for ' || v_tracking_number || ' is ready for Tourism Officer review.'
  FROM public.role_grants AS grant_row
  WHERE grant_row.role = 'approver'
    AND grant_row.revoked_at IS NULL;
  RETURN NEW;
END;
$notify_tourism_officers_of_office_response$;

CREATE OR REPLACE FUNCTION private.notify_submitter_of_overall_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $notify_submitter_of_overall_decision$
DECLARE
  v_tracking_number text;
  v_submission_title text;
  v_message text;
BEGIN
  SELECT submission.tracking_number, submission.title
    INTO v_tracking_number, v_submission_title
  FROM public.submissions AS submission
  WHERE submission.id = NEW.submission_id;

  v_message := CASE NEW.decision_kind
    WHEN 'approved' THEN
      'Your submission ' || v_tracking_number || ' - ' || v_submission_title
        || ' was approved.'
    WHEN 'returned' THEN
      'Your submission ' || v_tracking_number || ' - ' || v_submission_title
        || ' was returned for correction. Instructions: ' || NEW.correction_instructions
    WHEN 'rejected' THEN
      'Your submission ' || v_tracking_number || ' - ' || v_submission_title
        || ' was rejected. Reason: ' || NEW.reason
  END;

  INSERT INTO public.notifications (
    recipient_profile_id, submission_id, decision_id, event_key, title, message
  )
  SELECT submission.submitter_profile_id, NEW.submission_id, NEW.id,
    'overall-decision:' || NEW.id::text || ':' || submission.submitter_profile_id::text,
    CASE NEW.decision_kind
      WHEN 'approved' THEN 'Submission approved'
      WHEN 'returned' THEN 'Submission returned for correction'
      WHEN 'rejected' THEN 'Submission rejected'
    END,
    v_message
  FROM public.submissions AS submission
  WHERE submission.id = NEW.submission_id;
  RETURN NEW;
END;
$notify_submitter_of_overall_decision$;

ALTER FUNCTION private.queue_notification_email_delivery()
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION private.notify_submission_initial_review()
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION private.notify_office_assignment()
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION private.notify_tourism_officers_of_office_response()
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION private.notify_submitter_of_overall_decision()
  OWNER TO connect_daet_workflow_executor;
REVOKE ALL ON FUNCTION private.queue_notification_email_delivery()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.notify_submission_initial_review()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.notify_office_assignment()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.notify_tourism_officers_of_office_response()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.notify_submitter_of_overall_decision()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.queue_notification_email_delivery()
  TO connect_daet_workflow_executor;
GRANT EXECUTE ON FUNCTION private.notify_submission_initial_review()
  TO connect_daet_workflow_executor;
GRANT EXECUTE ON FUNCTION private.notify_office_assignment()
  TO connect_daet_workflow_executor;
GRANT EXECUTE ON FUNCTION private.notify_tourism_officers_of_office_response()
  TO connect_daet_workflow_executor;
GRANT EXECUTE ON FUNCTION private.notify_submitter_of_overall_decision()
  TO connect_daet_workflow_executor;

CREATE TRIGGER queue_notification_email_delivery
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION private.queue_notification_email_delivery();

CREATE TRIGGER notify_submission_initial_review
AFTER INSERT OR UPDATE OF state ON public.submissions
FOR EACH ROW
EXECUTE FUNCTION private.notify_submission_initial_review();

CREATE TRIGGER notify_office_assignment
AFTER INSERT ON public.office_assignments
FOR EACH ROW
WHEN (NEW.cancelled_at IS NULL)
EXECUTE FUNCTION private.notify_office_assignment();

CREATE TRIGGER notify_tourism_officers_of_office_response
AFTER INSERT ON public.review_responses
FOR EACH ROW
EXECUTE FUNCTION private.notify_tourism_officers_of_office_response();

CREATE TRIGGER notify_submitter_of_overall_decision
AFTER INSERT ON public.submission_decisions
FOR EACH ROW
EXECUTE FUNCTION private.notify_submitter_of_overall_decision();

CREATE OR REPLACE FUNCTION public.claim_notification_email_deliveries(
  p_worker_token uuid,
  p_batch_size integer
)
RETURNS TABLE (
  delivery_id uuid,
  notification_id uuid,
  submission_id uuid,
  recipient_profile_id uuid,
  event_key text,
  title text,
  message text,
  tracking_number text,
  submission_title text,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $claim_notification_email_deliveries$
BEGIN
  IF p_worker_token IS NULL OR p_batch_size < 1 OR p_batch_size > 100 THEN
    RAISE EXCEPTION 'Invalid notification delivery claim request';
  END IF;

  RETURN QUERY
  WITH claimable AS (
    SELECT delivery.id
    FROM public.notification_deliveries AS delivery
    WHERE delivery.channel = 'email'
      AND (
        (delivery.status = 'queued' AND delivery.next_attempt_at <= now())
        OR (delivery.status = 'processing' AND delivery.lease_expires_at < now())
      )
    ORDER BY delivery.next_attempt_at, delivery.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  ),
  claimed AS (
    UPDATE public.notification_deliveries AS delivery
    SET status = 'processing',
        attempt_count = delivery.attempt_count + 1,
        lease_token = p_worker_token,
        lease_expires_at = now() + interval '5 minutes'
    FROM claimable
    WHERE delivery.id = claimable.id
    RETURNING delivery.id, delivery.notification_id, delivery.recipient_profile_id,
      delivery.attempt_count
  )
  SELECT claimed.id, notification.id, notification.submission_id,
    claimed.recipient_profile_id, notification.event_key,
    notification.title, notification.message,
    submission.tracking_number,
    submission.title, claimed.attempt_count
  FROM claimed
  JOIN public.notifications AS notification ON notification.id = claimed.notification_id
  JOIN public.submissions AS submission ON submission.id = notification.submission_id;
END;
$claim_notification_email_deliveries$;

CREATE OR REPLACE FUNCTION public.complete_notification_email_delivery(
  p_delivery_id uuid,
  p_worker_token uuid,
  p_outcome text,
  p_provider_message_id text,
  p_error text,
  p_retry_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $complete_notification_email_delivery$
DECLARE
  v_delivery public.notification_deliveries%ROWTYPE;
  v_next_status text;
  v_provider_event_type text;
BEGIN
  IF p_outcome IS NULL
    OR p_outcome NOT IN ('accepted', 'confirmed_failed', 'unknown')
  THEN
    RAISE EXCEPTION 'Invalid notification delivery outcome';
  END IF;
  IF p_outcome = 'accepted' AND nullif(btrim(p_provider_message_id), '') IS NULL THEN
    RAISE EXCEPTION 'An accepted email requires its provider message ID';
  END IF;

  SELECT delivery.*
    INTO v_delivery
  FROM public.notification_deliveries AS delivery
  WHERE delivery.id = p_delivery_id
    AND delivery.status = 'processing'
    AND delivery.lease_token = p_worker_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification delivery lease is unavailable or expired';
  END IF;

  IF p_outcome = 'accepted' THEN
    v_next_status := 'accepted';
  ELSIF p_retry_at IS NOT NULL AND v_delivery.attempt_count < 6 THEN
    v_next_status := 'queued';
  ELSE
    v_next_status := 'failed';
  END IF;

  INSERT INTO public.notification_delivery_attempts (
    delivery_id, outcome, safe_error_metadata
  )
  VALUES (
    p_delivery_id,
    p_outcome,
    CASE
      WHEN p_error IS NULL THEN '{}'::jsonb
      ELSE pg_catalog.jsonb_build_object('error', left(p_error, 1000))
    END
  );

  UPDATE public.notification_deliveries
  SET status = v_next_status,
      next_attempt_at = coalesce(p_retry_at, next_attempt_at),
      lease_token = NULL,
      lease_expires_at = NULL,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      last_error = CASE WHEN p_error IS NULL THEN NULL ELSE left(p_error, 2000) END,
      completed_at = CASE WHEN v_next_status IN ('accepted', 'failed') THEN now() ELSE NULL END
  WHERE id = p_delivery_id;

  IF v_next_status = 'accepted' THEN
    SELECT provider_event.provider_event_type
      INTO v_provider_event_type
    FROM public.notification_provider_events AS provider_event
    WHERE provider_event.provider_message_id = p_provider_message_id
    ORDER BY provider_event.occurred_at DESC, provider_event.created_at DESC
    LIMIT 1;

    IF v_provider_event_type IS NOT NULL THEN
      IF v_provider_event_type = 'email.delivered' THEN
        INSERT INTO public.notification_delivery_attempts (
          delivery_id, outcome, safe_error_metadata
        )
        VALUES (p_delivery_id, 'confirmed_delivered', '{}'::jsonb);
        UPDATE public.notification_deliveries
        SET status = 'delivered', completed_at = now(), last_error = NULL
        WHERE id = p_delivery_id;
      ELSE
        INSERT INTO public.notification_delivery_attempts (
          delivery_id, outcome, safe_error_metadata
        )
        VALUES (
          p_delivery_id,
          'confirmed_failed',
          pg_catalog.jsonb_build_object('provider_event_type', v_provider_event_type)
        );
        UPDATE public.notification_deliveries
        SET status = 'failed',
            completed_at = now(),
            last_error = v_provider_event_type
        WHERE id = p_delivery_id;
      END IF;
    END IF;
  END IF;
END;
$complete_notification_email_delivery$;

CREATE OR REPLACE FUNCTION public.record_notification_provider_event(
  p_provider_event_id text,
  p_provider_event_type text,
  p_provider_message_id text,
  p_event_occurred_at timestamptz,
  p_provider_event_data jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $record_notification_provider_event$
DECLARE
  v_inserted_id uuid;
  v_delivery_id uuid;
  v_outcome text;
BEGIN
  IF nullif(btrim(p_provider_event_id), '') IS NULL
    OR nullif(btrim(p_provider_event_type), '') IS NULL
    OR nullif(btrim(p_provider_message_id), '') IS NULL
  THEN
    RAISE EXCEPTION 'Provider event identifiers are required';
  END IF;

  INSERT INTO public.notification_provider_events (
    provider_event_id, provider_event_type, provider_message_id,
    occurred_at, safe_event_data
  )
  VALUES (
    p_provider_event_id, p_provider_event_type, p_provider_message_id,
    coalesce(p_event_occurred_at, now()), coalesce(p_provider_event_data, '{}'::jsonb)
  )
  ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING id INTO v_inserted_id;
  IF v_inserted_id IS NULL THEN
    RETURN false;
  END IF;

  v_outcome := CASE
    WHEN p_provider_event_type = 'email.delivered' THEN 'confirmed_delivered'
    ELSE 'confirmed_failed'
  END;

  SELECT delivery.id
    INTO v_delivery_id
  FROM public.notification_deliveries AS delivery
  WHERE delivery.provider_message_id = p_provider_message_id
  FOR UPDATE;

  IF v_delivery_id IS NOT NULL THEN
    INSERT INTO public.notification_delivery_attempts (
      delivery_id, outcome, attempted_at, safe_error_metadata
    )
    VALUES (
      v_delivery_id, v_outcome, coalesce(p_event_occurred_at, now()),
      coalesce(p_provider_event_data, '{}'::jsonb)
    );

    UPDATE public.notification_deliveries
    SET status = CASE
          WHEN status = 'delivered' THEN 'delivered'
          WHEN v_outcome = 'confirmed_delivered' THEN 'delivered'
          ELSE 'failed'
        END,
        lease_token = NULL,
        lease_expires_at = NULL,
        completed_at = coalesce(p_event_occurred_at, now()),
        last_error = CASE
          WHEN status = 'delivered' OR v_outcome = 'confirmed_delivered' THEN NULL
          ELSE p_provider_event_type
        END
    WHERE id = v_delivery_id;
  END IF;

  RETURN true;
END;
$record_notification_provider_event$;

CREATE OR REPLACE FUNCTION public.admin_retry_notification_email_delivery(
  p_delivery_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $admin_retry_notification_email_delivery$
DECLARE
  v_actor uuid := private.current_user_id();
  v_admin_grant_id uuid;
  v_delivery public.notification_deliveries%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('connect-daet-admin-role-changes', 0)
  );
  v_admin_grant_id := public.require_active_workflow_grant('admin');

  SELECT delivery.*
    INTO v_delivery
  FROM public.notification_deliveries AS delivery
  WHERE delivery.id = p_delivery_id
    AND delivery.channel = 'email'
  FOR UPDATE;
  IF NOT FOUND OR v_delivery.status <> 'failed' OR v_delivery.attempt_count >= 6 THEN
    RETURN false;
  END IF;

  UPDATE public.notification_deliveries
  SET status = 'queued',
      next_attempt_at = now(),
      completed_at = NULL,
      last_error = NULL
  WHERE id = p_delivery_id;

  INSERT INTO public.audit_events (
    actor_profile_id, role_grant_id, submission_id, event_kind, details
  )
  SELECT v_actor, v_admin_grant_id, notification.submission_id,
    'notification_email_retry_requested',
    pg_catalog.jsonb_build_object('delivery_id', p_delivery_id)
  FROM public.notifications AS notification
  WHERE notification.id = v_delivery.notification_id;

  RETURN true;
END;
$admin_retry_notification_email_delivery$;

ALTER FUNCTION public.can_read_message_thread(uuid)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.open_submission_message_thread(uuid, public.thread_visibility)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.send_submission_message(uuid, text, jsonb, text)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.mark_submission_message_thread_read(uuid)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.get_authorized_attachment_object_key(uuid)
  OWNER TO connect_daet_workflow_executor;

ALTER FUNCTION public.claim_notification_email_deliveries(uuid, integer)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.complete_notification_email_delivery(uuid, uuid, text, text, text, timestamptz)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.record_notification_provider_event(text, text, text, timestamptz, jsonb)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.admin_retry_notification_email_delivery(uuid)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.admin_grant_workflow_role(uuid, public.workflow_role, text)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.admin_revoke_workflow_role(uuid, text)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.admin_grant_office_membership(uuid, uuid, text)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.admin_revoke_office_membership(uuid, text)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.admin_create_office(text, text)
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.admin_set_office_active(uuid, boolean, text)
  OWNER TO connect_daet_workflow_executor;

REVOKE ALL ON FUNCTION public.open_submission_message_thread(uuid, public.thread_visibility)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.send_submission_message(uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_submission_message_thread_read(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_authorized_attachment_object_key(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_notification_email_deliveries(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_notification_email_delivery(uuid, uuid, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_notification_provider_event(text, text, text, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_retry_notification_email_delivery(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_grant_workflow_role(uuid, public.workflow_role, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_revoke_workflow_role(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_grant_office_membership(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_revoke_office_membership(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_create_office(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_set_office_active(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.open_submission_message_thread(uuid, public.thread_visibility)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_submission_message(uuid, text, jsonb, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_submission_message_thread_read(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_authorized_attachment_object_key(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_email_deliveries(uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_notification_email_delivery(uuid, uuid, text, text, text, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_notification_provider_event(text, text, text, timestamptz, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_retry_notification_email_delivery(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_workflow_role(uuid, public.workflow_role, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_workflow_role(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_office_membership(uuid, uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_office_membership(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_office(text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_office_active(uuid, boolean, text)
  TO authenticated;

COMMIT;
