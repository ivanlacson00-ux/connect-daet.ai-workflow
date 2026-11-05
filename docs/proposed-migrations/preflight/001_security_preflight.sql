-- READ-ONLY PREFLIGHT — TEST Supabase project only.
-- Run each SELECT separately before deployment. This file contains no DDL/DML.
-- Verify the Dashboard project reference is bhbccqutreegqoohqzqb first.
-- Do not run against production.

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

-- F1. Baseline direct table ACL grants (including PUBLIC), before deployment.
-- Expected from the 2026-11-05 TEST inspection: anon and authenticated have
-- direct INSERT/UPDATE/DELETE grants; PUBLIC has no grant. Service-role and
-- owner grants are included for comparison.
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

-- F2. Baseline explicit per-column INSERT/UPDATE ACL grants. Expected from
-- the TEST inspection: no rows, because there are no column ACL entries.
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

-- F2b. Baseline effective privileges on each column. Expected before deployment:
-- authenticated UPDATE is true; anon/authenticated INSERT are true under the
-- currently observed table-level grants. Compare these with post-deployment.
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
