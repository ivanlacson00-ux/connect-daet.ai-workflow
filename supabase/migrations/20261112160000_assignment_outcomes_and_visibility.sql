-- Make forwarded office assignments visible to the office that asked.
--   * Each assignment response records an explicit outcome.
--   * Onward forwarding records the forwarding office's own outcome first.
--   * History and notifications name the office and outcome (no role codes),
--     and every assignment gets its own notification (no silent de-duplication).
--   * Routing plans/steps are published for live page updates.
-- One assignment at a time is unchanged.

alter table public.workflow_routing_steps
  add column if not exists outcome text;

alter table public.workflow_routing_steps
  drop constraint if exists workflow_routing_steps_outcome_check;
alter table public.workflow_routing_steps
  add constraint workflow_routing_steps_outcome_check
  check (outcome is null or outcome in ('endorsed', 'endorsed_with_conditions', 'not_endorsed'));

create or replace function public.workflow_office_label(office_role text)
returns text
language sql
immutable
set search_path = public
as $$
  select case office_role
    when 'tourism_officer' then 'Daet Tourism Office'
    when 'municipal_treasurer' then 'Municipal Treasurer''s Office'
    when 'mayor_office' then 'Mayor''s Office'
    when 'sangguniang_bayan' then 'Sangguniang Bayan Office'
    else coalesce(replace(office_role, '_', ' '), 'Unknown office')
  end
$$;

create or replace function public.workflow_assignment_outcome_label(assignment_outcome text)
returns text
language sql
immutable
set search_path = public
as $$
  select case assignment_outcome
    when 'endorsed' then 'Endorsed'
    when 'endorsed_with_conditions' then 'Endorsed with conditions'
    when 'not_endorsed' then 'Not endorsed'
    else null
  end
$$;

-- ─── Respond to (complete) an assignment ─────────────────────────────────────
drop function if exists public.complete_workflow_assignment(uuid, text);

create function public.complete_workflow_assignment(
  target_submission_id uuid,
  completion_notes text default null,
  assignment_outcome text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  current_step public.workflow_routing_steps;
  now_at timestamptz := timezone('utc', now());
  note text := nullif(btrim(completion_notes), '');
  outcome_label text := public.workflow_assignment_outcome_label(assignment_outcome);
begin
  if actor_role not in ('tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then
    raise exception 'An active recipient office member is required to respond to the assignment';
  end if;
  if outcome_label is null then
    raise exception 'Choose an outcome: Endorsed, Endorsed with conditions, or Not endorsed';
  end if;
  if assignment_outcome <> 'endorsed' and note is null then
    raise exception 'Add a note explaining the conditions or why the submission is not endorsed';
  end if;
  if note is not null and char_length(note) > 5000 then
    raise exception 'The note must be 5,000 characters or fewer';
  end if;

  select * into submission from public.workflow_submissions where id = target_submission_id for update;
  if not found or submission.status <> 'in_process' then
    raise exception 'The submission is not in process';
  end if;
  if submission.selected_office_role = actor_role then
    raise exception 'The responsible office cannot respond to its own forward assignment';
  end if;

  select step.* into current_step
  from public.workflow_routing_plans plan
  join public.workflow_routing_steps step on step.routing_plan_id = plan.id
  where plan.submission_id = target_submission_id and plan.is_current and plan.status = 'finalized'
    and step.office_role = actor_role and step.status in ('pending', 'in_progress')
  for update of step;
  if not found then
    raise exception 'Your office has no Pending assignment for this submission';
  end if;

  update public.workflow_routing_steps
  set status = 'completed',
      started_at = coalesce(current_step.started_at, now_at),
      completed_by = auth.uid(),
      completed_at = now_at,
      outcome = assignment_outcome,
      comments = note
  where id = current_step.id;

  -- The note stays on the assignment (office-only); history carries office and outcome.
  perform public.workflow_mvp_record_history(
    target_submission_id, 'ASSIGNMENT_COMPLETED', 'in_process', 'in_process',
    public.workflow_office_label(actor_role) || ' — ' || outcome_label, now_at
  );

  insert into public.workflow_notifications (recipient_id, submission_id, event_type, title, message)
  select profile.id, target_submission_id,
    'ASSIGNMENT_COMPLETED:' || current_step.id::text,
    public.workflow_office_label(actor_role) || ' responded: ' || outcome_label,
    coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
      || coalesce(E'\n' || note, '')
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.role in (submission.selected_office_role, current_step.assigned_by_role)
    and profile.role <> actor_role
    and profile.is_active
    and (account.banned_until is null or account.banned_until <= now_at)
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$function$;

revoke all on function public.complete_workflow_assignment(uuid, text, text) from public, anon;
grant execute on function public.complete_workflow_assignment(uuid, text, text) to authenticated, service_role;

-- ─── Return an assignment ────────────────────────────────────────────────────
create or replace function public.return_workflow_assignment(target_submission_id uuid, return_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  current_step public.workflow_routing_steps;
  now_at timestamptz := timezone('utc', now());
  reason text := nullif(btrim(return_reason), '');
begin
  if actor_role not in ('tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then
    raise exception 'An active recipient office member is required to return the assignment';
  end if;
  if reason is null then raise exception 'Provide a reason for returning the assignment'; end if;
  select * into submission from public.workflow_submissions where id = target_submission_id for update;
  if not found or submission.status <> 'in_process' then raise exception 'The submission is not in process'; end if;
  if submission.selected_office_role = actor_role then raise exception 'The responsible office cannot return its own submission assignment'; end if;
  select step.* into current_step from public.workflow_routing_plans plan
  join public.workflow_routing_steps step on step.routing_plan_id = plan.id
  where plan.submission_id = target_submission_id and plan.is_current and plan.status = 'finalized'
    and step.office_role = actor_role and step.status in ('pending', 'in_progress') for update of step;
  if not found then raise exception 'Your office has no Pending assignment for this submission'; end if;

  update public.workflow_routing_steps
  set status = 'returned', decided_by = auth.uid(), decided_at = now_at, comments = reason
  where id = current_step.id;

  perform public.workflow_mvp_record_history(
    target_submission_id, 'ASSIGNMENT_RETURNED', 'in_process', 'in_process',
    public.workflow_office_label(actor_role) || ' returned the assignment without a response', now_at
  );

  insert into public.workflow_notifications (recipient_id, submission_id, event_type, title, message)
  select profile.id, target_submission_id,
    'ASSIGNMENT_RETURNED:' || current_step.id::text,
    public.workflow_office_label(actor_role) || ' returned the assignment',
    coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
      || E'\n' || reason
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.role in (submission.selected_office_role, current_step.assigned_by_role)
    and profile.role <> actor_role
    and profile.is_active
    and (account.banned_until is null or account.banned_until <= now_at)
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$function$;

-- ─── Withdraw an assignment ──────────────────────────────────────────────────
create or replace function public.withdraw_workflow_assignment(
  target_submission_id uuid,
  target_assignment_office_role text,
  withdrawal_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  pending_step public.workflow_routing_steps;
  now_at timestamptz := timezone('utc', now());
  reason text := nullif(btrim(withdrawal_reason), '');
begin
  if actor_role not in ('tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then raise exception 'An active responsible-office member is required to withdraw an assignment'; end if;
  if reason is null then raise exception 'Provide a reason for withdrawing the assignment'; end if;
  select * into submission from public.workflow_submissions where id = target_submission_id for update;
  if not found or submission.selected_office_role is distinct from actor_role then raise exception 'Only the responsible office can withdraw an assignment'; end if;
  if submission.status not in ('in_process', 'changes_requested') then raise exception 'This submission cannot withdraw an assignment in its current status'; end if;
  if target_assignment_office_role is null or target_assignment_office_role = submission.selected_office_role then raise exception 'Select the forwarded office assignment to withdraw'; end if;
  select step.* into pending_step from public.workflow_routing_plans plan
  join public.workflow_routing_steps step on step.routing_plan_id = plan.id
  where plan.submission_id = target_submission_id and plan.is_current and plan.status = 'finalized'
    and step.office_role = target_assignment_office_role and step.status in ('pending', 'in_progress') for update of step;
  if not found then raise exception 'That office has no Pending assignment to withdraw'; end if;

  update public.workflow_routing_steps
  set status = 'withdrawn', decided_by = auth.uid(), decided_at = now_at, comments = reason
  where id = pending_step.id;

  perform public.workflow_mvp_record_history(
    target_submission_id, 'ASSIGNMENT_WITHDRAWN', submission.status, submission.status,
    public.workflow_office_label(actor_role) || ' withdrew the assignment with '
      || public.workflow_office_label(target_assignment_office_role), now_at
  );

  insert into public.workflow_notifications (recipient_id, submission_id, event_type, title, message)
  select profile.id, target_submission_id,
    'ASSIGNMENT_WITHDRAWN:' || pending_step.id::text,
    public.workflow_office_label(actor_role) || ' withdrew your assignment',
    coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
      || E'\n' || reason
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.role = target_assignment_office_role
    and profile.is_active
    and (account.banned_until is null or account.banned_until <= now_at)
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$function$;

-- ─── Forward to another office ───────────────────────────────────────────────
drop function if exists public.forward_workflow_submission_to_office(uuid, text, uuid, uuid, text, jsonb);

create function public.forward_workflow_submission_to_office(
  target_submission_id uuid,
  target_office_role text,
  message_id uuid,
  target_assignment_id uuid,
  message_body text,
  attachment_records jsonb,
  forwarder_outcome text default null,
  forwarder_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  current_plan public.workflow_routing_plans;
  current_step public.workflow_routing_steps;
  plan_id uuid;
  next_version integer;
  now_at timestamptz := timezone('utc', now());
  request_context text := nullif(btrim(message_body), '');
  attachment_count integer;
  own_note text := nullif(btrim(forwarder_note), '');
  own_outcome_label text := public.workflow_assignment_outcome_label(forwarder_outcome);
begin
  if actor_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'An active office representative is required to forward this submission';
  end if;
  if target_office_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) or target_office_role = actor_role then
    raise exception 'Choose a different active office to receive this submission';
  end if;
  if message_id is null or target_assignment_id is null
    or target_assignment_id = message_id then
    raise exception 'Message and assignment identifiers are required';
  end if;
  if request_context is not null and char_length(request_context) > 5000 then
    raise exception 'Forwarding context must be 5,000 characters or fewer';
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
  if not found or submission.status <> 'in_process' then
    raise exception 'Only an office processing this submission can forward it';
  end if;
  if target_office_role = submission.selected_office_role then
    raise exception 'The target office must differ from the responsible office';
  end if;

  select * into current_plan
  from public.workflow_routing_plans
  where submission_id = target_submission_id
    and is_current
    and status = 'finalized'
  for update;

  if found then
    select step.* into current_step
    from public.workflow_routing_steps step
    where step.routing_plan_id = current_plan.id
      and step.office_role = actor_role
      and step.status in ('pending', 'in_progress')
    for update;

    if current_step.id is null
      and submission.selected_office_role is distinct from actor_role then
      raise exception 'Your office does not have an active assignment to forward';
    end if;

    if exists (
      select 1
      from public.workflow_routing_plans plan
      join public.workflow_routing_steps step on step.routing_plan_id = plan.id
      where plan.submission_id = target_submission_id
        and step.status in ('pending', 'in_progress')
        and (current_step.id is null or step.id <> current_step.id)
    ) then
      raise exception 'Complete or return other pending office assignments before forwarding';
    end if;
  elsif submission.selected_office_role is distinct from actor_role then
    raise exception 'Only the responsible office can create a new office assignment';
  elsif public.workflow_mvp_has_pending_assignment(target_submission_id) then
    raise exception 'Complete or return the pending office assignment before forwarding';
  end if;

  -- Forwarding onward closes this office's own assignment, so its response is required.
  if current_step.id is not null then
    if own_outcome_label is null then
      raise exception 'Record your office''s response (Endorsed, Endorsed with conditions, or Not endorsed) before forwarding onward';
    end if;
    if forwarder_outcome <> 'endorsed' and own_note is null then
      raise exception 'Add a note explaining the conditions or why the submission is not endorsed';
    end if;
    if own_note is not null and char_length(own_note) > 5000 then
      raise exception 'The note must be 5,000 characters or fewer';
    end if;
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
        || target_assignment_id::text || '/' || message_id::text || '/%'
    );
  if attachment_count <> jsonb_array_length(attachment_records) then
    raise exception 'A forwarded document attachment is invalid';
  end if;
  if not exists (
    select 1
    from jsonb_to_recordset(attachment_records) as attachment(
      file_name text, file_type text, file_size bigint
    )
    where attachment.file_name = submission.file_name
      and attachment.file_type = submission.file_type
      and attachment.file_size = submission.file_size
  ) then
    raise exception 'Attach the submission’s current document version';
  end if;

  if current_plan.id is not null then
    if current_step.id is not null then
      update public.workflow_routing_steps
      set status = 'completed',
          started_at = coalesce(current_step.started_at, now_at),
          completed_by = auth.uid(),
          completed_at = now_at,
          outcome = forwarder_outcome,
          comments = own_note
      where id = current_step.id;
    end if;

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
    id, routing_plan_id, sequence_number, office_role, status, assigned_by,
    assigned_by_role, assigned_at, started_at, responsibility, assignment_source, comments
  )
  values (
    target_assignment_id, plan_id, 1, target_office_role, 'in_progress', auth.uid(),
    actor_role, now_at, now_at, 'recommendation', 'office_forward', null
  );

  insert into public.workflow_messages (
    id, submission_id, sender_id, body, routing_step_id
  )
  values (
    message_id,
    target_submission_id,
    auth.uid(),
    coalesce(request_context, 'Office assignment created.'),
    target_assignment_id
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
    target_submission_id,
    'SUBMISSION_FORWARDED',
    submission.status,
    submission.status,
    public.workflow_office_label(actor_role) || ' asked '
      || public.workflow_office_label(target_office_role) || ' for a recommendation',
    now_at
  );

  if current_step.id is not null then
    perform public.workflow_mvp_record_history(
      target_submission_id,
      'OFFICE_ASSIGNMENT_FORWARDED_ONWARD',
      submission.status,
      submission.status,
      public.workflow_office_label(actor_role) || ' — ' || own_outcome_label
        || '; forwarded onward to ' || public.workflow_office_label(target_office_role),
      now_at
    );

    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select
      profile.id,
      target_submission_id,
      'OFFICE_ASSIGNMENT_FORWARDED_ONWARD:' || current_step.id::text,
      public.workflow_office_label(actor_role) || ' responded: ' || own_outcome_label
        || ', then forwarded to ' || public.workflow_office_label(target_office_role),
      coalesce(submission.tracking_number, 'Pending tracking number')
        || ' — ' || submission.file_name
        || coalesce(E'\n' || own_note, '')
    from public.profiles profile
    join auth.users account on account.id = profile.id
    where profile.role in (submission.selected_office_role, current_step.assigned_by_role)
      and profile.role <> actor_role
      and profile.is_active
      and (account.banned_until is null or account.banned_until <= now_at)
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
  end if;

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    target_submission_id,
    'OFFICE_ASSIGNMENT_FORWARDED:' || target_assignment_id::text,
    public.workflow_office_label(actor_role) || ' requested your office''s recommendation',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.role = target_office_role
    and profile.is_active
    and (account.banned_until is null or account.banned_until <= now_at)
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$function$;

revoke all on function public.forward_workflow_submission_to_office(uuid, text, uuid, uuid, text, jsonb, text, text) from public, anon;
grant execute on function public.forward_workflow_submission_to_office(uuid, text, uuid, uuid, text, jsonb, text, text) to authenticated, service_role;

-- ─── Live updates for assignment changes ─────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workflow_routing_steps'
  ) then
    alter publication supabase_realtime add table public.workflow_routing_steps;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workflow_routing_plans'
  ) then
    alter publication supabase_realtime add table public.workflow_routing_plans;
  end if;
end $$;
