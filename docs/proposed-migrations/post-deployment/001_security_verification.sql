-- READ-ONLY POST-DEPLOYMENT VERIFICATION - TEST Supabase project only.
-- Run only after an approved deployment. This file contains SELECT queries only.
-- Do not run against production.

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
