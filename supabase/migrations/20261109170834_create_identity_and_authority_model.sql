-- Clean CONNECT-Daet.ai schema, migration 1.
-- One-shot migration: review and apply once through an explicitly authorized process.
-- Privileged role grants and office-membership grantor authority remain unresolved;
-- this migration deliberately provides no client operation to create or revoke them.

BEGIN;

DO $require_postgres_migration_role$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'This migration must run as postgres';
  END IF;
END;
$require_postgres_migration_role$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TYPE public.workflow_role AS ENUM (
  'user',
  'approver',
  'external_approver',
  'admin'
);

CREATE TYPE public.responsibility_type AS ENUM (
  'mandatory_approval',
  'evaluation',
  'recommendation'
);

CREATE TYPE public.routing_mode AS ENUM (
  'simultaneous',
  'one_at_a_time'
);

CREATE TYPE public.submission_state AS ENUM (
  'draft',
  'initial_review',
  'office_review',
  'returned',
  'approved',
  'rejected'
);

CREATE TYPE public.overall_decision_kind AS ENUM (
  'approved',
  'returned',
  'rejected'
);

CREATE TYPE public.decision_stage AS ENUM (
  'initial_review',
  'final_review'
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles OWNER TO postgres;

CREATE TABLE public.role_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  role public.workflow_role NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by_profile_id uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
  authorizing_role_grant_id uuid REFERENCES public.role_grants (id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revoked_by_profile_id uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
  revocation_reason text,
  CONSTRAINT role_grants_revocation_shape_check CHECK (
    (revoked_at IS NULL AND revoked_by_profile_id IS NULL AND revocation_reason IS NULL)
    OR
    (revoked_at IS NOT NULL AND revoked_by_profile_id IS NOT NULL
      AND nullif(btrim(revocation_reason), '') IS NOT NULL
      AND revoked_at >= granted_at)
  ),
  CONSTRAINT role_grants_grantor_shape_check CHECK (
    (role = 'user' AND granted_by_profile_id IS NULL AND authorizing_role_grant_id IS NULL)
    OR
    (role <> 'user' AND granted_by_profile_id IS NOT NULL
      AND authorizing_role_grant_id IS NOT NULL)
  ),
  CONSTRAINT role_grants_id_profile_unique UNIQUE (id, profile_id),
  CONSTRAINT role_grants_id_role_unique UNIQUE (id, role),
  CONSTRAINT role_grants_id_profile_role_unique UNIQUE (id, profile_id, role)
);

CREATE UNIQUE INDEX role_grants_one_active_role_per_profile_idx
  ON public.role_grants (profile_id, role)
  WHERE revoked_at IS NULL;

CREATE INDEX role_grants_profile_history_idx
  ON public.role_grants (profile_id, granted_at DESC);

CREATE TABLE public.role_grant_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_grant_id uuid NOT NULL REFERENCES public.role_grants (id) ON DELETE RESTRICT,
  event_kind text NOT NULL CHECK (event_kind IN ('granted', 'revoked')),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_grant_events_revocation_reason_check CHECK (
    event_kind <> 'revoked' OR nullif(btrim(reason), '') IS NOT NULL
  )
);

CREATE INDEX role_grant_events_grant_history_idx
  ON public.role_grant_events (role_grant_id, created_at, id);

CREATE TABLE public.offices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (nullif(btrim(code), '') IS NOT NULL),
  name text NOT NULL CHECK (nullif(btrim(name), '') IS NOT NULL),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.office_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  office_id uuid NOT NULL REFERENCES public.offices (id) ON DELETE RESTRICT,
  granted_by_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  authorizing_admin_grant_id uuid NOT NULL REFERENCES public.role_grants (id) ON DELETE RESTRICT,
  authorizing_grant_role public.workflow_role NOT NULL DEFAULT 'admin'
    CHECK (authorizing_grant_role = 'admin'),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_by_profile_id uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
  end_reason text,
  CONSTRAINT office_memberships_end_shape_check CHECK (
    (ended_at IS NULL AND ended_by_profile_id IS NULL AND end_reason IS NULL)
    OR
    (ended_at IS NOT NULL AND ended_by_profile_id IS NOT NULL
      AND nullif(btrim(end_reason), '') IS NOT NULL AND ended_at >= started_at)
  ),
  CONSTRAINT office_memberships_authorizing_admin_fk
    FOREIGN KEY (authorizing_admin_grant_id, granted_by_profile_id, authorizing_grant_role)
    REFERENCES public.role_grants (id, profile_id, role) ON DELETE RESTRICT,
  CONSTRAINT office_memberships_id_profile_office_unique UNIQUE (id, profile_id, office_id)
);

CREATE UNIQUE INDEX office_memberships_one_active_per_profile_office_idx
  ON public.office_memberships (profile_id, office_id)
  WHERE ended_at IS NULL;

CREATE INDEX office_memberships_office_active_idx
  ON public.office_memberships (office_id, profile_id)
  WHERE ended_at IS NULL;

CREATE TABLE public.office_membership_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES public.office_memberships (id) ON DELETE RESTRICT,
  event_kind text NOT NULL CHECK (event_kind IN ('granted', 'revoked')),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT office_membership_events_revocation_reason_check CHECK (
    event_kind <> 'revoked' OR nullif(btrim(reason), '') IS NOT NULL
  )
);

CREATE INDEX office_membership_events_membership_history_idx
  ON public.office_membership_events (membership_id, created_at, id);

-- The executor is NOLOGIN and cannot bypass RLS. Only narrowly scoped, reviewed
-- SECURITY DEFINER operations may be owned by it in later migrations.
DO $create_executor_role$
DECLARE
  executor_role record;
BEGIN
  SELECT r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
    r.rolinherit, r.rolbypassrls
  INTO executor_role
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = 'connect_daet_workflow_executor';

  IF NOT FOUND THEN
    EXECUTE 'CREATE ROLE connect_daet_workflow_executor NOLOGIN NOSUPERUSER '
      || 'NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS';
  ELSIF executor_role.rolcanlogin OR executor_role.rolsuper
    OR executor_role.rolcreatedb OR executor_role.rolcreaterole
    OR executor_role.rolinherit OR executor_role.rolbypassrls
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS role_row
        ON role_row.oid = membership.roleid
      JOIN pg_catalog.pg_roles AS member_row
        ON member_row.oid = membership.member
      WHERE role_row.rolname = 'connect_daet_workflow_executor'
        OR member_row.rolname = 'connect_daet_workflow_executor'
    )
  THEN
    RAISE EXCEPTION 'Existing workflow executor role is not a clean NOLOGIN role';
  END IF;
END;
$create_executor_role$;

CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres;
DO $verify_private_schema_owner$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS n
    JOIN pg_catalog.pg_roles AS r ON r.oid = n.nspowner
    WHERE n.nspname = 'private' AND r.rolname = 'postgres'
  ) THEN
    RAISE EXCEPTION 'The private schema must be owned by postgres';
  END IF;
END;
$verify_private_schema_owner$;
REVOKE ALL ON SCHEMA private
  FROM PUBLIC, anon, authenticated, connect_daet_workflow_executor;
GRANT USAGE ON SCHEMA private TO connect_daet_workflow_executor;

CREATE FUNCTION private.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $current_user_id$
  SELECT auth.uid();
$current_user_id$;
ALTER FUNCTION private.current_user_id() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.current_user_id()
  FROM PUBLIC, anon, authenticated, connect_daet_workflow_executor;
GRANT EXECUTE ON FUNCTION private.current_user_id()
  TO connect_daet_workflow_executor;

REVOKE ALL ON public.profiles, public.role_grants, public.role_grant_events,
  public.office_memberships
  FROM connect_daet_workflow_executor;
GRANT SELECT ON public.role_grants TO connect_daet_workflow_executor;
GRANT SELECT ON public.office_memberships TO connect_daet_workflow_executor;
GRANT USAGE ON SCHEMA public, extensions TO connect_daet_workflow_executor;
GRANT EXECUTE ON FUNCTION extensions.digest(bytea, text)
  TO connect_daet_workflow_executor;

CREATE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $handle_new_user$
DECLARE
  new_role_grant_id uuid;
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.role_grants (profile_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING
  RETURNING id INTO new_role_grant_id;

  IF new_role_grant_id IS NOT NULL THEN
    INSERT INTO public.role_grant_events (role_grant_id, event_kind, actor_profile_id)
    VALUES (new_role_grant_id, 'granted', NEW.id);
  END IF;

  RETURN NEW;
END;
$handle_new_user$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created_connect_daet
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

CREATE FUNCTION public.has_active_workflow_role(p_role public.workflow_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, auth
AS $has_active_workflow_role$
  SELECT EXISTS (
    SELECT 1
    FROM public.role_grants AS rg
    WHERE rg.profile_id = auth.uid()
      AND rg.role = p_role
      AND rg.revoked_at IS NULL
  );
$has_active_workflow_role$;

CREATE FUNCTION public.has_active_office_membership(p_office_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, auth
AS $has_active_office_membership$
  SELECT EXISTS (
    SELECT 1
    FROM public.office_memberships AS om
    WHERE om.profile_id = auth.uid()
      AND om.office_id = p_office_id
      AND om.ended_at IS NULL
  );
$has_active_office_membership$;

REVOKE ALL ON FUNCTION public.has_active_workflow_role(public.workflow_role)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_active_office_membership(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_workflow_role(public.workflow_role)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_active_office_membership(uuid)
  TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_grant_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_membership_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_self_read ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY role_grants_self_read ON public.role_grants
  FOR SELECT TO authenticated USING (profile_id = auth.uid());
CREATE POLICY role_grants_executor_access ON public.role_grants
  TO connect_daet_workflow_executor USING (true) WITH CHECK (true);

CREATE POLICY role_grant_events_self_read ON public.role_grant_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.role_grants AS rg
    WHERE rg.id = role_grant_id AND rg.profile_id = auth.uid()
  ));

CREATE POLICY offices_active_directory_read ON public.offices
  FOR SELECT TO authenticated USING (is_active);
CREATE POLICY offices_executor_access ON public.offices
  TO connect_daet_workflow_executor USING (true) WITH CHECK (true);

CREATE POLICY office_memberships_self_read ON public.office_memberships
  FOR SELECT TO authenticated USING (profile_id = auth.uid());
CREATE POLICY office_memberships_executor_access ON public.office_memberships
  TO connect_daet_workflow_executor USING (true) WITH CHECK (true);

CREATE POLICY office_membership_events_self_read ON public.office_membership_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.office_memberships AS om
    WHERE om.id = membership_id AND om.profile_id = auth.uid()
  ));
CREATE POLICY office_membership_events_executor_access ON public.office_membership_events
  TO connect_daet_workflow_executor USING (true) WITH CHECK (true);

REVOKE ALL ON public.profiles, public.role_grants, public.role_grant_events,
  public.offices, public.office_memberships, public.office_membership_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, created_at) ON public.profiles TO authenticated;
GRANT SELECT (id, profile_id, role, granted_at, revoked_at) ON public.role_grants TO authenticated;
GRANT SELECT (id, event_kind, actor_profile_id, created_at) ON public.role_grant_events TO authenticated;
GRANT SELECT (id, code, name) ON public.offices TO authenticated;
GRANT SELECT (id, profile_id, office_id, started_at, ended_at)
  ON public.office_memberships TO authenticated;
GRANT SELECT (id, membership_id, event_kind, actor_profile_id, created_at)
  ON public.office_membership_events TO authenticated;

COMMIT;
