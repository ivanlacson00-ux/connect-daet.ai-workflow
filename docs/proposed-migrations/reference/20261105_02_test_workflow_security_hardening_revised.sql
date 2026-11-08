-- REVISED PROPOSAL ONLY — TEST Supabase project.
-- Do not run until reviewed and explicitly approved.
-- This file is intentionally outside supabase/migrations/.
--
-- Offline approval evidence security and access policies are deferred
-- pending institutional consultation. This proposal does not access or modify
-- approval_steps.evidence_file_path or any Storage policy.
--
-- Direct authenticated UPDATE is deliberately retained because existing
-- application pages still write legacy review decisions directly.
--
-- Reference: 20261105_01_test_workflow_security_hardening.sql (superseded
-- proposal retained for reference; do not combine the two scripts).

begin;

-- 1. Archive authorization must reject missing users, non-admins, and NULL
-- should_archive rather than treating NULL as an implicit unarchive request.
create or replace function public.set_workflow_submission_archive(
  target_submission_id uuid,
  should_archive boolean,
  retention_date timestamptz default null
)
returns public.workflow_submissions
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  result public.workflow_submissions;
begin
  if should_archive is null then
    raise exception 'Archive action must be specified';
  end if;

  select profile.role
    into actor_role
  from public.profiles as profile
  where profile.id = actor_id;

  if actor_id is null or actor_role is distinct from 'admin' then
    raise exception 'Only an authenticated administrator can change archive status';
  end if;

  update public.workflow_submissions
  set archived_at = case
        when should_archive then coalesce(archived_at, now())
        else null
      end,
      archived_by = case when should_archive then actor_id else null end,
      retention_until = case when should_archive then retention_date else null end
  where id = target_submission_id
  returning * into result;

  if result.id is null then
    raise exception 'Workflow submission does not exist';
  end if;

  insert into public.workflow_audit_logs (
    submission_id,
    action_by,
    action_type,
    comments
  )
  values (
    result.id,
    actor_id,
    case when should_archive then 'ARCHIVED' else 'UNARCHIVED' end,
    case when should_archive
      then 'Retention until ' || coalesce(retention_date::text, 'not specified')
      else 'Archive access restored'
    end
  );

  return result;
end;
$function$;

-- The admin archive pages call this RPC as an authenticated user. Remove
-- inherited PUBLIC and anonymous execution, then grant only authenticated.
revoke all on function public.set_workflow_submission_archive(uuid, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_workflow_submission_archive(uuid, boolean, timestamptz)
  to authenticated;

-- 2. generate_workflow_tracking_number() is a SECURITY DEFINER scalar function
-- returning text; it is not the trigger function. The trigger calls it through
-- set_workflow_submission_tracking_number(). Pin both paths and ensure the
-- trigger helper runs as its owner after client EXECUTE on the scalar is revoked.
alter function public.set_workflow_submission_tracking_number()
  security definer;
alter function public.set_workflow_submission_tracking_number()
  set search_path = pg_catalog, public;
alter function public.generate_workflow_tracking_number()
  set search_path = pg_catalog, public;
revoke all on function public.generate_workflow_tracking_number()
  from public, anon, authenticated;
revoke all on function public.set_workflow_submission_tracking_number()
  from public, anon, authenticated;

-- 3. Preserve role-to-app-metadata synchronization while pinning name lookup.
-- The profiles role-update trigger calls this function; application clients
-- do not need to invoke it directly.
alter function public.sync_role_to_app_metadata()
  set search_path = pg_catalog, public;
revoke all on function public.sync_role_to_app_metadata()
  from public, anon, authenticated;

-- 4. Submission creation uses submit_document(), not direct application INSERT.
-- Its inspected TEST definition obtains auth.uid() through
-- workflow_require_actor(), requires a matching profile, rejects the
-- external_approver role, validates an active destination department, and
-- inserts user_id = actor. Do not remove INSERT privilege from the function
-- owner or alter the RPC in this proposal.
--
-- Remove direct client INSERT and DELETE. Remove anonymous UPDATE, but preserve
-- authenticated UPDATE until the legacy review UI is migrated to authorized
-- RPCs. Existing UPDATE callers are documented in the companion proposal.
revoke insert, delete on table public.workflow_submissions
  from public, anon, authenticated;
revoke update on table public.workflow_submissions
  from public, anon;

commit;

-- ---------------------------------------------------------------------------
-- READ-ONLY PREFLIGHT / VERIFICATION QUERIES
-- Run each SELECT separately against TEST before deciding whether to deploy,
-- then repeat applicable checks after an approved TEST deployment. These
-- catalog queries do not call workflow functions or change database objects
-- or records. Review function definitions to identify all direct and indirect
-- writes; PostgreSQL does not reliably record PL/pgSQL table/sequence
-- references as catalog dependencies.
-- ---------------------------------------------------------------------------

-- P1. Inspect owners, SECURITY DEFINER settings and definitions of the submit
-- RPC, its actor-check helper, and related SECURITY DEFINER/tracking functions.
-- Confirm all tables and sequences touched directly or through callees from
-- these live definitions.
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_userbyid(p.proowner) as function_owner,
  owner_role.rolsuper as owner_is_superuser,
  owner_role.rolbypassrls as owner_bypasses_rls,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ', '), '<not function-pinned>') as function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  pg_get_functiondef(p.oid) as definition
from pg_proc as p
join pg_namespace as namespace on namespace.oid = p.pronamespace
join pg_roles as owner_role on owner_role.oid = p.proowner
where namespace.nspname = 'public'
  and (
    p.prosecdef
    or p.proname in ('submit_document', 'workflow_require_actor')
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- P2. Check schema CREATE/USAGE for client roles. Compare these schemas with
-- every search_path reported by P1. No untrusted role should have CREATE on
-- any schema present in a SECURITY DEFINER search_path.
select
  namespace.nspname as schema_name,
  role_name.rolname as role_name,
  has_schema_privilege(role_name.oid, namespace.oid, 'USAGE') as can_use,
  has_schema_privilege(role_name.oid, namespace.oid, 'CREATE') as can_create
from pg_namespace as namespace
cross join pg_roles as role_name
where role_name.rolname in ('anon', 'authenticated')
order by namespace.nspname, role_name.rolname;

-- P3. Check submit_document() owner rights and RLS interaction for the direct
-- write targets and the insert-audit trigger target identified during P1
-- review. Add any additional live targets found in function/trigger bodies.
select
  pg_get_userbyid(fn.proowner) as function_owner,
  owner_role.rolsuper as owner_is_superuser,
  owner_role.rolbypassrls as owner_bypasses_rls,
  relation.relname as table_name,
  pg_get_userbyid(relation.relowner) as table_owner,
  relation.relrowsecurity as rls_enabled,
  relation.relforcerowsecurity as force_rls,
  has_table_privilege(fn.proowner, relation.oid, 'SELECT') as owner_can_select,
  has_table_privilege(fn.proowner, relation.oid, 'INSERT') as owner_can_insert,
  has_table_privilege(fn.proowner, relation.oid, 'UPDATE') as owner_can_update,
  has_table_privilege(fn.proowner, relation.oid, 'DELETE') as owner_can_delete
from pg_proc as fn
join pg_namespace as function_schema on function_schema.oid = fn.pronamespace
join pg_roles as owner_role on owner_role.oid = fn.proowner
join pg_class as relation
  on relation.relnamespace = function_schema.oid
 and relation.relname in (
   'workflow_submissions',
   'document_versions',
   'workflow_tracking_sequences',
   'workflow_audit_logs'
 )
where function_schema.nspname = 'public'
  and fn.proname = 'submit_document'
order by relation.relname;

-- P3b. If RLS is enabled and the function owner is neither a bypass role nor
-- an exempt table owner, inspect the policies applicable to that owner's role.
select
  policy.schemaname,
  policy.tablename,
  policy.policyname,
  policy.roles,
  policy.cmd,
  policy.qual as using_expression,
  policy.with_check as with_check_expression
from pg_policies as policy
where policy.schemaname = 'public'
  and policy.tablename in (
    'workflow_submissions',
    'document_versions',
    'workflow_tracking_sequences',
    'workflow_audit_logs'
  )
order by policy.tablename, policy.policyname;

-- P4. Tracking numbers use workflow_tracking_sequences (a table), not a
-- PostgreSQL sequence. Confirm the live generator owner retains the required
-- table privileges after client EXECUTE is revoked.
select
  pg_get_userbyid(generator.proowner) as generator_owner,
  relation.relname as counter_table,
  pg_get_userbyid(relation.relowner) as table_owner,
  relation.relrowsecurity as rls_enabled,
  relation.relforcerowsecurity as force_rls,
  has_table_privilege(generator.proowner, relation.oid, 'SELECT') as owner_can_select,
  has_table_privilege(generator.proowner, relation.oid, 'INSERT') as owner_can_insert,
  has_table_privilege(generator.proowner, relation.oid, 'UPDATE') as owner_can_update
from pg_proc as generator
join pg_namespace as function_schema on function_schema.oid = generator.pronamespace
join pg_class as relation on relation.relname = 'workflow_tracking_sequences'
join pg_namespace as table_schema on table_schema.oid = relation.relnamespace
where function_schema.nspname = 'public'
  and generator.proname = 'generate_workflow_tracking_number'
  and pg_get_function_identity_arguments(generator.oid) = ''
  and table_schema.nspname = 'public';

-- A. Confirm function types, owners, security mode, search_path and effective
-- EXECUTE. After deployment, archive should be executable by authenticated
-- only; both tracking functions by neither anon nor authenticated.
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_userbyid(p.proowner) as function_owner,
  pg_catalog.format_type(p.prorettype, null) as return_type,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc as p
join pg_namespace as namespace on namespace.oid = p.pronamespace
where namespace.nspname = 'public'
  and p.proname in (
    'set_workflow_submission_archive',
    'generate_workflow_tracking_number',
    'set_workflow_submission_tracking_number',
    'sync_role_to_app_metadata',
    'submit_document'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- B. Confirm tracking ownership and trigger wiring/behavior. After deployment,
-- the trigger helper should remain trigger-returning and enabled; the trigger
-- helper owner must retain EXECUTE on the scalar generator.
select
  trg.tgname as trigger_name,
  trg.tgenabled as enabled_state,
  pg_get_triggerdef(trg.oid, true) as trigger_definition,
  fn.proname as trigger_function,
  fn.prorettype::regtype as trigger_function_return_type,
  pg_get_userbyid(fn.proowner) as trigger_function_owner,
  fn.prosecdef as trigger_function_security_definer,
  fn.proconfig as trigger_function_settings,
  pg_get_userbyid(generator.proowner) as generator_function_owner,
  generator.prosecdef as generator_security_definer,
  generator.proconfig as generator_function_settings,
  has_function_privilege(
    pg_get_userbyid(fn.proowner),
    generator.oid,
    'EXECUTE'
  ) as trigger_owner_can_execute_generator
from pg_trigger as trg
join pg_class as relation on relation.oid = trg.tgrelid
join pg_namespace as namespace on namespace.oid = relation.relnamespace
join pg_proc as fn on fn.oid = trg.tgfoid
join pg_proc as generator
  on generator.pronamespace = namespace.oid
 and generator.proname = 'generate_workflow_tracking_number'
 and pg_get_function_identity_arguments(generator.oid) = ''
where not trg.tgisinternal
  and namespace.nspname = 'public'
  and relation.relname = 'workflow_submissions'
  and trg.tgname = 'set_workflow_submission_tracking_number';

-- C. Confirm the exact live submit_document() definition and authorization
-- checks. Expected: SECURITY DEFINER body requires a valid actor/profile,
-- binds inserted user_id to that actor, checks active department, and applies
-- the same role restrictions seen before deployment.
select
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  pg_get_functiondef(p.oid) as definition
from pg_proc as p
join pg_namespace as namespace on namespace.oid = p.pronamespace
where namespace.nspname = 'public'
  and p.proname = 'submit_document'
  and pg_get_function_identity_arguments(p.oid) =
    'p_file_url text, p_file_path text, p_file_name text, p_file_size integer, p_file_type text, p_category text, p_description text, p_destination_department_id uuid';

-- D. Confirm submission table RLS and policies remain enabled as designed.
select
  relation.relrowsecurity as rls_enabled,
  relation.relforcerowsecurity as force_rls
from pg_class as relation
join pg_namespace as namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname = 'workflow_submissions';

select
  policyname,
  roles,
  cmd,
  qual as using_expression,
  with_check as with_check_expression
from pg_policies
where schemaname = 'public'
  and tablename = 'workflow_submissions'
order by policyname;

-- E. Confirm effective table privileges. Before deployment, authenticated
-- must retain UPDATE for existing application pages. After deployment, anon
-- must lack INSERT/UPDATE/DELETE; authenticated must retain UPDATE temporarily
-- but lack direct INSERT/DELETE.
select
  role_name,
  has_table_privilege(role_name, 'public.workflow_submissions', 'SELECT') as can_select,
  has_table_privilege(role_name, 'public.workflow_submissions', 'INSERT') as can_insert,
  has_table_privilege(role_name, 'public.workflow_submissions', 'UPDATE') as can_update,
  has_table_privilege(role_name, 'public.workflow_submissions', 'DELETE') as can_delete
from (values ('anon'), ('authenticated')) as roles(role_name);

-- F1. Inspect direct table ACL grants (including PUBLIC) rather than only
-- effective privileges. Expected after deployment: authenticated retains
-- UPDATE; anon and PUBLIC do not. INSERT/DELETE are absent for anon and
-- authenticated. Service-role and owner grants are intentionally unaffected.
select
  case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end as grantee,
  acl.privilege_type,
  acl.is_grantable,
  pg_get_userbyid(acl.grantor) as grantor
from pg_class as relation
join pg_namespace as namespace on namespace.oid = relation.relnamespace
cross join lateral aclexplode(
  coalesce(relation.relacl, acldefault('r', relation.relowner))
) as acl
left join pg_roles as grantee on grantee.oid = acl.grantee
where namespace.nspname = 'public'
  and relation.relname = 'workflow_submissions'
  and acl.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
order by grantee, acl.privilege_type;

-- F2. List explicit per-column INSERT/UPDATE ACL grants. Table-level REVOKE
-- does not remove a separate column-level grant. Expected for this TEST
-- inspection: no rows, because no column ACL entries exist.
select
  case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end as grantee,
  attribute.attname as column_name,
  acl.privilege_type,
  acl.is_grantable,
  pg_get_userbyid(acl.grantor) as grantor
from pg_attribute as attribute
join pg_class as relation on relation.oid = attribute.attrelid
join pg_namespace as namespace on namespace.oid = relation.relnamespace
cross join lateral aclexplode(attribute.attacl) as acl
left join pg_roles as grantee on grantee.oid = acl.grantee
where namespace.nspname = 'public'
  and relation.relname = 'workflow_submissions'
  and attribute.attnum > 0
  and not attribute.attisdropped
  and acl.privilege_type in ('INSERT', 'UPDATE')
order by grantee, attribute.attname, acl.privilege_type;

-- F2b. Confirm effective privileges on every column. After deployment,
-- authenticated UPDATE remains effective (including the four legacy
-- application columns); anon and authenticated lack INSERT on all columns.
select
  attribute.attname as column_name,
  has_column_privilege(
    'authenticated', 'public.workflow_submissions', attribute.attname, 'UPDATE'
  ) as authenticated_can_update,
  has_column_privilege(
    'anon', 'public.workflow_submissions', attribute.attname, 'INSERT'
  ) as anon_can_insert,
  has_column_privilege(
    'authenticated', 'public.workflow_submissions', attribute.attname, 'INSERT'
  ) as authenticated_can_insert
from pg_attribute as attribute
join pg_class as relation on relation.oid = attribute.attrelid
join pg_namespace as namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname = 'workflow_submissions'
  and attribute.attnum > 0
  and not attribute.attisdropped
order by attribute.attnum;
