create or replace function public.create_workflow_submission(
  submission_title text,
  submission_file_path text,
  submission_file_url text,
  submission_file_type text,
  submission_file_size bigint,
  submission_document_type text,
  submission_description text,
  submission_purpose text,
  submission_requested_action text,
  submission_intended_recipient text,
  attachment_records jsonb default '[]'::jsonb
)
returns table (id uuid, tracking_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  created_submission public.workflow_submissions;
  attachment_record record;
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'user' then
    raise exception 'Only a submitter can create a workflow submission';
  end if;

  if coalesce(length(btrim(submission_title)), 0) = 0
    or coalesce(length(btrim(submission_file_path)), 0) = 0
    or coalesce(length(btrim(submission_document_type)), 0) = 0
    or coalesce(length(btrim(submission_description)), 0) = 0 then
    raise exception 'Title, document, document type, and description are required';
  end if;

  if submission_file_path not like (auth.uid()::text || '/%')
    or jsonb_typeof(attachment_records) is distinct from 'array' then
    raise exception 'Invalid document storage path or attachment list';
  end if;

  insert into public.workflow_submissions (
    user_id,
    file_url,
    file_path,
    file_name,
    file_size,
    file_type,
    category,
    description,
    purpose,
    requested_action,
    intended_recipient,
    status
  )
  values (
    auth.uid(),
    submission_file_url,
    submission_file_path,
    submission_title,
    submission_file_size,
    submission_file_type,
    submission_document_type,
    submission_description,
    nullif(btrim(submission_purpose), ''),
    nullif(btrim(submission_requested_action), ''),
    nullif(btrim(submission_intended_recipient), ''),
    'pending'
  )
  returning * into created_submission;

  for attachment_record in
    select *
    from jsonb_to_recordset(attachment_records) as attachment(
      file_name text,
      file_path text,
      file_type text,
      file_size bigint
    )
  loop
    if coalesce(length(btrim(attachment_record.file_name)), 0) = 0
      or attachment_record.file_path not like (auth.uid()::text || '/%')
      or attachment_record.file_size is null
      or attachment_record.file_size < 0 then
      raise exception 'Invalid supporting attachment metadata';
    end if;

    insert into public.workflow_submission_attachments (
      submission_id, file_name, file_path, file_type, file_size, uploaded_by
    )
    values (
      created_submission.id,
      attachment_record.file_name,
      attachment_record.file_path,
      attachment_record.file_type,
      attachment_record.file_size,
      auth.uid()
    );
  end loop;

  return query select created_submission.id, created_submission.tracking_number;
end;
$$;

revoke all on function public.create_workflow_submission(
  text, text, text, text, bigint, text, text, text, text, text, jsonb
) from public;
grant execute on function public.create_workflow_submission(
  text, text, text, text, bigint, text, text, text, text, text, jsonb
) to authenticated;
