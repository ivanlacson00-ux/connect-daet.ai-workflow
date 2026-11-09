-- Clean CONNECT-Daet.ai schema, migration 5.
-- Client roles receive scoped SELECT and the notification read marker only.
-- Workflow writes are exposed through checked SECURITY DEFINER operations whose
-- owner is a NOLOGIN, NOBYPASSRLS role with no DELETE privileges.

BEGIN;

CREATE FUNCTION public.can_read_submission(p_submission_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $can_read_submission$
  SELECT EXISTS (
    SELECT 1
    FROM public.submissions AS s
    WHERE s.id = p_submission_id
      AND (
        s.submitter_profile_id = private.current_user_id()
        OR EXISTS (
          SELECT 1
          FROM public.role_grants AS rg
          WHERE rg.profile_id = private.current_user_id()
            AND rg.role = 'approver'
            AND rg.revoked_at IS NULL
        )
        OR EXISTS (
          SELECT 1
          FROM public.office_assignments AS assignment
          JOIN public.office_memberships AS membership
            ON membership.office_id = assignment.office_id
          JOIN public.role_grants AS role_grant
            ON role_grant.profile_id = membership.profile_id
          WHERE assignment.submission_id = s.id
            AND assignment.cancelled_at IS NULL
            AND membership.profile_id = private.current_user_id()
            AND membership.ended_at IS NULL
            AND role_grant.role = 'external_approver'
            AND role_grant.revoked_at IS NULL
        )
      )
  );
$can_read_submission$;

CREATE FUNCTION public.can_read_assignment(p_assignment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $can_read_assignment$
  SELECT EXISTS (
    SELECT 1
    FROM public.office_assignments AS oa
    JOIN public.submissions AS s ON s.id = oa.submission_id
    WHERE oa.id = p_assignment_id
      AND (
        EXISTS (
          SELECT 1 FROM public.role_grants AS rg
          WHERE rg.profile_id = private.current_user_id()
            AND rg.role = 'approver' AND rg.revoked_at IS NULL
        )
        OR (
          oa.cancelled_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM public.office_memberships AS om
            JOIN public.role_grants AS rg ON rg.profile_id = om.profile_id
            WHERE om.profile_id = private.current_user_id()
              AND om.office_id = oa.office_id
              AND om.ended_at IS NULL
              AND rg.role = 'external_approver'
              AND rg.revoked_at IS NULL
          )
        )
      )
  );
$can_read_assignment$;

CREATE FUNCTION public.can_read_submission_version(
  p_submission_id uuid,
  p_version_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $can_read_submission_version$
  SELECT EXISTS (
    SELECT 1
    FROM public.submission_versions AS sv
    JOIN public.submissions AS s ON s.id = sv.submission_id
    WHERE sv.submission_id = p_submission_id
      AND sv.id = p_version_id
      AND (
        s.submitter_profile_id = private.current_user_id()
        OR EXISTS (
          SELECT 1 FROM public.role_grants AS rg
          WHERE rg.profile_id = private.current_user_id()
            AND rg.role = 'approver' AND rg.revoked_at IS NULL
        )
        OR EXISTS (
          SELECT 1
          FROM public.review_cycles AS rc
          JOIN public.office_assignments AS oa
            ON oa.id = rc.assignment_id AND oa.submission_id = rc.submission_id
          JOIN public.office_memberships AS om ON om.office_id = oa.office_id
          JOIN public.role_grants AS rg ON rg.profile_id = om.profile_id
          WHERE rc.submission_id = sv.submission_id
            AND rc.submission_version_id = sv.id
            AND oa.cancelled_at IS NULL
            AND om.profile_id = private.current_user_id()
            AND om.ended_at IS NULL
            AND rg.role = 'external_approver'
            AND rg.revoked_at IS NULL
        )
      )
  );
$can_read_submission_version$;

CREATE FUNCTION public.can_read_attachment(p_attachment_id uuid)
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
      )
  );
$can_read_attachment$;

CREATE FUNCTION public.can_read_responsibility(p_responsibility_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $can_read_responsibility$
  SELECT EXISTS (
    SELECT 1 FROM public.office_responsibilities AS r
    WHERE r.id = p_responsibility_id
      AND public.can_read_assignment(r.assignment_id)
  );
$can_read_responsibility$;

CREATE FUNCTION public.can_read_review_cycle(p_review_cycle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $can_read_review_cycle$
  SELECT EXISTS (
    SELECT 1 FROM public.review_cycles AS rc
    WHERE rc.id = p_review_cycle_id
      AND public.can_read_assignment(rc.assignment_id)
  );
$can_read_review_cycle$;

CREATE FUNCTION public.can_read_review_response(p_response_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $can_read_review_response$
  SELECT EXISTS (
    SELECT 1 FROM public.review_responses AS response
    WHERE response.id = p_response_id
      AND public.can_read_review_cycle(response.review_cycle_id)
  );
$can_read_review_response$;

CREATE FUNCTION public.can_read_message_thread(p_thread_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $can_read_message_thread$
  SELECT EXISTS (
    SELECT 1
    FROM public.message_threads AS mt
    JOIN public.thread_participants AS tp ON tp.thread_id = mt.id
    WHERE mt.id = p_thread_id
      AND mt.visibility = 'participants'
      AND tp.profile_id = private.current_user_id()
      AND tp.ended_at IS NULL
      AND public.can_read_submission(mt.submission_id)
  );
$can_read_message_thread$;

CREATE FUNCTION public.can_read_message(p_message_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $can_read_message$
  SELECT EXISTS (
    SELECT 1 FROM public.messages AS message
    WHERE message.id = p_message_id
      AND public.can_read_message_thread(message.thread_id)
  );
$can_read_message$;

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

ALTER FUNCTION public.generate_workflow_tracking_number()
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.maintain_submission_tracking_number()
  OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.can_read_submission(uuid) OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.can_read_assignment(uuid) OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.can_read_submission_version(uuid, uuid) OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.can_read_attachment(uuid) OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.can_read_responsibility(uuid) OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.can_read_review_cycle(uuid) OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.can_read_review_response(uuid) OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.can_read_message_thread(uuid) OWNER TO connect_daet_workflow_executor;
ALTER FUNCTION public.can_read_message(uuid) OWNER TO connect_daet_workflow_executor;
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

REVOKE ALL ON FUNCTION public.can_read_submission(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_assignment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_submission_version(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_attachment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_responsibility(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_review_cycle(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_review_response(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_message_thread(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_submission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_assignment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_submission_version(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_attachment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_responsibility(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_review_cycle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_review_response(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_message_thread(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_message(uuid) TO authenticated;

CREATE FUNCTION public.reject_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $reject_history_mutation$
BEGIN
  RAISE EXCEPTION 'Append-only workflow history cannot be changed';
END;
$reject_history_mutation$;
REVOKE ALL ON FUNCTION public.reject_history_mutation() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.prevent_mandatory_assignment_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $prevent_mandatory_assignment_cancellation$
BEGIN
  IF OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.office_responsibilities AS responsibility
      JOIN LATERAL (
        SELECT revision.responsibility_type
        FROM public.office_responsibility_revisions AS revision
        WHERE revision.responsibility_id = responsibility.id
        ORDER BY revision.revision_number DESC
        LIMIT 1
      ) AS latest_revision ON true
      WHERE responsibility.submission_id = OLD.submission_id
        AND responsibility.assignment_id = OLD.id
        AND latest_revision.responsibility_type = 'mandatory_approval'
    )
  THEN
    RAISE EXCEPTION 'An assignment with a mandatory responsibility cannot be cancelled';
  END IF;
  RETURN NEW;
END;
$prevent_mandatory_assignment_cancellation$;
REVOKE ALL ON FUNCTION public.prevent_mandatory_assignment_cancellation()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER prevent_mandatory_assignment_cancellation
BEFORE UPDATE OF cancelled_at ON public.office_assignments
FOR EACH ROW
EXECUTE FUNCTION public.prevent_mandatory_assignment_cancellation();

DO $install_history_guards$
DECLARE
  table_name text;
  history_tables text[] := ARRAY[
    'role_grant_events',
    'office_membership_events',
    'submission_versions',
    'submission_version_attachments',
    'attachments',
    'routing_rounds',
    'office_assignment_events',
    'office_responsibility_revisions',
    'office_responsibility_events',
    'responsibility_resolutions',
    'review_cycle_events',
    'review_responses',
    'review_response_attachments',
    'tourism_officer_response_reviews',
    'response_applicability',
    'response_applicability_events',
    'submission_decisions',
    'submission_status_history',
    'decision_attachment_links',
    'decision_response_links',
    'decision_officer_review_links',
    'decision_applicability_links',
    'messages',
    'message_attachments',
    'notification_delivery_attempts',
    'audit_events',
    'points_ledger'
  ];
BEGIN
  FOREACH table_name IN ARRAY history_tables LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.reject_history_mutation()',
      table_name || '_append_only_guard',
      table_name
    );
  END LOOP;
END;
$install_history_guards$;

DO $enable_rls$
DECLARE
  table_name text;
  workflow_tables text[] := ARRAY[
    'document_types',
    'workflow_tracking_sequences',
    'submissions',
    'submission_versions',
    'attachments',
    'submission_version_attachments',
    'routing_rounds',
    'office_assignments',
    'office_assignment_events',
    'office_responsibility_authorities',
    'office_responsibilities',
    'office_responsibility_revisions',
    'office_responsibility_events',
    'responsibility_resolutions',
    'review_cycles',
    'review_cycle_events',
    'review_responses',
    'review_response_attachments',
    'tourism_officer_response_reviews',
    'response_applicability',
    'response_applicability_events',
    'submission_decisions',
    'submission_status_history',
    'decision_attachment_links',
    'decision_response_links',
    'decision_officer_review_links',
    'decision_applicability_links',
    'message_threads',
    'thread_participants',
    'messages',
    'message_attachments',
    'notifications',
    'notification_deliveries',
    'notification_delivery_attempts',
    'audit_events',
    'idempotency_keys',
    'points_ledger'
  ];
BEGIN
  FOREACH table_name IN ARRAY workflow_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I TO connect_daet_workflow_executor '
      'USING (true) WITH CHECK (true)',
      table_name || '_executor_access',
      table_name
    );
  END LOOP;
END;
$enable_rls$;

CREATE POLICY document_types_active_read ON public.document_types
  FOR SELECT TO authenticated USING (is_active);

CREATE POLICY submissions_scoped_read ON public.submissions
  FOR SELECT TO authenticated USING (public.can_read_submission(id));

CREATE POLICY submission_versions_scoped_read ON public.submission_versions
  FOR SELECT TO authenticated
  USING (public.can_read_submission_version(submission_id, id));

CREATE POLICY attachments_scoped_metadata_read ON public.attachments
  FOR SELECT TO authenticated USING (public.can_read_attachment(id));

CREATE POLICY version_attachment_scoped_read ON public.submission_version_attachments
  FOR SELECT TO authenticated
  USING (public.can_read_submission_version(submission_id, submission_version_id));

CREATE POLICY routing_rounds_scoped_read ON public.routing_rounds
  FOR SELECT TO authenticated
  USING (
    public.has_active_workflow_role('approver')
    OR EXISTS (
      SELECT 1 FROM public.office_assignments AS assignment
      WHERE assignment.routing_round_id = id
        AND public.can_read_assignment(assignment.id)
    )
  );

CREATE POLICY office_assignments_scoped_read ON public.office_assignments
  FOR SELECT TO authenticated USING (public.can_read_assignment(id));

CREATE POLICY office_assignment_events_scoped_read ON public.office_assignment_events
  FOR SELECT TO authenticated USING (public.can_read_assignment(assignment_id));

CREATE POLICY responsibilities_scoped_read ON public.office_responsibilities
  FOR SELECT TO authenticated USING (public.can_read_assignment(assignment_id));

CREATE POLICY responsibility_revisions_scoped_read ON public.office_responsibility_revisions
  FOR SELECT TO authenticated USING (public.can_read_assignment(assignment_id));

CREATE POLICY responsibility_events_scoped_read ON public.office_responsibility_events
  FOR SELECT TO authenticated USING (public.can_read_assignment(assignment_id));

CREATE POLICY responsibility_resolutions_scoped_read ON public.responsibility_resolutions
  FOR SELECT TO authenticated USING (public.has_active_workflow_role('approver'));

CREATE POLICY review_cycles_scoped_read ON public.review_cycles
  FOR SELECT TO authenticated USING (public.can_read_review_cycle(id));

CREATE POLICY review_cycle_events_scoped_read ON public.review_cycle_events
  FOR SELECT TO authenticated USING (public.can_read_review_cycle(review_cycle_id));

CREATE POLICY review_responses_scoped_read ON public.review_responses
  FOR SELECT TO authenticated USING (public.can_read_review_cycle(review_cycle_id));

CREATE POLICY response_attachments_scoped_read ON public.review_response_attachments
  FOR SELECT TO authenticated USING (
    public.can_read_review_response(review_response_id)
    AND public.can_read_attachment(attachment_id)
  );

CREATE POLICY officer_response_reviews_scoped_read ON public.tourism_officer_response_reviews
  FOR SELECT TO authenticated
  USING (
    public.has_active_workflow_role('approver')
    AND public.can_read_submission(submission_id)
  );

CREATE POLICY response_applicability_scoped_read ON public.response_applicability
  FOR SELECT TO authenticated USING (public.has_active_workflow_role('approver'));

CREATE POLICY applicability_events_scoped_read ON public.response_applicability_events
  FOR SELECT TO authenticated USING (public.has_active_workflow_role('approver'));

CREATE POLICY submission_decisions_owner_or_officer_read ON public.submission_decisions
  FOR SELECT TO authenticated
  USING (
    public.has_active_workflow_role('approver')
    OR EXISTS (
      SELECT 1 FROM public.submissions AS s
      WHERE s.id = submission_id AND s.submitter_profile_id = auth.uid()
    )
  );

CREATE POLICY submission_status_history_owner_or_officer_read
  ON public.submission_status_history FOR SELECT TO authenticated
  USING (
    public.has_active_workflow_role('approver')
    OR EXISTS (
      SELECT 1 FROM public.submissions AS s
      WHERE s.id = submission_id AND s.submitter_profile_id = auth.uid()
    )
  );

CREATE POLICY decision_attachment_links_officer_read ON public.decision_attachment_links
  FOR SELECT TO authenticated USING (public.has_active_workflow_role('approver'));
CREATE POLICY decision_response_links_officer_read ON public.decision_response_links
  FOR SELECT TO authenticated USING (public.has_active_workflow_role('approver'));
CREATE POLICY decision_officer_review_links_officer_read
  ON public.decision_officer_review_links
  FOR SELECT TO authenticated USING (public.has_active_workflow_role('approver'));
CREATE POLICY decision_applicability_links_officer_read
  ON public.decision_applicability_links
  FOR SELECT TO authenticated USING (public.has_active_workflow_role('approver'));

CREATE POLICY message_threads_participant_read ON public.message_threads
  FOR SELECT TO authenticated USING (public.can_read_message_thread(id));
CREATE POLICY thread_participants_scoped_read ON public.thread_participants
  FOR SELECT TO authenticated USING (public.can_read_message_thread(thread_id));
CREATE POLICY messages_thread_scoped_read ON public.messages
  FOR SELECT TO authenticated USING (public.can_read_message_thread(thread_id));
CREATE POLICY message_attachments_thread_scoped_read ON public.message_attachments
  FOR SELECT TO authenticated
  USING (
    public.can_read_message(message_id)
    AND public.can_read_attachment(attachment_id)
  );

CREATE POLICY notifications_recipient_read ON public.notifications
  FOR SELECT TO authenticated USING (recipient_profile_id = auth.uid());
CREATE POLICY notifications_recipient_read_state_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_profile_id = auth.uid())
  WITH CHECK (recipient_profile_id = auth.uid());

REVOKE ALL ON public.document_types, public.submissions, public.submission_versions,
  public.workflow_tracking_sequences,
  public.attachments, public.submission_version_attachments, public.routing_rounds,
  public.office_assignments, public.office_assignment_events, public.office_responsibilities,
  public.office_responsibility_authorities,
  public.office_responsibility_revisions, public.office_responsibility_events,
  public.responsibility_resolutions, public.review_cycles, public.review_cycle_events,
  public.review_responses, public.review_response_attachments,
  public.tourism_officer_response_reviews, public.response_applicability,
  public.response_applicability_events, public.submission_decisions,
  public.submission_status_history, public.decision_attachment_links,
  public.decision_response_links, public.decision_officer_review_links,
  public.decision_applicability_links, public.message_threads, public.thread_participants,
  public.messages, public.message_attachments, public.notifications,
  public.notification_deliveries, public.notification_delivery_attempts,
  public.audit_events, public.idempotency_keys, public.points_ledger
  FROM PUBLIC, anon, authenticated;

GRANT SELECT (id, code, name) ON public.document_types TO authenticated;
GRANT SELECT (id, submitter_profile_id, document_type_id, tracking_number, title,
  description, destination_department, state, current_version_id, created_at, updated_at)
  ON public.submissions TO authenticated;
GRANT SELECT (id, submission_id, version_number, uploaded_by_profile_id, description, created_at)
  ON public.submission_versions TO authenticated;
GRANT SELECT (id, submission_id, uploaded_by_profile_id, original_filename, content_type,
  byte_size, created_at) ON public.attachments TO authenticated;
GRANT SELECT (submission_id, submission_version_id, attachment_id, created_at)
  ON public.submission_version_attachments TO authenticated;
GRANT SELECT (id, submission_id, round_number, mode, initiated_by_profile_id, reason, created_at)
  ON public.routing_rounds TO authenticated;
GRANT SELECT (id, submission_id, routing_round_id, office_id, instructions,
  created_by_profile_id, created_at, cancelled_at, cancellation_reason)
  ON public.office_assignments TO authenticated;
GRANT SELECT (id, submission_id, assignment_id, event_kind, actor_profile_id,
  reason, context, created_at) ON public.office_assignment_events TO authenticated;
GRANT SELECT (id, submission_id, assignment_id, responsibility_key, created_at)
  ON public.office_responsibilities TO authenticated;
GRANT SELECT (id, submission_id, assignment_id, responsibility_id, revision_number,
  responsibility_type, scope, instructions, actor_profile_id, reason, created_at)
  ON public.office_responsibility_revisions TO authenticated;
GRANT SELECT (id, submission_id, assignment_id, responsibility_id,
  responsibility_revision_id, event_kind, actor_profile_id, reason, context, created_at)
  ON public.office_responsibility_events TO authenticated;
GRANT SELECT (id, submission_id, assignment_id, responsibility_id,
  responsibility_revision_id, submission_version_id, resolution_kind, reason, created_at)
  ON public.responsibility_resolutions TO authenticated;
GRANT SELECT (id, submission_id, assignment_id, office_id, responsibility_id,
  submission_version_id, responsibility_revision_id, cycle_number, created_at)
  ON public.review_cycles TO authenticated;
GRANT SELECT (id, submission_id, review_cycle_id, event_kind, actor_profile_id,
  reason, context, created_at) ON public.review_cycle_events TO authenticated;
GRANT SELECT (id, submission_id, review_cycle_id, assignment_id, office_id,
  responsibility_id, submission_version_id, responsibility_revision_id,
  submitted_by_profile_id, outcome, findings, remarks, submitted_at)
  ON public.review_responses TO authenticated;
GRANT SELECT (submission_id, review_response_id, attachment_id, created_at)
  ON public.review_response_attachments TO authenticated;
GRANT SELECT (id, submission_id, review_response_id, actor_profile_id, disposition,
  reason, notes, created_at) ON public.tourism_officer_response_reviews TO authenticated;
GRANT SELECT (id, submission_id, responsibility_id, original_response_id,
  target_submission_version_id, target_responsibility_revision_id, reason, confirmed_at)
  ON public.response_applicability TO authenticated;
GRANT SELECT (id, submission_id, applicability_id, event_kind, reason, created_at)
  ON public.response_applicability_events TO authenticated;
GRANT SELECT (id, submission_id, submission_version_id, decision_kind, stage,
  reason, correction_instructions, created_at) ON public.submission_decisions TO authenticated;
GRANT SELECT (id, submission_id, previous_state, new_state, decision_id, cause_code,
  reason, created_at) ON public.submission_status_history TO authenticated;
GRANT SELECT (submission_id, decision_id, attachment_id, created_at)
  ON public.decision_attachment_links TO authenticated;
GRANT SELECT (submission_id, decision_id, review_response_id, created_at)
  ON public.decision_response_links TO authenticated;
GRANT SELECT (submission_id, decision_id, officer_response_review_id, created_at)
  ON public.decision_officer_review_links TO authenticated;
GRANT SELECT (submission_id, decision_id, applicability_id, created_at)
  ON public.decision_applicability_links TO authenticated;
GRANT SELECT (id, submission_id, visibility, created_by_profile_id, created_at)
  ON public.message_threads TO authenticated;
GRANT SELECT (id, submission_id, thread_id, profile_id, added_by_profile_id,
  participation_basis, started_at, ended_at, removal_reason)
  ON public.thread_participants TO authenticated;
GRANT SELECT (id, submission_id, thread_id, author_profile_id, body, created_at)
  ON public.messages TO authenticated;
GRANT SELECT (submission_id, message_id, attachment_id, created_at)
  ON public.message_attachments TO authenticated;
GRANT SELECT (id, recipient_profile_id, submission_id, decision_id, event_key,
  title, message, created_at, read_at) ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;

GRANT SELECT ON public.document_types, public.submissions, public.submission_versions,
  public.workflow_tracking_sequences,
  public.attachments, public.submission_version_attachments, public.routing_rounds,
  public.office_assignments, public.office_assignment_events,
  public.office_responsibility_authorities, public.office_responsibilities,
  public.office_responsibility_revisions, public.office_responsibility_events,
  public.responsibility_resolutions, public.review_cycles, public.review_cycle_events,
  public.review_responses, public.review_response_attachments,
  public.tourism_officer_response_reviews, public.response_applicability,
  public.response_applicability_events, public.submission_decisions,
  public.submission_status_history, public.decision_attachment_links,
  public.decision_response_links, public.decision_officer_review_links,
  public.decision_applicability_links, public.message_threads, public.thread_participants,
  public.messages, public.message_attachments, public.notifications,
  public.notification_deliveries, public.notification_delivery_attempts,
  public.audit_events, public.idempotency_keys, public.points_ledger
  TO connect_daet_workflow_executor;

GRANT INSERT ON public.submission_versions, public.attachments,
  public.submission_version_attachments, public.routing_rounds,
  public.office_assignments, public.office_assignment_events,
  public.office_responsibilities, public.office_responsibility_revisions,
  public.office_responsibility_events, public.review_cycles,
  public.review_cycle_events, public.review_responses,
  public.review_response_attachments, public.tourism_officer_response_reviews,
  public.response_applicability, public.submission_decisions,
  public.decision_attachment_links, public.decision_response_links,
  public.decision_officer_review_links, public.decision_applicability_links,
  public.submission_status_history, public.notifications, public.audit_events
  TO connect_daet_workflow_executor;
GRANT UPDATE (result_id, completed_at) ON public.idempotency_keys
  TO connect_daet_workflow_executor;

COMMIT;
