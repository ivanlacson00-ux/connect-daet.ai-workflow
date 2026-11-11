create or replace function public.forward_workflow_submission_to_office(
  target_submission_id uuid,
  target_office_role text,
  message_id uuid,
  message_body text,
  attachment_records jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  current_plan public.workflow_routing_plans;
  plan_id uuid;
  next_version integer;
  now_at timestamptz := timezone('utc', now());
  request_context text := nullif(btrim(message_body), '');
  attachment_count integer;
begin
  if actor_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'An active office representative is required to forward this submission';
  end if;
  if target_office_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'Choose an active office to receive this submission';
  end if;
  if message_id is null then
    raise exception 'A message identifier is required for the document attachment';
  end if;
  if attachment_records is null
    or jsonb_typeof(attachment_records) is distinct from 'array'
    or jsonb_array_length(attachment_records) < 1
    or jsonb_array_length(attachment_records) > 5 then
    raise exception 'Attach the current document, with up to four additional files';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission not found';
  end if;
  if submission.status <> 'in_process'
    or submission.selected_office_role is distinct from actor_role then
    raise exception 'Only the responsible office can forward a submission in process';
  end if;
  if target_office_role = submission.selected_office_role then
    raise exception 'The target office must differ from the responsible office';
  end if;
  if public.workflow_mvp_has_pending_assignment(target_submission_id) then
    raise exception 'Complete, return, or withdraw the pending office assignment first';
  end if;
  if not exists (
    select 1
    from public.profiles profile
    join auth.users account on account.id = profile.id
    where profile.role = target_office_role
      and profile.is_active
      and (account.banned_until is null or account.banned_until <= now_at)
  ) then
    raise exception 'The selected office has no active representatives';
  end if;

  select count(*) into attachment_count
  from jsonb_to_recordset(attachment_records) as attachment(
    file_name text, file_path text, file_type text, file_size bigint
  )
  where nullif(btrim(attachment.file_name), '') is not null
    and attachment.file_type is not null
    and attachment.file_size > 0
    and attachment.file_size <= 10485760
    and attachment.file_path like (
      target_submission_id::text || '/' || auth.uid()::text || '/'
        || message_id::text || '/%'
    );
  if attachment_count <> jsonb_array_length(attachment_records) then
    raise exception 'A forwarded document attachment is invalid';
  end if;
  if not exists (
    select 1
    from jsonb_to_recordset(attachment_records) as attachment(
      file_name text, file_path text, file_type text, file_size bigint
    )
    where attachment.file_name = submission.file_name
      and attachment.file_type = submission.file_type
      and attachment.file_size = submission.file_size
  ) then
    raise exception 'Attach the submission’s current document version';
  end if;

  select * into current_plan
  from public.workflow_routing_plans
  where submission_id = target_submission_id
    and is_current
    and status = 'finalized'
  for update;

  if found then
    update public.workflow_routing_plans
    set status = 'superseded',
        is_current = false,
        finalized_by = null,
        finalized_at = null
    where id = current_plan.id;
  end if;

  select coalesce(max(plan.version), 0) + 1
  into next_version
  from public.workflow_routing_plans plan
  where plan.submission_id = target_submission_id;

  insert into public.workflow_routing_plans (
    submission_id, version, status, is_current, created_by, finalized_by, finalized_at
  )
  values (
    target_submission_id, next_version, 'finalized', true, auth.uid(), auth.uid(), now_at
  )
  returning id into plan_id;

  insert into public.workflow_routing_steps (
    routing_plan_id, sequence_number, office_role, status, assigned_by, assigned_at,
    started_at, responsibility, assignment_source, comments
  )
  values (
    plan_id, 1, target_office_role, 'pending', auth.uid(), now_at, null,
    'recommendation', 'office_forward', request_context
  );

  insert into public.workflow_messages (id, submission_id, sender_id, body)
  values (
    message_id,
    target_submission_id,
    auth.uid(),
    coalesce(request_context, 'Recommendation requested.')
  );

  insert into public.workflow_message_attachments (
    submission_id, message_id, uploaded_by, file_name, file_path, file_type, file_size
  )
  select
    target_submission_id, message_id, auth.uid(),
    attachment.file_name, attachment.file_path, attachment.file_type, attachment.file_size
  from jsonb_to_recordset(attachment_records) as attachment(
    file_name text, file_path text, file_type text, file_size bigint
  );

  perform public.workflow_mvp_record_history(
    target_submission_id, 'SUBMISSION_FORWARDED', 'in_process', 'in_process',
    target_office_role || ' — Recommendation'
      || case when request_context is null then '' else ': ' || request_context end,
    now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id, target_submission_id, 'OFFICE_ASSIGNMENT_FORWARDED',
    'Document forwarded for Recommendation',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.role = target_office_role
    and profile.is_active
    and (account.banned_until is null or account.banned_until <= now_at)
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;
