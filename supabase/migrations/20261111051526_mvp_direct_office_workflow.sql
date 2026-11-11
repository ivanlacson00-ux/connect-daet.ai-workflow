alter table public.workflow_submissions
  add column if not exists received_by uuid references public.profiles(id) on delete set null,
  add column if not exists received_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id) on delete set null,
  add column if not exists closure_note text,
  add column if not exists closure_file_path text,
  add column if not exists closure_file_name text,
  add column if not exists closure_file_type text,
  add column if not exists closure_file_size bigint;

alter table public.workflow_routing_steps
  drop constraint if exists workflow_routing_steps_status_check,
  drop constraint if exists workflow_routing_steps_completion_timestamp_check,
  drop constraint if exists workflow_routing_steps_started_timestamp_check;

alter table public.workflow_routing_steps
  add constraint workflow_routing_steps_status_check
    check (status in (
      'pending', 'in_progress', 'approved', 'rejected', 'completed',
      'skipped', 'returned', 'withdrawn'
    )),
  add constraint workflow_routing_steps_completion_timestamp_check
    check (
      (
        status in ('approved', 'rejected', 'skipped', 'returned', 'withdrawn')
        and decided_at is not null
        and completed_at is null
      )
      or (
        status = 'completed'
        and decided_at is null
        and completed_at is not null
      )
      or (
        status in ('pending', 'in_progress')
        and decided_at is null
        and completed_at is null
      )
    ),
  add constraint workflow_routing_steps_started_timestamp_check
    check (
      (
        status in ('in_progress', 'approved', 'rejected', 'completed')
        and started_at is not null
      )
      or status in ('pending', 'skipped', 'returned', 'withdrawn')
    );

create or replace function public.workflow_mvp_active_role()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before using the workflow';
  end if;

  select profile.role
  into actor_role
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.id = auth.uid()
    and profile.is_active
    and (account.banned_until is null or account.banned_until <= timezone('utc', now()));

  if actor_role is null then
    raise exception 'An active account profile is required';
  end if;

  return actor_role;
end;
$$;

create or replace function public.workflow_mvp_has_pending_assignment(
  target_submission_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_routing_plans plan
    join public.workflow_routing_steps step on step.routing_plan_id = plan.id
    where plan.submission_id = target_submission_id
      and step.status in ('pending', 'in_progress')
  )
$$;

create or replace function public.workflow_mvp_record_history(
  target_submission_id uuid,
  event_type text,
  previous_status text,
  next_status text,
  event_comments text,
  event_time timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id, auth.uid(), event_type, previous_status, next_status,
    nullif(btrim(event_comments), ''), event_time
  )
$$;

create or replace function public.sync_workflow_stage_timing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_time timestamptz := coalesce(new.updated_at, timezone('utc', now()));
  office_route_advanced boolean := false;
begin
  if tg_op = 'INSERT' then
    new.submitted_at := coalesce(new.submitted_at, new.created_at, event_time);
    new.current_stage_started_at := coalesce(new.current_stage_started_at, new.submitted_at);
  else
    office_route_advanced := old.status = 'pending_office'
      and new.status = 'pending_office'
      and old.selected_office_role is distinct from new.selected_office_role;

    if new.status is distinct from old.status or office_route_advanced then
      if new.status in ('submitted', 'pending', 'pending_approver') then
        new.current_stage_started_at := event_time;
      elsif new.status in (
        'in_process', 'changes_requested', 'returned',
        'pending_admin', 'pending_office', 'pending_mayor',
        'returned_for_requirements'
      ) then
        new.current_stage_started_at := event_time;
        if new.status = 'pending_office' then
          new.verified_at := coalesce(new.verified_at, event_time);
          if office_route_advanced then
            new.office_reviewed_at := event_time;
          else
            new.office_reviewed_at := null;
          end if;
        elsif new.status in ('in_process', 'changes_requested') then
          new.office_reviewed_at := coalesce(new.office_reviewed_at, event_time);
        end if;
      elsif new.status in ('completed', 'withdrawn') then
        if new.status = 'completed' then
          new.completed_at := coalesce(new.completed_at, event_time);
        end if;
        new.current_stage_started_at := null;
      elsif new.status like 'declined_by_%' then
        new.current_stage_started_at := null;
      end if;
    end if;
  end if;

  new.current_stage_due_at := public.workflow_stage_deadline(
    new.status,
    new.current_stage_started_at
  );
  new.current_responsible_role := case
    when new.status in ('submitted', 'in_process') then new.selected_office_role
    when new.status in ('changes_requested', 'returned') then 'submitter'
    when new.status in ('pending', 'pending_approver') then 'tourism_officer'
    when new.status = 'pending_admin' then 'system_admin'
    when new.status = 'pending_office' then new.selected_office_role
    when new.status = 'pending_mayor' then 'mayor_office'
    when new.status = 'returned_for_requirements' then 'submitter'
    else null
  end;
  return new;
end;
$$;

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
  submission_office_role text,
  attachment_records jsonb default '[]'::jsonb,
  submission_other_document_type text default null
)
returns table (id uuid, tracking_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  created_submission public.workflow_submissions;
  attachment_record record;
  normalized_other_document_type text := nullif(btrim(submission_other_document_type), '');
  now_at timestamptz := timezone('utc', now());
begin
  if actor_role is distinct from 'submitter' then
    raise exception 'Only a submitter can create a workflow submission';
  end if;
  if coalesce(length(btrim(submission_title)), 0) = 0
    or coalesce(length(btrim(submission_file_path)), 0) = 0
    or coalesce(length(btrim(submission_document_type)), 0) = 0
    or coalesce(length(btrim(submission_description)), 0) = 0
    or submission_file_size is null
    or submission_file_size < 1 then
    raise exception 'Title, document, document type, and description are required';
  end if;
  if submission_office_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'Select a valid destination office';
  end if;
  if not exists (
    select 1
    from public.workflow_office_document_types document_type
    where document_type.office_role = submission_office_role
      and document_type.document_type = submission_document_type
  ) then
    raise exception 'Select a document type available for the destination office';
  end if;
  if submission_document_type = 'Other' then
    if normalized_other_document_type is null
      or length(normalized_other_document_type) > 120 then
      raise exception 'Specify the document type using no more than 120 characters';
    end if;
  elsif normalized_other_document_type is not null then
    raise exception 'A custom document type is only allowed when Other is selected';
  end if;
  if submission_file_path not like (auth.uid()::text || '/%')
    or attachment_records is null
    or jsonb_typeof(attachment_records) is distinct from 'array' then
    raise exception 'Invalid document storage path or attachment list';
  end if;

  insert into public.workflow_submissions (
    user_id, file_url, file_path, file_name, file_size, file_type, category,
    other_document_type, description, purpose, requested_action, intended_recipient,
    selected_office_role, initial_destination_role, status, updated_at
  )
  values (
    auth.uid(), submission_file_url, submission_file_path, submission_title,
    submission_file_size, submission_file_type, submission_document_type,
    normalized_other_document_type, submission_description,
    nullif(btrim(submission_purpose), ''),
    nullif(btrim(submission_requested_action), ''),
    nullif(btrim(submission_intended_recipient), ''),
    submission_office_role, submission_office_role, 'submitted', now_at
  )
  returning * into created_submission;

  insert into public.workflow_submission_versions (
    submission_id, version_number, file_name, file_path, file_type, file_size, uploaded_by
  )
  values (
    created_submission.id, 1, created_submission.file_name, created_submission.file_path,
    created_submission.file_type, created_submission.file_size, auth.uid()
  );

  for attachment_record in
    select *
    from jsonb_to_recordset(attachment_records) as attachment(
      file_name text, file_path text, file_type text, file_size bigint
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
      created_submission.id, attachment_record.file_name, attachment_record.file_path,
      attachment_record.file_type, attachment_record.file_size, auth.uid()
    );
  end loop;

  perform public.workflow_mvp_record_history(
    created_submission.id, 'DESTINATION_SELECTED', null, 'submitted',
    'Initial destination selected by submitter: ' || submission_office_role, now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    created_submission.id,
    'DESTINATION_SELECTED',
    'New submission routed to your office',
    coalesce(created_submission.tracking_number, 'Pending tracking number')
      || ' — ' || created_submission.file_name
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.role = submission_office_role
    and profile.is_active
    and (account.banned_until is null or account.banned_until <= now_at)
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;

  return query select created_submission.id, created_submission.tracking_number;
end;
$$;

create or replace function public.receive_workflow_submission(target_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  now_at timestamptz := timezone('utc', now());
begin
  if actor_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'An active office representative is required to receive this submission';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found or submission.selected_office_role is distinct from actor_role then
    raise exception 'Only the responsible office can receive this submission';
  end if;
  if submission.status = 'in_process' then
    return;
  end if;
  if submission.status <> 'submitted' then
    raise exception 'This submission is not waiting to be received';
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'in_process',
      received_by = auth.uid(),
      received_at = now_at,
      office_reviewed_at = now_at,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  perform public.workflow_mvp_record_history(
    target_submission_id, 'SUBMISSION_RECEIVED', 'submitted', 'in_process',
    'Received by ' || actor_role, now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  values (
    submission.user_id, target_submission_id, 'SUBMISSION_RECEIVED',
    'Your submission is in process',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name
  )
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;

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
  message text := nullif(btrim(message_body), '');
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
  if message_id is null or message is null or char_length(message) > 5000 then
    raise exception 'Provide a forwarding context of 1 to 5,000 characters';
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
    'recommendation', 'office_forward', message
  );

  insert into public.workflow_messages (id, submission_id, sender_id, body)
  values (message_id, target_submission_id, auth.uid(), message);

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
    target_office_role || ' — Recommendation: ' || message, now_at
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

create or replace function public.complete_workflow_assignment(
  target_submission_id uuid,
  completion_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  current_step public.workflow_routing_steps;
  now_at timestamptz := timezone('utc', now());
begin
  if actor_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'An active recipient office member is required to complete the assignment';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found or submission.status <> 'in_process' then
    raise exception 'The submission is not in process';
  end if;
  if submission.selected_office_role = actor_role then
    raise exception 'The responsible office cannot complete its own forward assignment';
  end if;

  select step.* into current_step
  from public.workflow_routing_plans plan
  join public.workflow_routing_steps step on step.routing_plan_id = plan.id
  where plan.submission_id = target_submission_id
    and plan.is_current
    and plan.status = 'finalized'
    and step.office_role = actor_role
    and step.status in ('pending', 'in_progress')
  for update of step;
  if not found then
    raise exception 'Your office has no Pending assignment for this submission';
  end if;

  update public.workflow_routing_steps
  set status = 'completed',
      started_at = coalesce(current_step.started_at, now_at),
      completed_by = auth.uid(),
      completed_at = now_at,
      comments = nullif(btrim(completion_notes), '')
  where id = current_step.id;

  perform public.workflow_mvp_record_history(
    target_submission_id, 'ASSIGNMENT_COMPLETED', 'in_process', 'in_process',
    actor_role || coalesce(': ' || nullif(btrim(completion_notes), ''), ''), now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id, target_submission_id, 'ASSIGNMENT_COMPLETED',
    'Forwarded assignment completed',
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

create or replace function public.return_workflow_assignment(
  target_submission_id uuid,
  return_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  current_step public.workflow_routing_steps;
  now_at timestamptz := timezone('utc', now());
  reason text := nullif(btrim(return_reason), '');
begin
  if actor_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'An active recipient office member is required to return the assignment';
  end if;
  if reason is null then
    raise exception 'Provide a reason for returning the assignment';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found or submission.status <> 'in_process' then
    raise exception 'The submission is not in process';
  end if;
  if submission.selected_office_role = actor_role then
    raise exception 'The responsible office cannot return its own submission assignment';
  end if;

  select step.* into current_step
  from public.workflow_routing_plans plan
  join public.workflow_routing_steps step on step.routing_plan_id = plan.id
  where plan.submission_id = target_submission_id
    and plan.is_current
    and plan.status = 'finalized'
    and step.office_role = actor_role
    and step.status in ('pending', 'in_progress')
  for update of step;
  if not found then
    raise exception 'Your office has no Pending assignment for this submission';
  end if;

  update public.workflow_routing_steps
  set status = 'returned',
      decided_by = auth.uid(),
      decided_at = now_at,
      comments = reason
  where id = current_step.id;

  perform public.workflow_mvp_record_history(
    target_submission_id, 'ASSIGNMENT_RETURNED', 'in_process', 'in_process',
    actor_role || ': ' || reason, now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id, target_submission_id, 'ASSIGNMENT_RETURNED',
    'A forwarded assignment was returned',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name || ': ' || reason
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.role = submission.selected_office_role
    and profile.is_active
    and (account.banned_until is null or account.banned_until <= now_at)
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;

create or replace function public.withdraw_workflow_assignment(
  target_submission_id uuid,
  target_assignment_office_role text,
  withdrawal_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  pending_step public.workflow_routing_steps;
  now_at timestamptz := timezone('utc', now());
  reason text := nullif(btrim(withdrawal_reason), '');
begin
  if actor_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'An active responsible-office member is required to withdraw an assignment';
  end if;
  if reason is null then
    raise exception 'Provide a reason for withdrawing the assignment';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found or submission.selected_office_role is distinct from actor_role then
    raise exception 'Only the responsible office can withdraw an assignment';
  end if;
  if submission.status not in ('in_process', 'changes_requested') then
    raise exception 'This submission cannot withdraw an assignment in its current status';
  end if;
  if target_assignment_office_role is null
    or target_assignment_office_role = submission.selected_office_role then
    raise exception 'Select the forwarded office assignment to withdraw';
  end if;

  select step.* into pending_step
  from public.workflow_routing_plans plan
  join public.workflow_routing_steps step on step.routing_plan_id = plan.id
  where plan.submission_id = target_submission_id
    and plan.is_current
    and plan.status = 'finalized'
    and step.office_role = target_assignment_office_role
    and step.status in ('pending', 'in_progress')
  for update of step;
  if not found then
    raise exception 'That office has no Pending assignment to withdraw';
  end if;

  update public.workflow_routing_steps
  set status = 'withdrawn',
      decided_by = auth.uid(),
      decided_at = now_at,
      comments = reason
  where id = pending_step.id;

  perform public.workflow_mvp_record_history(
    target_submission_id, 'ASSIGNMENT_WITHDRAWN', submission.status, submission.status,
    target_assignment_office_role || ': ' || reason, now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id, target_submission_id, 'ASSIGNMENT_WITHDRAWN',
    'A forwarded assignment was withdrawn',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.role = target_assignment_office_role
    and profile.is_active
    and (account.banned_until is null or account.banned_until <= now_at)
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;

create or replace function public.request_workflow_submission_changes(
  target_submission_id uuid,
  request_comments text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  now_at timestamptz := timezone('utc', now());
  reason text := nullif(btrim(request_comments), '');
begin
  if actor_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'An active responsible-office member is required to request changes';
  end if;
  if reason is null then
    raise exception 'Explain the changes required before requesting them';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found
    or submission.status <> 'in_process'
    or submission.selected_office_role is distinct from actor_role then
    raise exception 'Only the responsible office can request changes while in process';
  end if;
  if public.workflow_mvp_has_pending_assignment(target_submission_id) then
    raise exception 'A Pending office assignment must be completed, returned, or withdrawn first';
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'changes_requested',
      office_comments = reason,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  perform public.workflow_mvp_record_history(
    target_submission_id, 'CHANGES_REQUESTED', 'in_process', 'changes_requested',
    reason, now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  values (
    submission.user_id, target_submission_id, 'CHANGES_REQUESTED',
    'Changes requested for your submission',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name || ': ' || reason
  )
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;

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
  if not found or submission.status <> 'changes_requested' then
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
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  perform public.workflow_mvp_record_history(
    target_submission_id, 'CHANGES_RESPONDED', 'changes_requested', 'in_process',
    response, now_at
  );
  if has_file then
    perform public.workflow_mvp_record_history(
      target_submission_id, 'FILE_VERSION_ADDED', 'changes_requested', 'in_process',
      'Document version ' || next_version || ' uploaded: ' || revised_file_name, now_at
    );
  end if;

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id, target_submission_id, 'CHANGES_RESPONDED',
    'Submitter responded to requested changes',
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

create or replace function public.return_workflow_submission_to_submitter(
  target_submission_id uuid,
  return_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  now_at timestamptz := timezone('utc', now());
  reason text := nullif(btrim(return_reason), '');
begin
  if actor_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'An active responsible-office member is required to return this submission';
  end if;
  if reason is null then
    raise exception 'Provide a reason for returning the submission to the submitter';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found
    or submission.selected_office_role is distinct from actor_role
    or submission.status not in ('submitted', 'in_process') then
    raise exception 'Only the responsible office can return a Submitted or In Process submission';
  end if;

  with withdrawn_assignments as (
    update public.workflow_routing_steps step
    set status = 'withdrawn',
        decided_by = auth.uid(),
        decided_at = now_at,
        comments = 'Automatically withdrawn because the submission was returned: ' || reason
    from public.workflow_routing_plans plan
    where plan.submission_id = target_submission_id
      and plan.id = step.routing_plan_id
      and step.status in ('pending', 'in_progress')
    returning step.office_role
  )
  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  select
    target_submission_id, auth.uid(), 'ASSIGNMENT_WITHDRAWN',
    submission.status, 'returned',
    withdrawn_assignments.office_role
      || ': automatically withdrawn because the submission was returned',
    now_at
  from withdrawn_assignments;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'returned',
      office_comments = reason,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  perform public.workflow_mvp_record_history(
    target_submission_id, 'RETURNED_TO_SUBMITTER', submission.status, 'returned',
    reason, now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  values (
    submission.user_id, target_submission_id, 'RETURNED_TO_SUBMITTER',
    'Your submission was returned for redirection',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name || ': ' || reason
  )
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;

create or replace function public.redirect_workflow_submission(
  target_submission_id uuid,
  target_office_role text,
  new_document_type text,
  new_other_document_type text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  normalized_other_document_type text := nullif(btrim(new_other_document_type), '');
  now_at timestamptz := timezone('utc', now());
begin
  if actor_role is distinct from 'submitter' then
    raise exception 'Only the submitter can redirect a returned submission';
  end if;
  if target_office_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'Select a permitted destination office';
  end if;
  if not exists (
    select 1
    from public.workflow_office_document_types document_type
    where document_type.office_role = target_office_role
      and document_type.document_type = new_document_type
  ) then
    raise exception 'Select a document type available for the new destination';
  end if;
  if new_document_type = 'Other' then
    if normalized_other_document_type is null
      or length(normalized_other_document_type) > 120 then
      raise exception 'Specify the document type using no more than 120 characters';
    end if;
  elsif normalized_other_document_type is not null then
    raise exception 'A custom document type is only allowed when Other is selected';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
    and user_id = auth.uid()
  for update;
  if not found or submission.status <> 'returned' then
    raise exception 'This submission is not waiting for redirection';
  end if;
  if public.workflow_mvp_has_pending_assignment(target_submission_id) then
    raise exception 'Pending office assignments must be withdrawn before redirecting';
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

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'submitted',
      selected_office_role = target_office_role,
      category = new_document_type,
      other_document_type = normalized_other_document_type,
      office_comments = null,
      mayor_comments = null,
      sender_response = null,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  perform public.workflow_mvp_record_history(
    target_submission_id, 'SUBMISSION_REDIRECTED', 'returned', 'submitted',
    'Destination changed from ' || coalesce(submission.selected_office_role, 'unknown')
      || ' to ' || target_office_role || '; document type: ' || new_document_type,
    now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id, target_submission_id, 'SUBMISSION_REDIRECTED',
    'Submission redirected to your office',
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

create or replace function public.withdraw_workflow_submission(
  target_submission_id uuid,
  withdrawal_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  now_at timestamptz := timezone('utc', now());
  reason text := nullif(btrim(withdrawal_reason), '');
begin
  if actor_role is distinct from 'submitter' then
    raise exception 'Only the submitter can withdraw this submission';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
    and user_id = auth.uid()
  for update;
  if not found then
    raise exception 'Submission not found';
  end if;
  if submission.status in ('completed', 'withdrawn') then
    raise exception 'This submission can no longer be withdrawn';
  end if;

  with withdrawn_assignments as (
    update public.workflow_routing_steps step
    set status = 'withdrawn',
        decided_by = auth.uid(),
        decided_at = now_at,
        comments = 'Automatically withdrawn with the submission'
    from public.workflow_routing_plans plan
    where plan.submission_id = target_submission_id
      and plan.id = step.routing_plan_id
      and step.status in ('pending', 'in_progress')
    returning step.office_role
  )
  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  select
    target_submission_id, auth.uid(), 'ASSIGNMENT_WITHDRAWN',
    submission.status, 'withdrawn',
    withdrawn_assignments.office_role || ': automatically withdrawn with the submission',
    now_at
  from withdrawn_assignments;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'withdrawn',
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  perform public.workflow_mvp_record_history(
    target_submission_id, 'SUBMISSION_WITHDRAWN', submission.status, 'withdrawn',
    reason, now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select distinct
    profile.id, target_submission_id, 'SUBMISSION_WITHDRAWN',
    'A submission was withdrawn',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.is_active
    and (account.banned_until is null or account.banned_until <= now_at)
    and (
      profile.role = submission.selected_office_role
      or exists (
        select 1
        from public.workflow_routing_plans plan
        join public.workflow_routing_steps step on step.routing_plan_id = plan.id
        where plan.submission_id = target_submission_id
          and step.office_role = profile.role
      )
    )
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;

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
as $$
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
    raise exception 'An active responsible-office representative is required to close this submission';
  end if;
  if note is not null and char_length(note) > 5000 then
    raise exception 'Closure note must be no more than 5,000 characters';
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
    raise exception 'Provide complete metadata for the optional closure file';
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
    raise exception 'Only the responsible office can close a submission in process or awaiting changes';
  end if;
  if public.workflow_mvp_has_pending_assignment(target_submission_id) then
    raise exception 'Pending office assignments prevent closing this submission';
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
  update public.workflow_submissions
  set status = 'completed',
      closed_by = auth.uid(),
      closure_note = note,
      closure_file_path = case when has_file then closure_file_path else null end,
      closure_file_name = case when has_file then closure_file_name else null end,
      closure_file_type = case when has_file then closure_file_type else null end,
      closure_file_size = case when has_file then closure_file_size else null end,
      completed_at = now_at,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  perform public.workflow_mvp_record_history(
    target_submission_id, 'SUBMISSION_CLOSED', submission.status, 'completed',
    concat_ws(E'\n', note, case when has_file then 'Closure file: ' || closure_file_name end),
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
$$;

create or replace function public.close_workflow_submission_with_details(
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
as $$
begin
  perform public.workflow_mvp_close_submission_internal(
    target_submission_id, closure_note, closure_file_path,
    closure_file_name, closure_file_type, closure_file_size
  );
end;
$$;

create or replace function public.close_workflow_submission(target_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.workflow_mvp_close_submission_internal(
    target_submission_id, null, null, null, null, null
  );
end;
$$;

revoke all on function public.workflow_mvp_active_role() from public, anon;
revoke all on function public.workflow_mvp_has_pending_assignment(uuid) from public, anon;
revoke all on function public.workflow_mvp_record_history(uuid, text, text, text, text, timestamptz)
  from public, anon;
revoke all on function public.workflow_mvp_close_submission_internal(uuid, text, text, text, text, bigint)
  from public, anon, authenticated;

revoke all on function public.create_workflow_submission(
  text, text, text, text, bigint, text, text, text, text, text, text, jsonb, text
) from public, anon;
revoke all on function public.receive_workflow_submission(uuid) from public, anon;
revoke all on function public.forward_workflow_submission_to_office(uuid, text, uuid, text, jsonb)
  from public, anon;
revoke all on function public.complete_workflow_assignment(uuid, text) from public, anon;
revoke all on function public.return_workflow_assignment(uuid, text) from public, anon;
revoke all on function public.withdraw_workflow_assignment(uuid, text, text) from public, anon;
revoke all on function public.request_workflow_submission_changes(uuid, text) from public, anon;
revoke all on function public.respond_to_workflow_submission_changes(
  uuid, text, text, text, text, text, bigint
) from public, anon;
revoke all on function public.return_workflow_submission_to_submitter(uuid, text)
  from public, anon;
revoke all on function public.redirect_workflow_submission(uuid, text, text, text)
  from public, anon;
revoke all on function public.withdraw_workflow_submission(uuid, text) from public, anon;
revoke all on function public.close_workflow_submission_with_details(
  uuid, text, text, text, text, bigint
) from public, anon;
revoke all on function public.close_workflow_submission(uuid) from public, anon;

grant execute on function public.create_workflow_submission(
  text, text, text, text, bigint, text, text, text, text, text, text, jsonb, text
) to authenticated;
grant execute on function public.receive_workflow_submission(uuid) to authenticated;
grant execute on function public.forward_workflow_submission_to_office(uuid, text, uuid, text, jsonb)
  to authenticated;
grant execute on function public.complete_workflow_assignment(uuid, text) to authenticated;
grant execute on function public.return_workflow_assignment(uuid, text) to authenticated;
grant execute on function public.withdraw_workflow_assignment(uuid, text, text) to authenticated;
grant execute on function public.request_workflow_submission_changes(uuid, text) to authenticated;
grant execute on function public.respond_to_workflow_submission_changes(
  uuid, text, text, text, text, text, bigint
) to authenticated;
grant execute on function public.return_workflow_submission_to_submitter(uuid, text)
  to authenticated;
grant execute on function public.redirect_workflow_submission(uuid, text, text, text)
  to authenticated;
grant execute on function public.withdraw_workflow_submission(uuid, text) to authenticated;
grant execute on function public.close_workflow_submission_with_details(
  uuid, text, text, text, text, bigint
) to authenticated;
grant execute on function public.close_workflow_submission(uuid) to authenticated;

comment on column public.workflow_submissions.received_by is
  'Profile of the active office representative who first received this MVP submission.';
comment on column public.workflow_submissions.closed_by is
  'Active responsible-office profile that closed this submission; closure is not approval.';
comment on column public.workflow_submissions.closure_note is
  'Optional closure note visible to the submitter.';
