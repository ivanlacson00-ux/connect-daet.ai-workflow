create or replace function public.admin_delete_workflow_submission(
  target_submission_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.workflow_submissions;
  upload_paths text[] := array[]::text[];
  message_paths text[] := array[]::text[];
  legacy_paths text[];
begin
  if auth.uid() is null or not public.is_workflow_admin() then
    raise exception 'Only an administrator can permanently delete a submission';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission not found';
  end if;

  select coalesce(array_agg(distinct file_path), array[]::text[])
  into upload_paths
  from (
    select submission.file_path as file_path
    union all
    select submission.closure_file_path
    union all
    select attachment.file_path
    from public.workflow_submission_attachments attachment
    where attachment.submission_id = target_submission_id
    union all
    select version.file_path
    from public.workflow_submission_versions version
    where version.submission_id = target_submission_id
  ) files
  where file_path is not null and btrim(file_path) <> '';

  select coalesce(array_agg(distinct attachment.file_path), array[]::text[])
  into message_paths
  from public.workflow_message_attachments attachment
  where attachment.submission_id = target_submission_id;

  if to_regclass('public.document_versions') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'document_versions'
        and column_name = 'file_path'
    ) then
    execute $query$
      select coalesce(array_agg(distinct file_path), array[]::text[])
      from public.document_versions
      where submission_id = $1 and file_path is not null and btrim(file_path) <> ''
    $query$
      into legacy_paths
      using target_submission_id;
    upload_paths := upload_paths || coalesce(legacy_paths, array[]::text[]);
  end if;

  if to_regclass('public.approval_steps') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'approval_steps'
        and column_name = 'evidence_file_path'
    ) then
    execute $query$
      select coalesce(array_agg(distinct evidence_file_path), array[]::text[])
      from public.approval_steps
      where submission_id = $1
        and evidence_file_path is not null
        and btrim(evidence_file_path) <> ''
    $query$
      into legacy_paths
      using target_submission_id;
    upload_paths := upload_paths || coalesce(legacy_paths, array[]::text[]);
  end if;

  if to_regclass('public.workflow_email_outbox') is not null then
    execute
      'delete from public.workflow_email_outbox ' ||
      'where notification_id in (' ||
      '  select id from public.workflow_notifications where submission_id = $1' ||
      ')'
      using target_submission_id;
  end if;

  if to_regclass('public.approval_steps') is not null then
    execute 'delete from public.approval_steps where submission_id = $1'
      using target_submission_id;
  end if;
  if to_regclass('public.document_messages') is not null then
    execute 'delete from public.document_messages where submission_id = $1'
      using target_submission_id;
  end if;
  if to_regclass('public.document_versions') is not null then
    execute 'delete from public.document_versions where submission_id = $1'
      using target_submission_id;
  end if;
  if to_regclass('public.points_ledger') is not null then
    execute 'delete from public.points_ledger where submission_id = $1'
      using target_submission_id;
  end if;

  delete from public.workflow_audit_logs
  where submission_id = target_submission_id;
  delete from public.workflow_notifications
  where submission_id = target_submission_id;
  delete from public.workflow_submissions
  where id = target_submission_id;

  return jsonb_build_object(
    'workflow_uploads', to_jsonb(upload_paths),
    'workflow_message_attachments', to_jsonb(message_paths)
  );
end;
$$;

revoke all on function public.admin_delete_workflow_submission(uuid)
  from public, anon;
grant execute on function public.admin_delete_workflow_submission(uuid)
  to authenticated;

drop policy if exists "Administrators can delete workflow uploads"
  on storage.objects;
create policy "Administrators can delete workflow uploads"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'workflow_uploads'
    and public.is_workflow_admin()
  );

drop policy if exists "Administrators can delete workflow message attachments"
  on storage.objects;
create policy "Administrators can delete workflow message attachments"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'workflow_message_attachments'
    and public.is_workflow_admin()
  );
