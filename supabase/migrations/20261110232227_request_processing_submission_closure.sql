alter table public.workflow_routing_steps
  add column if not exists completed_by uuid references public.profiles(id) on delete set null,
  add column if not exists completed_at timestamptz;

alter table public.workflow_routing_steps
  drop constraint if exists workflow_routing_steps_status_check,
  drop constraint if exists workflow_routing_steps_check,
  drop constraint if exists workflow_routing_steps_check1;

alter table public.workflow_routing_steps
  add constraint workflow_routing_steps_status_check
    check (status in ('pending', 'in_progress', 'approved', 'rejected', 'completed', 'skipped')),
  add constraint workflow_routing_steps_completion_timestamp_check
    check (
      (
        status in ('approved', 'rejected', 'skipped')
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
      (status in ('in_progress', 'approved', 'rejected', 'completed') and started_at is not null)
      or status in ('pending', 'skipped')
    );

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
  actor_role text := public.current_profile_role();
  submission public.workflow_submissions;
  current_plan public.workflow_routing_plans;
  current_step public.workflow_routing_steps;
  next_sequence integer;
  next_office_role text;
  final_office_role text;
  now_at timestamptz := timezone('utc', now());
begin
  if auth.uid() is null or actor_role not in (
    'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) or not exists (
    select 1
    from public.profiles profile
    join auth.users account on account.id = profile.id
    where profile.id = auth.uid()
      and profile.is_active
      and account.banned_until is null
  ) then
    raise exception 'An active municipal office member is required to complete this assignment';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found or submission.status <> 'pending_office' then
    raise exception 'This submission is not awaiting office processing';
  end if;

  select * into current_plan
  from public.workflow_routing_plans
  where submission_id = target_submission_id
    and is_current
    and status = 'finalized'
  for update;
  if not found then
    raise exception 'No finalized office assignment exists for this submission';
  end if;

  select * into current_step
  from public.workflow_routing_steps
  where routing_plan_id = current_plan.id
    and office_role = actor_role
    and status = 'in_progress'
  for update;
  if not found then
    raise exception 'Your office has no active assignment for this submission';
  end if;

  update public.workflow_routing_steps
  set status = 'completed',
      completed_by = auth.uid(),
      completed_at = now_at,
      comments = nullif(btrim(completion_notes), '')
  where id = current_step.id;

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id,
    auth.uid(),
    'OFFICE_ASSIGNMENT_COMPLETED',
    'pending_office',
    'pending_office',
    current_step.office_role || ' — ' || current_step.responsibility
      || coalesce(': ' || nullif(btrim(completion_notes), ''), ''),
    now_at
  );

  if exists (
    select 1
    from public.workflow_routing_steps step
    where step.routing_plan_id = current_plan.id
      and step.sequence_number = current_step.sequence_number
      and step.status = 'in_progress'
  ) then
    return;
  end if;

  select min(step.sequence_number) into next_sequence
  from public.workflow_routing_steps step
  where step.routing_plan_id = current_plan.id
    and step.sequence_number > current_step.sequence_number
    and step.status = 'pending';

  if next_sequence is not null then
    update public.workflow_routing_steps
    set status = 'in_progress',
        assigned_by = current_plan.finalized_by,
        assigned_at = now_at,
        started_at = now_at
    where routing_plan_id = current_plan.id
      and sequence_number = next_sequence
      and status = 'pending';

    select step.office_role into next_office_role
    from public.workflow_routing_steps step
    where step.routing_plan_id = current_plan.id
      and step.sequence_number = next_sequence
      and step.status = 'in_progress'
    order by step.office_role
    limit 1;

    perform set_config('app.workflow_authorized_transition', 'on', true);
    update public.workflow_submissions
    set selected_office_role = next_office_role,
        updated_at = now_at
    where id = target_submission_id;
    perform set_config('app.workflow_authorized_transition', 'off', true);

    insert into public.workflow_audit_logs (
      submission_id, action_by, action_type, old_status, new_status, comments, created_at
    )
    select
      target_submission_id,
      auth.uid(),
      'OFFICE_ROUTE_STEP_ASSIGNED',
      'pending_office',
      'pending_office',
      step.office_role || ' — ' || step.responsibility,
      now_at
    from public.workflow_routing_steps step
    where step.routing_plan_id = current_plan.id
      and step.sequence_number = next_sequence
      and step.status = 'in_progress';

    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select
      profile.id,
      target_submission_id,
      'OFFICE_ROUTE_STEP_ASSIGNED',
      'Additional office assignment received',
      coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
    from public.workflow_routing_steps step
    join public.profiles profile on profile.role = step.office_role
    where step.routing_plan_id = current_plan.id
      and step.sequence_number = next_sequence
      and step.status = 'in_progress'
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
    return;
  end if;

  if exists (
    select 1
    from public.workflow_routing_steps step
    where step.routing_plan_id = current_plan.id
      and step.status in ('pending', 'in_progress', 'rejected')
  ) then
    raise exception 'Required office assignments remain incomplete';
  end if;

  final_office_role := coalesce(
    submission.final_decision_office_role,
    submission.initial_destination_role
  );

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = case when final_office_role is null then 'pending_admin' else 'pending_office' end,
      selected_office_role = final_office_role,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id,
    auth.uid(),
    'OFFICE_ASSIGNMENTS_COMPLETED',
    'pending_office',
    case when final_office_role is null then 'pending_admin' else 'pending_office' end,
    'All assigned office work is complete',
    now_at
  );

  if final_office_role is not null then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select
      profile.id,
      target_submission_id,
      'OFFICE_ROUTE_STEP_ASSIGNED',
      'Submission ready for office processing',
      coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
    from public.profiles profile
    where profile.role = final_office_role
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
  end if;
end;
$$;

revoke all on function public.complete_workflow_assignment(uuid, text) from public, anon;
grant execute on function public.complete_workflow_assignment(uuid, text) to authenticated;

create or replace function public.close_workflow_submission(target_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.current_profile_role();
  submission public.workflow_submissions;
  responsible_office_role text;
  now_at timestamptz := timezone('utc', now());
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles profile
    join auth.users account on account.id = profile.id
    where profile.id = auth.uid()
      and profile.is_active
      and account.banned_until is null
      and profile.role = actor_role
  ) then
    raise exception 'An active authorized representative is required to close this submission';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission not found';
  end if;
  if submission.status = 'completed' then
    raise exception 'This submission is already closed';
  end if;

  if exists (
    select 1
    from public.workflow_routing_plans plan
    join public.workflow_routing_steps step on step.routing_plan_id = plan.id
    where plan.submission_id = target_submission_id
      and plan.is_current
      and plan.status = 'finalized'
      and step.status in ('pending', 'in_progress')
  ) then
    raise exception 'Pending required office assignments must be completed before closing this submission';
  end if;

  if exists (
    select 1
    from public.workflow_routing_plans plan
    join public.workflow_routing_steps step on step.routing_plan_id = plan.id
    where plan.submission_id = target_submission_id
      and plan.is_current
      and plan.status = 'finalized'
      and step.status = 'rejected'
  ) then
    raise exception 'A formally rejected office assignment cannot be closed as completed';
  end if;

  responsible_office_role := coalesce(
    submission.final_decision_office_role,
    submission.initial_destination_role
  );

  if actor_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then
    if submission.status not in ('pending_office', 'pending_mayor')
      or submission.selected_office_role is distinct from actor_role
      or responsible_office_role is distinct from actor_role then
      raise exception 'Only the responsible office can close this submission';
    end if;
  elsif actor_role = 'system_admin' then
    if submission.status not in ('pending_admin', 'approved')
      or (submission.status = 'pending_admin' and responsible_office_role is not null) then
      raise exception 'The system administrator can close only legacy requests with no responsible office';
    end if;
  else
    raise exception 'Your role is not authorized to close this submission';
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'completed',
      completed_at = now_at,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);
end;
$$;

revoke all on function public.close_workflow_submission(uuid) from public, anon;
grant execute on function public.close_workflow_submission(uuid) to authenticated;
