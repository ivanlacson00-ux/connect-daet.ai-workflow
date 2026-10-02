-- Store object paths separately so file access can use short-lived signed URLs.
alter table public.workflow_submissions
  add column if not exists file_path text;

update public.workflow_submissions
set file_path = regexp_replace(
  file_url,
  '^.*/storage/v1/object/public/workflow_uploads/',
  ''
)
where file_path is null
  and file_url is not null;

create index if not exists workflow_submissions_file_path_idx
  on public.workflow_submissions (file_path);

update storage.buckets
set public = false
where id = 'workflow_uploads';

drop policy if exists "Workflow users can read uploaded files" on storage.objects;
create policy "Workflow users can read uploaded files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'workflow_uploads'
    and (
      (name like (auth.uid()::text || '/%'))
      or public.is_workflow_staff()
    )
  );

drop policy if exists "Users can upload workflow files" on storage.objects;
create policy "Users can upload workflow files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'workflow_uploads'
    and name like (auth.uid()::text || '/%')
  );
