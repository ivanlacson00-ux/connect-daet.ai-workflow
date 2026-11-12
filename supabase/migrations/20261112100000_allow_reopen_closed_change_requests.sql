-- Let submitters reopen a submission that an office closed while it was awaiting changes.
-- The same submission returns to in_process (no new submission, history preserved).

create or replace function public.respond_to_workflow_submission_changes(
  target_submission_id uuid,
  sender_comments text,
  revised_file_path text default null,
  revised_file_url text default null,
  revised_file_name text default null,
  revised_file_type text default null,
  revised_file_size bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  next_version integer;
  is_reopen boolean := false;
  now_at timestamptz := timezone('utc', now());
  response text := nullif(btrim(sender_comments), '');
  has_file boolean := revised_file_path is not null
    or revised_file_url is not null
    or revised_file_name is not null
    or revised_file_type is not null
    or revised_file_size is not null;
begin
  if actor_role is distinct from 'submitter' then
    raise exception 'Only the submitter can respond to requested changes';
  end if;
  if response is null then
    raise exception 'Enter a response before resubmitting';
  end if;
  if has_file and (
    revised_file_path is null
    or revised_file_path not like (auth.uid()::text || '/%')
    or nullif(btrim(revised_file_url), '') is null
    or nullif(btrim(revised_file_name), '') is null
    or nullif(btrim(revised_file_type), '') is null
    or revised_file_size is null
    or revised_file_size < 1
  ) then
    raise exception 'Provide complete metadata for the optional response file';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
    and user_id = auth.uid()
  for update;
  if not found then
    raise exception 'This submission is not waiting for your response';
  end if;
  if submission.status = 'completed' then
    -- Reopen only when the office closed it while it was awaiting changes.
    select log.old_status = 'changes_requested' into is_reopen
    from public.workflow_audit_logs log
    where log.submission_id = target_submission_id
      and log.action_type = 'SUBMISSION_CLOSED'
    order by log.created_at desc
    limit 1;
    is_reopen := coalesce(is_reopen, false);
  end if;
  if submission.status <> 'changes_requested' and not is_reopen then
    raise exception 'This submission is not waiting for your response';
  end if;
  if public.workflow_mvp_has_pending_assignment(target_submission_id) then
    raise exception 'A Pending office assignment prevents responding to changes';
  end if;

  if has_file then
    select coalesce(max(version.version_number), 0) + 1
    into next_version
    from public.workflow_submission_versions version
    where version.submission_id = target_submission_id;

    insert into public.workflow_submission_versions (
      submission_id, version_number, file_name, file_path, file_type,
      file_size, uploaded_by, created_at
    )
    values (
      target_submission_id, next_version, revised_file_name, revised_file_path,
      revised_file_type, revised_file_size, auth.uid(), now_at
    );
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'in_process',
      sender_response = response,
      file_name = case when has_file then revised_file_name else file_name end,
      file_path = case when has_file then revised_file_path else file_path end,
      file_url = case when has_file then revised_file_url else file_url end,
      file_type = case when has_file then revised_file_type else file_type end,
      file_size = case when has_file then revised_file_size else file_size end,
      closed_by = case when is_reopen then null else closed_by end,
      completed_at = case when is_reopen then null else completed_at end,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  perform public.workflow_mvp_record_history(
    target_submission_id, case when is_reopen then 'SUBMISSION_REOPENED' else 'CHANGES_RESPONDED' end,
    submission.status, 'in_process',
    response, now_at
  );
  if has_file then
    perform public.workflow_mvp_record_history(
      target_submission_id, 'FILE_VERSION_ADDED', submission.status, 'in_process',
      'Document version ' || next_version || ' uploaded: ' || revised_file_name, now_at
    );
  end if;

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id, target_submission_id,
    case when is_reopen then 'SUBMISSION_REOPENED' else 'CHANGES_RESPONDED' end,
    case when is_reopen then 'Submitter reopened a closed submission'
      else 'Submitter responded to requested changes' end,
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.role = submission.selected_office_role
    and profile.is_active
    and (account.banned_until is null or account.banned_until <= now_at)
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;
