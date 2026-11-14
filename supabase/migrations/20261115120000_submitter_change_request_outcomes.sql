begin;

create or replace function public.submit_workflow_submission_revision(
  target_submission_id uuid,
  expected_change_request_id uuid,
  expected_revision_id uuid,
  submitter_message text,
  file_manifest jsonb,
  primary_file_url text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  change_request public.workflow_change_requests;
  previous_revision public.workflow_submission_revisions;
  previous_file public.workflow_revision_files;
  primary_file public.workflow_revision_files;
  manifest_item record;
  revision_id uuid;
  next_revision_no integer;
  next_version_no integer;
  previous_file_count integer;
  seen_previous_file_ids uuid[] := array[]::uuid[];
  current_primary_count integer := 0;
  changed_file_count integer := 0;
  now_at timestamptz := timezone('utc', now());
  message text := nullif(btrim(submitter_message), '');
  expected_mime_type text;
  file_extension text;
  old_url_base text;
  new_url_base text;
begin
  if actor_role is distinct from 'submitter'
    or not public.is_active_workflow_account() then
    raise exception 'An active submitter account is required to send a revision';
  end if;
  if message is not null and char_length(message) > 4000 then
    raise exception 'The optional message must be no more than 4,000 characters';
  end if;
  if file_manifest is null
    or jsonb_typeof(file_manifest) is distinct from 'array' then
    raise exception 'The revision file manifest must be a JSON array';
  end if;
  if jsonb_array_length(file_manifest) < 1
    or jsonb_array_length(file_manifest) > 30 then
    raise exception 'The revision must contain between 1 and 30 file entries';
  end if;

  select *
    into submission
  from public.workflow_submissions
  where id = target_submission_id
    and user_id = auth.uid()
  for update;
  if not found
    or submission.status not in ('changes_requested', 'returned_for_requirements') then
    raise exception 'This submission is not waiting for your revision';
  end if;
  if submission.reopen_count <> 0 then
    raise exception 'This submission has already been reopened';
  end if;
  if submission.current_revision_id is null
    or expected_revision_id is distinct from submission.current_revision_id then
    raise exception 'The submission revision changed. Refresh and try again';
  end if;

  select *
    into previous_revision
  from public.workflow_submission_revisions revision
  where revision.id = submission.current_revision_id
    and revision.submission_id = target_submission_id;
  if not found then
    raise exception 'The current revision could not be found';
  end if;

  select *
    into change_request
  from public.workflow_change_requests request
  where request.id = expected_change_request_id
    and request.submission_id = target_submission_id
    and request.against_revision_id = submission.current_revision_id
    and request.status = 'open'
  for update;
  if not found then
    raise exception 'The change request is no longer open. Refresh and try again';
  end if;

  select count(*)
    into previous_file_count
  from public.workflow_revision_files revision_file
  where revision_file.revision_id = submission.current_revision_id
    and revision_file.change_kind <> 'removed';

  select coalesce(max(revision.revision_no), 0) + 1
    into next_revision_no
  from public.workflow_submission_revisions revision
  where revision.submission_id = target_submission_id;

  insert into public.workflow_submission_revisions (
    submission_id, revision_no, created_by, created_at, submitter_message,
    form_snapshot, backfill_quality
  )
  values (
    target_submission_id,
    next_revision_no,
    auth.uid(),
    now_at,
    message,
    jsonb_build_object(
      'title', submission.file_name,
      'category', submission.category,
      'other_document_type', submission.other_document_type,
      'description', submission.description,
      'purpose', submission.purpose,
      'requested_action', submission.requested_action,
      'intended_recipient', submission.intended_recipient,
      'initial_destination_role', submission.initial_destination_role,
      'selected_office_role', submission.selected_office_role
    ),
    'complete'
  )
  returning id into revision_id;

  for manifest_item in
    select *
    from jsonb_to_recordset(file_manifest) as file_record(
      logical_file_id uuid,
      prior_revision_file_id uuid,
      file_role text,
      file_name text,
      storage_path text,
      file_type text,
      file_size bigint,
      change_kind text
    )
  loop
    if manifest_item.logical_file_id is null
      or manifest_item.file_role is null
      or manifest_item.file_role not in ('primary', 'supporting')
      or manifest_item.change_kind is null
      or manifest_item.change_kind not in ('added', 'replaced', 'carried', 'removed')
      or coalesce(length(btrim(manifest_item.file_name)), 0) not between 1 and 255
      or coalesce(length(btrim(manifest_item.storage_path)), 0) not between 1 and 2048
      or manifest_item.file_size is null
      or manifest_item.file_size < 0
      or manifest_item.file_size > 10485760 then
      raise exception 'The revision contains invalid file metadata';
    end if;

    if manifest_item.change_kind = 'added' then
      if manifest_item.prior_revision_file_id is not null
        or exists (
          select 1
          from public.workflow_revision_files prior
          join public.workflow_submission_revisions revision
            on revision.id = prior.revision_id
          where revision.submission_id = target_submission_id
            and prior.logical_file_id = manifest_item.logical_file_id
        ) then
        raise exception 'A newly added file cannot reuse a previous file identity';
      end if;
    else
      if manifest_item.prior_revision_file_id is null
        or manifest_item.prior_revision_file_id = any(seen_previous_file_ids) then
        raise exception 'Each current file must be represented exactly once';
      end if;

      select revision_file.*
        into previous_file
      from public.workflow_revision_files revision_file
      where revision_file.id = manifest_item.prior_revision_file_id
        and revision_file.revision_id = submission.current_revision_id
        and revision_file.logical_file_id = manifest_item.logical_file_id
        and revision_file.file_role = manifest_item.file_role
        and revision_file.change_kind <> 'removed';
      if not found then
        raise exception 'The revision references a file that is no longer current';
      end if;
      seen_previous_file_ids := array_append(
        seen_previous_file_ids,
        manifest_item.prior_revision_file_id
      );

      if manifest_item.change_kind in ('carried', 'removed') and (
        manifest_item.file_name is distinct from previous_file.file_name
        or manifest_item.storage_path is distinct from previous_file.storage_path
        or manifest_item.file_type is distinct from previous_file.file_type
        or manifest_item.file_size is distinct from previous_file.file_size
      ) then
        raise exception 'Carried and removed files must match the current revision';
      end if;
    end if;

    if manifest_item.change_kind in ('added', 'replaced') then
      if manifest_item.storage_path not like (auth.uid()::text || '/%')
        or manifest_item.file_type is null
        or manifest_item.file_size < 1 then
        raise exception 'New and replaced files must be uploaded by the submitter';
      end if;

      file_extension := lower(substring(manifest_item.storage_path from '\.([^.\/]+)$'));
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
      if expected_mime_type is null
        or (manifest_item.file_role = 'primary' and file_extension = 'zip')
        or manifest_item.file_type is distinct from expected_mime_type then
        raise exception 'The file type is not supported or does not match the file name';
      end if;
      if not exists (
        select 1
        from storage.objects object
        where object.bucket_id = 'workflow_uploads'
          and object.name = manifest_item.storage_path
      ) then
        raise exception 'An uploaded file could not be found in workflow storage';
      end if;
      if exists (
        select 1
        from public.workflow_revision_files prior
        join public.workflow_submission_revisions revision
          on revision.id = prior.revision_id
        where revision.submission_id = target_submission_id
          and prior.storage_path = manifest_item.storage_path
      ) then
        raise exception 'New file uploads must use a new storage path';
      end if;
    else
      if not exists (
        select 1
        from storage.objects object
        where object.bucket_id = 'workflow_uploads'
          and object.name = previous_file.storage_path
      ) then
        raise exception 'A current file is missing from workflow storage';
      end if;
    end if;

    if manifest_item.change_kind <> 'removed'
      and manifest_item.file_role = 'primary' then
      current_primary_count := current_primary_count + 1;
    end if;
    if manifest_item.change_kind in ('added', 'replaced') then
      changed_file_count := changed_file_count + 1;
    end if;

    insert into public.workflow_revision_files (
      revision_id, logical_file_id, file_role, file_name, storage_path,
      file_type, file_size, change_kind, prior_revision_file_id, uploaded_by, created_at
    )
    values (
      revision_id,
      manifest_item.logical_file_id,
      manifest_item.file_role,
      manifest_item.file_name,
      manifest_item.storage_path,
      manifest_item.file_type,
      manifest_item.file_size,
      manifest_item.change_kind,
      manifest_item.prior_revision_file_id,
      case
        when manifest_item.change_kind in ('added', 'replaced') then auth.uid()
        else previous_file.uploaded_by
      end,
      now_at
    );

    if manifest_item.change_kind <> 'removed'
      and manifest_item.file_role = 'primary' then
      select *
        into primary_file
      from public.workflow_revision_files revision_file
      where revision_file.revision_id = revision_id
        and revision_file.logical_file_id = manifest_item.logical_file_id;
    end if;
  end loop;

  if previous_file_count <> cardinality(seen_previous_file_ids) then
    raise exception 'The revision does not include every current file';
  end if;
  if current_primary_count <> 1 then
    raise exception 'A revision must retain exactly one primary document';
  end if;
  if changed_file_count < 1 then
    raise exception 'Add or replace at least one file before resubmitting';
  end if;

  if primary_file.storage_path is null or primary_file_url is null then
    raise exception 'The revised primary document could not be determined';
  end if;

  old_url_base := regexp_replace(
    submission.file_url,
    '/storage/v1/object/(public|sign|authenticated)/workflow_uploads/.*$',
    ''
  );
  new_url_base := regexp_replace(
    primary_file_url,
    '/storage/v1/object/(public|sign|authenticated)/workflow_uploads/.*$',
    ''
  );
  if old_url_base = submission.file_url
    or new_url_base = primary_file_url
    or old_url_base is distinct from new_url_base
    or right(
      primary_file_url,
      length('/storage/v1/object/public/workflow_uploads/' || primary_file.storage_path)
    ) is distinct from '/storage/v1/object/public/workflow_uploads/' || primary_file.storage_path then
    raise exception 'The primary document URL does not match the current storage project';
  end if;

  select coalesce(max(version.version_number), 0) + 1
    into next_version_no
  from public.workflow_submission_versions version
  where version.submission_id = target_submission_id;

  insert into public.workflow_submission_versions (
    submission_id, version_number, file_name, file_path, file_type, file_size,
    uploaded_by, created_at
  )
  values (
    target_submission_id,
    next_version_no,
    primary_file.file_name,
    primary_file.storage_path,
    primary_file.file_type,
    primary_file.file_size,
    auth.uid(),
    now_at
  );

  perform set_config('app.workflow_authorized_transition', 'on', true);
  perform set_config('app.workflow_authorized_revision_transition', 'on', true);
  update public.workflow_submissions
  set status = 'in_process',
      sender_response = message,
      file_name = primary_file.file_name,
      file_path = primary_file.storage_path,
      file_url = primary_file_url,
      file_type = primary_file.file_type,
      file_size = primary_file.file_size,
      current_revision_id = revision_id,
      reopen_count = 1,
      closure_reason = null,
      closed_at = null,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_revision_transition', 'off', true);
  perform set_config('app.workflow_authorized_transition', 'off', true);

  update public.workflow_change_requests
  set status = 'fulfilled',
      fulfilled_by_revision_id = revision_id,
      updated_at = now_at
  where id = change_request.id;

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments,
    created_at, revision_id, payload
  )
  values (
    target_submission_id,
    auth.uid(),
    'SUBMISSION_REOPENED',
    submission.status,
    'in_process',
    message,
    now_at,
    revision_id,
    jsonb_build_object(
      'change_request_id', change_request.id,
      'revision_no', next_revision_no,
      'primary_version', next_version_no
    )
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    target_submission_id,
    'SUBMISSION_REOPENED:' || revision_id::text,
    'Submitter resubmitted a revised file',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || primary_file.file_name
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.role = change_request.requested_by_office
    and profile.is_active
    and (account.banned_until is null or account.banned_until <= now_at)
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;

  return revision_id;
end;
$$;

revoke all on function public.submit_workflow_submission_revision(
  uuid, uuid, uuid, text, jsonb, text
) from public, anon;
grant execute on function public.submit_workflow_submission_revision(
  uuid, uuid, uuid, text, jsonb, text
) to authenticated;

create or replace function public.close_workflow_submission_permanently(
  target_submission_id uuid,
  expected_change_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  change_request public.workflow_change_requests;
  now_at timestamptz := timezone('utc', now());
begin
  if actor_role is distinct from 'submitter'
    or not public.is_active_workflow_account() then
    raise exception 'An active submitter account is required to close this submission';
  end if;

  select *
    into submission
  from public.workflow_submissions
  where id = target_submission_id
    and user_id = auth.uid()
  for update;
  if not found
    or submission.status not in ('changes_requested', 'returned_for_requirements') then
    raise exception 'This submission is not waiting for a change-request outcome';
  end if;
  if submission.current_revision_id is null then
    raise exception 'The current submission revision could not be found';
  end if;

  select *
    into change_request
  from public.workflow_change_requests request
  where request.id = expected_change_request_id
    and request.submission_id = target_submission_id
    and request.against_revision_id = submission.current_revision_id
    and request.status = 'open'
  for update;
  if not found then
    raise exception 'The change request is no longer open. Refresh and try again';
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  perform set_config('app.workflow_authorized_revision_transition', 'on', true);
  update public.workflow_submissions
  set status = 'closed_by_submitter',
      closed_by = auth.uid(),
      closure_reason = 'closed_by_submitter',
      closed_at = now_at,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_revision_transition', 'off', true);
  perform set_config('app.workflow_authorized_transition', 'off', true);

  update public.workflow_change_requests
  set status = 'abandoned',
      updated_at = now_at
  where id = change_request.id;

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments,
    created_at, revision_id, payload
  )
  values (
    target_submission_id,
    auth.uid(),
    'SUBMISSION_PERMANENTLY_CLOSED',
    submission.status,
    'closed_by_submitter',
    change_request.message,
    now_at,
    submission.current_revision_id,
    jsonb_build_object('change_request_id', change_request.id)
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    target_submission_id,
    'SUBMISSION_PERMANENTLY_CLOSED',
    'Submitter permanently closed a submission',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.role = change_request.requested_by_office
    and profile.is_active
    and (account.banned_until is null or account.banned_until <= now_at)
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;

revoke all on function public.close_workflow_submission_permanently(uuid, uuid)
  from public, anon;
grant execute on function public.close_workflow_submission_permanently(uuid, uuid)
  to authenticated;

commit;
