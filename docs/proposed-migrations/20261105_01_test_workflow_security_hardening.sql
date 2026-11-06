-- PROPOSAL ONLY — TEST Supabase project.
-- Do not run until reviewed and explicitly approved.
-- This file is intentionally outside supabase/migrations/.
--
-- Scope:
--   * Harden archive authorization and function EXECUTE grants.
--   * Keep tracking-number generation available through its trigger.
--   * Pin the role-sync trigger function search_path.
--   * Remove direct anonymous DML and direct authenticated INSERT on submissions.
--   * Protect offline approval evidence in Storage.
--
-- Direct authenticated UPDATE is deliberately retained in this phase because
-- existing application pages still write legacy review decisions directly.
-- See the companion proposal before any later UPDATE privilege lockdown.

begin;

-- 1. Archive authorization must reject both missing profiles and non-admins.
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

-- The archive UI calls this RPC as an authenticated user. Anonymous and
-- inherited PUBLIC execution are unnecessary.
revoke all on function public.set_workflow_submission_archive(uuid, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_workflow_submission_archive(uuid, boolean, timestamptz)
  to authenticated;

-- 2. This is a scalar, SECURITY DEFINER mutator, not the trigger function.
-- Automatic assignment is performed by set_workflow_submission_tracking_number().
-- Make the trigger helper's definer context and path explicit so it can continue
-- calling the scalar function after client EXECUTE is revoked. Confirm the
-- trigger-helper and scalar-function owners are compatible before applying.
alter function public.set_workflow_submission_tracking_number()
  security definer;
alter function public.set_workflow_submission_tracking_number()
  set search_path = pg_catalog, public;
alter function public.generate_workflow_tracking_number()
  set search_path = pg_catalog, public;
revoke all on function public.generate_workflow_tracking_number()
  from public, anon, authenticated;

-- 3. Preserve profile-role synchronization while pinning name resolution.
-- The function is invoked by the profiles role-update trigger, not application RPC.
alter function public.sync_role_to_app_metadata()
  set search_path = pg_catalog, public;
revoke all on function public.sync_role_to_app_metadata()
  from public, anon, authenticated;

-- 4. Submission creation in the repository uses submit_document(), a
-- SECURITY DEFINER RPC. There are no direct application INSERT call sites.
-- Keep the existing INSERT RLS policy as a second authorization check for the
-- definer function, but remove direct INSERT privilege from client roles.
-- Remove anonymous DML from this table; retain authenticated UPDATE until the
-- legacy review pages have been migrated to authorized RPCs.
revoke insert, update, delete on table public.workflow_submissions
  from public, anon;
revoke insert, delete on table public.workflow_submissions
  from authenticated;

-- 5. Restrict offline evidence reads to the recorder's uploaded path and the
-- reviewers authorized for that approval step or its destination department.
-- A linked evidence object is no longer readable solely because the uploader
-- owns its storage path; current reviewer authority must also match.
create or replace function public.is_my_workflow_evidence_file(target_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, storage
as $function$
  select auth.uid() is not null
    and (storage.foldername(target_path))[1] = auth.uid()::text
    and exists (
      select 1
      from public.approval_steps as step
      where step.evidence_file_path = target_path
    )
$function$;

create or replace function public.can_delete_unreferenced_workflow_upload(target_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, storage
as $function$
  select auth.uid() is not null
    and (storage.foldername(target_path))[1] = auth.uid()::text
    and not exists (
      select 1
      from public.document_versions as version
      where version.file_path = target_path
    )
    and not exists (
      select 1
      from public.workflow_submissions as submission
      where submission.file_path = target_path
    )
    and not exists (
      select 1
      from public.approval_steps as step
      where step.evidence_file_path = target_path
    )
$function$;

-- These helpers expose only booleans about the caller's own storage paths.
revoke all on function public.is_my_workflow_evidence_file(text)
  from public, anon, authenticated;
grant execute on function public.is_my_workflow_evidence_file(text)
  to authenticated;
revoke all on function public.can_delete_unreferenced_workflow_upload(text)
  from public, anon, authenticated;
grant execute on function public.can_delete_unreferenced_workflow_upload(text)
  to authenticated;

drop policy if exists "Users can view their own files" on storage.objects;
create policy "Users can view their own files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'workflow_uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.is_my_workflow_evidence_file(name)
  );

drop policy if exists "Reviewers can read offline approval evidence" on storage.objects;
create policy "Reviewers can read offline approval evidence"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'workflow_uploads'
    and exists (
      select 1
      from public.approval_steps as step
      join public.workflow_submissions as submission
        on submission.id = step.submission_id
      where step.evidence_file_path = objects.name
        and step.recorded_by is not null
        and (storage.foldername(objects.name))[1] = step.recorded_by::text
        and (
          step.approver_id = auth.uid()
          or (
            step.department_id is not null
            and public.is_department_officer(step.department_id)
          )
          or (
            submission.destination_department_id is not null
            and public.can_final_decide_for(submission.destination_department_id)
          )
        )
    )
  );

-- Preserve the existing owner-only deletion behavior for unreferenced uploads,
-- while preventing deletion after a file is referenced as offline evidence.
drop policy if exists "Owners can delete unsubmitted files" on storage.objects;
create policy "Owners can delete unsubmitted files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'workflow_uploads'
    and public.can_delete_unreferenced_workflow_upload(name)
  );

commit;

-- ---------------------------------------------------------------------------
-- READ-ONLY VERIFICATION QUERIES
-- Run separately after an approved TEST deployment. These queries inspect
-- catalogs only; do not call the workflow functions as test data may be changed.
-- ---------------------------------------------------------------------------

-- A. Function return types, owners, security mode, search_path and effective
-- EXECUTE privileges. Expected: archive callable by authenticated only;
-- tracking generator not callable by anon/auth; sync function search_path
-- includes pg_catalog, public. Trigger helpers return trigger and are not RPCs.
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
    'submit_document',
    'is_my_workflow_evidence_file',
    'can_delete_unreferenced_workflow_upload'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- B. Confirm tracking-number trigger wiring remains intact. Expected: enabled
-- trigger on workflow_submissions calling the trigger-returning helper.
select
  trg.tgname as trigger_name,
  trg.tgenabled as enabled_state,
  pg_get_triggerdef(trg.oid, true) as trigger_definition,
  fn.proname as trigger_function,
  fn.prorettype::regtype as trigger_function_return_type,
  fn.prosecdef as trigger_function_security_definer,
  pg_get_userbyid(fn.proowner) as trigger_function_owner,
  pg_get_userbyid(generator.proowner) as generator_function_owner,
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

-- C. Confirm RLS and current workflow_submissions policies.
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

-- D. Confirm effective table privileges. Expected after Phase 1:
-- anon has no INSERT/UPDATE/DELETE; authenticated has no INSERT/DELETE; authenticated
-- UPDATE remains temporarily for the current legacy UI paths.
select
  role_name,
  has_table_privilege(role_name, 'public.workflow_submissions', 'SELECT') as can_select,
  has_table_privilege(role_name, 'public.workflow_submissions', 'INSERT') as can_insert,
  has_table_privilege(role_name, 'public.workflow_submissions', 'UPDATE') as can_update,
  has_table_privilege(role_name, 'public.workflow_submissions', 'DELETE') as can_delete
from (values ('anon'), ('authenticated')) as roles(role_name);

-- E. Confirm evidence column and Storage policies.
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'approval_steps'
  and column_name in ('evidence_file_path', 'recorded_by', 'approver_id', 'department_id');

select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual as using_expression,
  with_check as with_check_expression
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'workflow_uploads';

-- F. Discover migration-history tables without assuming local migrations were
-- applied. An empty result means no matching history table was exposed here.
select table_schema, table_name
from information_schema.tables
where table_schema not in ('pg_catalog', 'information_schema')
  and table_name ilike '%migration%'
order by table_schema, table_name;
