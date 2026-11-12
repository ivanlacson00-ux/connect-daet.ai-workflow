-- Reword user-facing "close" messages to "complete" so they match the app's wording.
-- Message text only: no logic, permissions, or internal names (closure_*, SUBMISSION_CLOSED) change.

create or replace function public.workflow_mvp_close_submission_internal(
  target_submission_id uuid,
  closure_note text,
  closure_file_path text,
  closure_file_name text,
  closure_file_type text,
  closure_file_size bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
#variable_conflict use_variable
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  now_at timestamptz := timezone('utc', now());
  note text := nullif(btrim(closure_note), '');
  has_file boolean := closure_file_path is not null
    or closure_file_name is not null
    or closure_file_type is not null
    or closure_file_size is not null;
begin
  if actor_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'An active responsible-office representative is required to complete this submission';
  end if;
  if note is not null and char_length(note) > 5000 then
    raise exception 'Completion note must be no more than 5,000 characters';
  end if;
  if has_file and (
    closure_file_path is null
    or closure_file_path not like (auth.uid()::text || '/%')
    or nullif(btrim(closure_file_name), '') is null
    or nullif(btrim(closure_file_type), '') is null
    or closure_file_size is null
    or closure_file_size < 1
    or closure_file_size > 10485760
  ) then
    raise exception 'Provide complete metadata for the optional completion document';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission not found';
  end if;
  if submission.status not in ('in_process', 'changes_requested')
    or submission.selected_office_role is distinct from actor_role then
    raise exception 'Only the responsible office can complete a submission in process or awaiting changes';
  end if;
  if public.workflow_mvp_has_pending_assignment(target_submission_id) then
    raise exception 'Pending office assignments must be finished before completing this submission';
  end if;

  if has_file then
    insert into public.workflow_submission_attachments (
      submission_id, file_name, file_path, file_type, file_size, uploaded_by, created_at
    )
    values (
      target_submission_id, closure_file_name, closure_file_path, closure_file_type,
      closure_file_size, auth.uid(), now_at
    );
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions as target
  set status = 'completed',
      closed_by = auth.uid(),
      closure_note = note,
      closure_file_path = workflow_mvp_close_submission_internal.closure_file_path,
      closure_file_name = workflow_mvp_close_submission_internal.closure_file_name,
      closure_file_type = workflow_mvp_close_submission_internal.closure_file_type,
      closure_file_size = workflow_mvp_close_submission_internal.closure_file_size,
      completed_at = now_at,
      updated_at = now_at
  where target.id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  perform public.workflow_mvp_record_history(
    target_submission_id, 'SUBMISSION_CLOSED', submission.status, 'completed',
    concat_ws(E'\n', note, case when has_file then 'Completion document: ' || closure_file_name end),
    now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  values (
    submission.user_id, target_submission_id, 'SUBMISSION_CLOSED',
    'Your submission has been completed',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name
  )
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$function$;

create or replace function public.decide_workflow_submission(
  target_submission_id uuid,
  next_status text,
  decision_comments text default null,
  routed_office_role text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor_role text;
  submission public.workflow_submissions;
begin
  select profile.role
  into actor_role
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.id = auth.uid()
    and profile.is_active
    and account.banned_until is null;

  if auth.uid() is null or actor_role is null then
    raise exception 'An active authenticated profile is required';
  end if;

  select *
  into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;

  if not found then
    raise exception 'Submission % not found', target_submission_id;
  end if;

  if actor_role = 'tourism_officer'
    and submission.status in ('pending', 'pending_approver')
    and next_status = 'pending_admin'
    and routed_office_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then
    update public.workflow_submissions
    set status = next_status,
        selected_office_role = routed_office_role,
        approver_comments = decision_comments,
        updated_at = timezone('utc', now())
    where id = target_submission_id;
    return;
  end if;

  if actor_role = 'system_admin'
    and submission.status = 'pending_admin'
    and next_status = 'pending_office'
    and routed_office_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then
    update public.workflow_submissions
    set status = next_status,
        selected_office_role = routed_office_role,
        admin_comments = decision_comments,
        updated_at = timezone('utc', now())
    where id = target_submission_id;
    return;
  end if;

  if actor_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan')
    and actor_role = submission.selected_office_role
    and submission.status = 'pending_office'
    and next_status = 'pending_mayor' then
    update public.workflow_submissions
    set status = next_status,
        office_comments = decision_comments,
        updated_at = timezone('utc', now())
    where id = target_submission_id;
    return;
  end if;

  if actor_role = 'mayor_office'
    and submission.status = 'pending_mayor'
    and next_status = 'returned_for_requirements'
    and coalesce(length(btrim(decision_comments)), 0) > 0 then
    update public.workflow_submissions
    set status = next_status,
        mayor_comments = decision_comments,
        updated_at = timezone('utc', now())
    where id = target_submission_id;
    return;
  end if;

  raise exception 'Generic approval and rejection decisions are not available; use Complete submission, request changes, or the configured formal-decision workflow';
end;
$function$;
