-- REVISED SECURITY HARDENING MIGRATION — TEST Supabase project only.
-- Apply only after the TEST preflight has passed and the exact target project
-- has been confirmed. This file is the migration only; it contains no
-- preflight or post-deployment verification queries.
--
-- Offline approval evidence security and access policies are deferred pending
-- institutional consultation. This migration does not access or modify
-- approval_steps.evidence_file_path or any Storage policy.
--
-- Direct authenticated UPDATE is deliberately retained because existing
-- application pages still write legacy review decisions directly.
--
-- Do not combine with the superseded 20261105_01 proposal.

BEGIN;

-- 1. Archive authorization must reject missing users, non-admins, and NULL
-- should_archive rather than treating NULL as an implicit unarchive request.
CREATE OR REPLACE FUNCTION public.set_workflow_submission_archive(
  target_submission_id uuid,
  should_archive boolean,
  retention_date timestamptz DEFAULT NULL
)
RETURNS public.workflow_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text;
  result public.workflow_submissions;
BEGIN
  IF should_archive IS NULL THEN
    RAISE EXCEPTION 'Archive action must be specified';
  END IF;

  SELECT profile.role
    INTO actor_role
  FROM public.profiles AS profile
  WHERE profile.id = actor_id;

  IF actor_id IS NULL OR actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an authenticated administrator can change archive status';
  END IF;

  UPDATE public.workflow_submissions
  SET archived_at = CASE
        WHEN should_archive THEN COALESCE(archived_at, now())
        ELSE NULL
      END,
      archived_by = CASE WHEN should_archive THEN actor_id ELSE NULL END,
      retention_until = CASE WHEN should_archive THEN retention_date ELSE NULL END
  WHERE id = target_submission_id
  RETURNING * INTO result;

  IF result.id IS NULL THEN
    RAISE EXCEPTION 'Workflow submission does not exist';
  END IF;

  INSERT INTO public.workflow_audit_logs (
    submission_id,
    action_by,
    action_type,
    comments
  )
  VALUES (
    result.id,
    actor_id,
    CASE WHEN should_archive THEN 'ARCHIVED' ELSE 'UNARCHIVED' END,
    CASE WHEN should_archive
      THEN 'Retention until ' || COALESCE(retention_date::text, 'not specified')
      ELSE 'Archive access restored'
    END
  );

  RETURN result;
END;
$function$;

-- The admin archive pages call this RPC as an authenticated user. Remove
-- inherited PUBLIC and anonymous execution, then grant only authenticated.
REVOKE ALL ON FUNCTION public.set_workflow_submission_archive(uuid, boolean, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_workflow_submission_archive(uuid, boolean, timestamptz)
  TO authenticated;

-- 2. generate_workflow_tracking_number() is a SECURITY DEFINER scalar function
-- returning text; it is not the trigger function. submit_document() calls it
-- directly, and the insert trigger helper calls it as a fallback when the
-- tracking number is blank. Pin both paths and remove direct client execution.
ALTER FUNCTION public.set_workflow_submission_tracking_number()
  SECURITY DEFINER;
ALTER FUNCTION public.set_workflow_submission_tracking_number()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.generate_workflow_tracking_number()
  SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.generate_workflow_tracking_number()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_workflow_submission_tracking_number()
  FROM PUBLIC, anon, authenticated;

-- 3. Preserve role-to-app-metadata synchronization while pinning name lookup.
-- The profiles role-update trigger calls this function; application clients
-- do not need to invoke it directly.
ALTER FUNCTION public.sync_role_to_app_metadata()
  SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.sync_role_to_app_metadata()
  FROM PUBLIC, anon, authenticated;

-- 4. Submission creation uses submit_document(), not direct application INSERT.
-- The inspected TEST definition obtains auth.uid() through
-- workflow_require_actor(), requires a matching profile, rejects the
-- external_approver role, validates an active destination department, and
-- inserts user_id = actor. Do not alter the RPC or its owner privileges here.
--
-- Remove direct client INSERT and DELETE. Remove anonymous UPDATE, but preserve
-- authenticated UPDATE until the legacy review UI is migrated to authorized
-- RPCs.
REVOKE INSERT, DELETE ON TABLE public.workflow_submissions
  FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON TABLE public.workflow_submissions
  FROM PUBLIC, anon;

COMMIT;
