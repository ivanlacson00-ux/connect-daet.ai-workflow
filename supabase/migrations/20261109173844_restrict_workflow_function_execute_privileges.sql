-- Remove unintended client execution from workflow functions while preserving
-- authenticated entry points, necessary service_role access, and executor ownership.
-- postgres has ADMIN OPTION on the executor role but no SET membership after
-- the original migrations, so temporarily enable SET to change owner ACLs.

BEGIN;

DO $prepare_executor_membership$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'This migration must be applied as postgres';
  END IF;

  IF NOT pg_catalog.pg_has_role(
    current_user, 'connect_daet_workflow_executor', 'SET'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      WHERE membership.roleid = 'connect_daet_workflow_executor'::regrole
        AND membership.member = current_user::regrole
        AND membership.admin_option
    ) THEN
      RAISE EXCEPTION
        'postgres needs ADMIN OPTION on connect_daet_workflow_executor';
    END IF;

    EXECUTE 'GRANT connect_daet_workflow_executor TO postgres WITH SET TRUE, INHERIT FALSE';
    PERFORM pg_catalog.set_config(
      'connect_daet.restore_executor_set_membership', 'true', true
    );
  END IF;
END;
$prepare_executor_membership$;

-- PostgreSQL's built-in default grants PUBLIC EXECUTE. Remove it globally for
-- functions created as postgres, and remove the public-schema anon/auth grants.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

SET LOCAL ROLE connect_daet_workflow_executor;

-- Function defaults belong to the creating role, not the eventual owner.
-- Remove PostgreSQL's implicit PUBLIC grant for functions created directly by
-- the executor role; postgres's defaults do not apply to those functions.
ALTER DEFAULT PRIVILEGES FOR ROLE connect_daet_workflow_executor
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE ALL ON FUNCTION public.can_read_assignment(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_attachment(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_message(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_message_thread(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_responsibility(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_review_cycle(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_review_response(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_submission(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_submission_version(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_workflow_idempotency(
  uuid, text, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_workflow_idempotency(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_response_applicability(
  uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_routing_plan(
  uuid, public.routing_mode, jsonb, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_submission(
  text, text, uuid, text, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_workflow_tracking_number()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.maintain_submission_tracking_number()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_officer_response_review(
  uuid, text, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_overall_decision(
  uuid, uuid, public.decision_stage, public.overall_decision_kind,
  text, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.require_active_workflow_grant(
  public.workflow_role
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resubmit_submission(
  uuid, uuid, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revise_office_responsibility(
  uuid, uuid, uuid, public.responsibility_type, text, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_responsibility_reassessment(
  uuid, uuid, uuid[], jsonb, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_office_response(
  uuid, text, text, text, uuid[], text
) FROM PUBLIC, anon, authenticated;

-- These scoped read helpers are explicitly granted to authenticated by
-- migration 5; policies also invoke them while evaluating authenticated reads.
GRANT EXECUTE ON FUNCTION public.can_read_assignment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_attachment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_message_thread(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_responsibility(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_review_cycle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_review_response(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_submission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_submission_version(uuid, uuid)
  TO authenticated;

-- These nine checked operations are the authenticated client entry points.
GRANT EXECUTE ON FUNCTION public.confirm_response_applicability(
  uuid, uuid, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_routing_plan(
  uuid, public.routing_mode, jsonb, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_submission(
  text, text, uuid, text, text, jsonb, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_officer_response_review(
  uuid, text, text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_overall_decision(
  uuid, uuid, public.decision_stage, public.overall_decision_kind,
  text, text, jsonb, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_submission(
  uuid, uuid, text, jsonb, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revise_office_responsibility(
  uuid, uuid, uuid, public.responsibility_type, text, text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_responsibility_reassessment(
  uuid, uuid, uuid[], jsonb, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_office_response(
  uuid, text, text, text, uuid[], text
) TO authenticated;

-- Preserve service_role access to the scoped helpers and checked operations.
-- Internal helpers and trigger functions are called by executor-owned
-- SECURITY DEFINER functions or existing triggers, not by direct RPC.
GRANT EXECUTE ON FUNCTION public.can_read_assignment(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_read_attachment(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_read_message(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_read_message_thread(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_read_responsibility(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_read_review_cycle(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_read_review_response(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_read_submission(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_read_submission_version(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_response_applicability(
  uuid, uuid, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_routing_plan(
  uuid, public.routing_mode, jsonb, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_submission(
  text, text, uuid, text, text, jsonb, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_officer_response_review(
  uuid, text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_overall_decision(
  uuid, uuid, public.decision_stage, public.overall_decision_kind,
  text, text, jsonb, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.resubmit_submission(
  uuid, uuid, text, jsonb, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.revise_office_responsibility(
  uuid, uuid, uuid, public.responsibility_type, text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_responsibility_reassessment(
  uuid, uuid, uuid[], jsonb, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_office_response(
  uuid, text, text, text, uuid[], text
) TO service_role;

RESET ROLE;

DO $restore_executor_membership$
BEGIN
  IF pg_catalog.current_setting(
    'connect_daet.restore_executor_set_membership', true
  ) = 'true' THEN
    -- The temporary membership was granted by postgres; revoke only that
    -- membership and leave the original supabase_admin-granted ADMIN membership untouched.
    EXECUTE 'REVOKE connect_daet_workflow_executor FROM postgres';
  END IF;
END;
$restore_executor_membership$;

COMMIT;
