create or replace function public.enforce_workflow_upload_file_type()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  file_extension text;
  expected_mime_type text;
  allow_zip boolean := tg_table_name = 'workflow_submission_attachments';
begin
  file_extension := lower(substring(new.file_path from '\.([^.\/]+)$'));
  expected_mime_type := case file_extension
    when 'pdf' then 'application/pdf'
    when 'doc' then 'application/msword'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'xls' then 'application/vnd.ms-excel'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'csv' then 'text/csv'
    when 'ppt' then 'application/vnd.ms-powerpoint'
    when 'pptx' then 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    when 'jpg' then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    when 'png' then 'image/png'
    when 'zip' then 'application/zip'
    else null
  end;

  if expected_mime_type is null or (file_extension = 'zip' and not allow_zip) then
    raise exception 'Unsupported workflow upload file type: %', coalesce(file_extension, 'unknown');
  end if;

  if new.file_type is distinct from expected_mime_type then
    raise exception 'File type does not match the supported MIME type for .% files', file_extension;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_workflow_submission_file_type
  on public.workflow_submissions;
create trigger enforce_workflow_submission_file_type
before insert on public.workflow_submissions
for each row
execute function public.enforce_workflow_upload_file_type();

drop trigger if exists enforce_workflow_attachment_file_type
  on public.workflow_submission_attachments;
create trigger enforce_workflow_attachment_file_type
before insert on public.workflow_submission_attachments
for each row
execute function public.enforce_workflow_upload_file_type();

drop policy if exists "Users can upload workflow files" on storage.objects;
create policy "Users can upload workflow files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'workflow_uploads'
    and name like (auth.uid()::text || '/%')
    and lower(name) ~ '\.(pdf|doc|docx|xls|xlsx|csv|ppt|pptx|jpe?g|png|zip)$'
  );
