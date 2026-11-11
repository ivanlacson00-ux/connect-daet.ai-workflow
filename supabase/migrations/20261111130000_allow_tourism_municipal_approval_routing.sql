create or replace function public.prevent_tourism_office_submission_routing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.workflow_submissions submission
    where submission.id = new.submission_id
      and submission.initial_destination_role = 'tourism_officer'
      and (
        submission.status is distinct from 'pending_approver'
        or public.current_profile_role() is distinct from 'tourism_officer'
        or current_setting('app.tourism_office_routing', true) is distinct from 'on'
      )
  ) then
    raise exception 'Only the Tourism Officer can route a pending Tourism Office submission to municipal offices';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_tourism_office_submission_forwarding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.initial_destination_role = 'tourism_officer'
    and new.status in ('pending_admin', 'pending_office', 'pending_mayor')
    and not coalesce((
      new.status = 'pending_office'
      and current_setting('app.workflow_authorized_transition', true) = 'on'
      and exists (
        select 1
        from public.workflow_routing_plans plan
        join public.workflow_routing_steps step on step.routing_plan_id = plan.id
        where plan.submission_id = old.id
          and plan.is_current
          and plan.status = 'finalized'
          and step.status = 'in_progress'
      )
      and (
        public.current_profile_role() = 'tourism_officer'
        or (
          public.current_profile_role() = 'submitter'
          and old.status = 'returned_for_requirements'
        )
      )
    ), false) then
    raise exception 'Tourism submissions may enter municipal review only through the authorized Tourism Office route';
  end if;

  return new;
end;
$$;

create or replace function public.record_workflow_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_type text;
  event_comments text;
begin
  if tg_op = 'INSERT' then
    insert into public.workflow_audit_logs (
      submission_id, action_by, action_type, old_status, new_status, comments
    )
    values (new.id, auth.uid(), 'SUBMITTED', null, new.status, new.description);
    return new;
  end if;

  if new.status is distinct from old.status then
    event_type := case
      when new.status = 'pending_admin' and old.status = 'pending_office' then 'ROUTE_RETURNED_TO_ADMIN'
      when new.status = 'pending_admin' then 'APPROVER_APPROVED'
      when new.status = 'declined_by_approver' then 'APPROVER_REJECTED'
      when new.status = 'pending_office' and old.status = 'returned_for_requirements' then 'REQUIREMENTS_RESUBMITTED'
      when new.status = 'pending_office'
        and old.status = 'pending_approver'
        and new.initial_destination_role = 'tourism_officer' then 'TOURISM_OFFICER_ASSIGNMENTS_CREATED'
      when new.status = 'pending_office' then 'ADMIN_VERIFIED'
      when new.status = 'declined_by_admin' then 'ADMIN_REJECTED'
      when new.status = 'pending_mayor' and old.status = 'pending_office' then 'OFFICE_REVIEW_COMPLETED'
      when new.status = 'pending_mayor' then 'REQUIREMENTS_RESUBMITTED'
      when new.status = 'declined_by_office' then 'OFFICE_REJECTED'
      when new.status = 'returned_for_requirements' then 'RETURNED_FOR_REQUIREMENTS'
      when new.status = 'declined_by_mayor' then 'MAYOR_REJECTED'
      when new.status = 'completed' and old.status = 'pending_mayor' then 'MAYOR_APPROVED'
      when new.status = 'completed' then 'WORKFLOW_COMPLETED'
      else 'STATUS_CHANGED'
    end;
    event_comments := case new.status
      when 'pending_mayor' then coalesce(new.sender_response, new.office_comments)
      when 'returned_for_requirements' then new.mayor_comments
      when 'completed' then new.mayor_comments
      when 'declined_by_mayor' then new.mayor_comments
      when 'declined_by_office' then new.office_comments
      when 'declined_by_admin' then new.admin_comments
      when 'declined_by_approver' then new.approver_comments
      when 'pending_office' then
        case
          when old.status = 'returned_for_requirements' then new.sender_response
          when old.status = 'pending_approver'
            and new.initial_destination_role = 'tourism_officer' then new.approver_comments
          else new.admin_comments
        end
      when 'pending_admin' then
        case when old.status = 'pending_office'
          then new.office_comments
          else new.approver_comments
        end
      else coalesce(
        new.sender_response,
        new.mayor_comments,
        new.office_comments,
        new.admin_comments,
        new.approver_comments,
        new.rejection_comment
      )
    end;

    insert into public.workflow_audit_logs (
      submission_id, action_by, action_type, old_status, new_status, comments
    )
    values (
      new.id,
      auth.uid(),
      event_type,
      old.status,
      new.status,
      case
        when event_type = 'ADMIN_VERIFIED'
          then 'Finalized route; first office: ' || coalesce(new.selected_office_role, 'unassigned')
        when event_type = 'ROUTE_RETURNED_TO_ADMIN'
          then 'All assigned offices approved; request returned to administration'
        else event_comments
      end
    );
  end if;
  return new;
end;
$$;

create or replace function public.route_tourism_submission_to_municipal_offices(
  target_submission_id uuid,
  assignment_records jsonb,
  routing_mode text,
  assignment_comments text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.current_profile_role();
  submission public.workflow_submissions;
  plan_id uuid;
  now_at timestamptz := timezone('utc', now());
  assignment_count integer;
  first_office_role text;
begin
  if auth.uid() is null
    or actor_role is distinct from 'tourism_officer'
    or not exists (
      select 1 from auth.users account
      where account.id = auth.uid() and account.banned_until is null
    ) then
    raise exception 'An active Tourism Officer is required to route this submission';
  end if;
  if routing_mode is null or routing_mode not in ('sequential', 'simultaneous') then
    raise exception 'Choose sequential or simultaneous municipal office routing';
  end if;
  if assignment_records is null
    or jsonb_typeof(assignment_records) is distinct from 'array' then
    raise exception 'Select at least one municipal office for approval';
  end if;
  if jsonb_array_length(assignment_records) = 0 then
    raise exception 'Select at least one municipal office for approval';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found
    or submission.status is distinct from 'pending_approver'
    or submission.initial_destination_role is distinct from 'tourism_officer'
    or submission.selected_office_role is not null then
    raise exception 'This submission is not awaiting a Tourism Officer decision';
  end if;
  if exists (
    select 1
    from public.workflow_routing_plans plan
    where plan.submission_id = target_submission_id
      and plan.is_current
  ) then
    raise exception 'This Tourism submission already has a municipal review route';
  end if;

  select count(*) into assignment_count
  from jsonb_to_recordset(assignment_records) as assignment(
    office_role text,
    responsibility text
  );
  if assignment_count <> jsonb_array_length(assignment_records)
    or exists (
      select 1
      from jsonb_to_recordset(assignment_records) as assignment(
        office_role text,
        responsibility text
      )
      where assignment.office_role is null
        or assignment.office_role not in (
          'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
        )
        or assignment.responsibility is null
        or assignment.responsibility not in (
          'mandatory_approval_clearance',
          'evaluation_verification',
          'recommendation'
        )
    )
    or assignment_count <> (
      select count(distinct assignment.office_role)
      from jsonb_to_recordset(assignment_records) as assignment(
        office_role text,
        responsibility text
      )
    ) then
    raise exception 'Choose unique municipal offices and valid review responsibilities';
  end if;

  perform set_config('app.tourism_office_routing', 'on', true);
  insert into public.workflow_routing_plans (
    submission_id, version, status, is_current, created_by, finalized_by, finalized_at
  )
  values (
    target_submission_id,
    coalesce((
      select max(plan.version) + 1
      from public.workflow_routing_plans plan
      where plan.submission_id = target_submission_id
    ), 1),
    'finalized',
    true,
    auth.uid(),
    auth.uid(),
    now_at
  )
  returning id into plan_id;
  perform set_config('app.tourism_office_routing', 'off', true);

  insert into public.workflow_routing_steps (
    routing_plan_id,
    sequence_number,
    office_role,
    status,
    assigned_by,
    assigned_at,
    started_at,
    responsibility,
    assignment_source
  )
  select
    plan_id,
    case when routing_mode = 'simultaneous' then 1 else assignment.ordinality::integer end,
    assignment.office_role,
    case
      when routing_mode = 'simultaneous' or assignment.ordinality = 1 then 'in_progress'
      else 'pending'
    end,
    case
      when routing_mode = 'simultaneous' or assignment.ordinality = 1 then auth.uid()
      else null
    end,
    case
      when routing_mode = 'simultaneous' or assignment.ordinality = 1 then now_at
      else null
    end,
    case
      when routing_mode = 'simultaneous' or assignment.ordinality = 1 then now_at
      else null
    end,
    assignment.responsibility,
    'tourism_officer'
  from jsonb_array_elements(assignment_records) with ordinality
    as assignment_record(value, ordinality)
  cross join lateral jsonb_to_record(assignment_record.value) as assignment(
    office_role text,
    responsibility text
  )
  order by assignment_record.ordinality;

  select step.office_role into first_office_role
  from public.workflow_routing_steps step
  where step.routing_plan_id = plan_id
    and step.status = 'in_progress'
  order by step.sequence_number, step.office_role
  limit 1;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'pending_office',
      selected_office_role = first_office_role,
      final_decision_office_role = null,
      approver_comments = nullif(btrim(assignment_comments), ''),
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  select
    target_submission_id,
    auth.uid(),
    'TOURISM_OFFICE_ROUTE_STEP_ASSIGNED',
    'pending_approver',
    'pending_office',
    assignment.office_role || ' — ' || assignment.responsibility,
    now_at
  from jsonb_to_recordset(assignment_records) as assignment(
    office_role text,
    responsibility text
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    target_submission_id,
    'TOURISM_OFFICE_ROUTE_STEP_ASSIGNED',
    'Municipal approval requested',
    coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
  from public.workflow_routing_steps step
  join public.profiles profile on profile.role = step.office_role
  where step.routing_plan_id = plan_id
    and step.status = 'in_progress'
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  values (
    submission.user_id,
    target_submission_id,
    'TOURISM_OFFICER_ASSIGNMENTS_CREATED',
    'Municipal reviews requested',
    coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
  )
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;

  return plan_id;
end;
$$;

create or replace function public.decide_tourism_submission_route_step(
  target_submission_id uuid,
  approve_step boolean,
  decision_comments text default null
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
  now_at timestamptz := timezone('utc', now());
begin
  if auth.uid() is null
    or actor_role not in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan')
    or not exists (
      select 1 from auth.users account
      where account.id = auth.uid() and account.banned_until is null
    ) then
    raise exception 'An active municipal office member is required to decide this assignment';
  end if;
  if not approve_step and coalesce(length(btrim(decision_comments)), 0) = 0 then
    raise exception 'Provide a reason before rejecting this request';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found
    or submission.status is distinct from 'pending_office'
    or submission.initial_destination_role is distinct from 'tourism_officer' then
    raise exception 'This submission is not awaiting a Tourism-requested municipal review';
  end if;

  select * into current_plan
  from public.workflow_routing_plans
  where submission_id = target_submission_id
    and is_current
    and status = 'finalized'
  for update;
  if not found then
    raise exception 'No finalized municipal review route exists for this submission';
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
  set status = case when approve_step then 'approved' else 'rejected' end,
      decided_by = auth.uid(),
      decided_at = now_at,
      comments = nullif(btrim(decision_comments), '')
  where id = current_step.id;

  if not approve_step then
    perform set_config('app.workflow_authorized_transition', 'on', true);
    update public.workflow_submissions
    set status = 'declined_by_office',
        selected_office_role = null,
        office_comments = btrim(decision_comments),
        updated_at = now_at
    where id = target_submission_id;
    perform set_config('app.workflow_authorized_transition', 'off', true);

    return;
  end if;

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id, auth.uid(), 'TOURISM_OFFICE_ROUTE_STEP_APPROVED',
    'pending_office', 'pending_office',
    current_step.office_role || ' — ' || current_step.responsibility
      || coalesce(': ' || nullif(btrim(decision_comments), ''), ''),
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
      target_submission_id, auth.uid(), 'TOURISM_OFFICE_ROUTE_STEP_ASSIGNED',
      'pending_office', 'pending_office',
      step.office_role || ' — ' || step.responsibility, now_at
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
      'TOURISM_OFFICE_ROUTE_STEP_ASSIGNED',
      'Municipal approval assignment received',
      coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
    from public.workflow_routing_steps step
    join public.profiles profile on profile.role = step.office_role
    where step.routing_plan_id = current_plan.id
      and step.sequence_number = next_sequence
      and step.status = 'in_progress'
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
    return;
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'pending_approver',
      selected_office_role = null,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id,
    auth.uid(),
    'TOURISM_OFFICER_ASSIGNMENTS_COMPLETED',
    'pending_office',
    'pending_approver',
    'All municipal reviews are complete; final Tourism Office decision is required',
    now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    target_submission_id,
    'TOURISM_OFFICER_ASSIGNMENTS_COMPLETED',
    'Municipal reviews completed — Tourism decision needed',
    coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
  from public.profiles profile
  where profile.role = 'tourism_officer'
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  values (
    submission.user_id,
    target_submission_id,
    'TOURISM_OFFICER_ASSIGNMENTS_COMPLETED',
    'Municipal reviews completed',
    coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
  )
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;

create or replace function public.complete_routed_tourism_submission(
  target_submission_id uuid,
  decision_comments text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.workflow_submissions;
  plan_id uuid;
  now_at timestamptz := timezone('utc', now());
begin
  if auth.uid() is null
    or public.current_profile_role() is distinct from 'tourism_officer'
    or not exists (
      select 1 from auth.users account
      where account.id = auth.uid() and account.banned_until is null
    ) then
    raise exception 'An active Tourism Officer is required to complete this submission';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found
    or submission.status is distinct from 'pending_approver'
    or submission.initial_destination_role is distinct from 'tourism_officer'
    or submission.selected_office_role is not null then
    raise exception 'This submission is not awaiting its final Tourism Office decision';
  end if;

  select plan.id into plan_id
  from public.workflow_routing_plans plan
  where plan.submission_id = target_submission_id
    and plan.is_current
    and plan.status = 'finalized'
    and exists (
      select 1
      from public.workflow_routing_steps step
      where step.routing_plan_id = plan.id
    )
    and not exists (
      select 1
      from public.workflow_routing_steps step
      where step.routing_plan_id = plan.id
        and step.status is distinct from 'approved'
    )
  for update;
  if plan_id is null then
    raise exception 'Every assigned municipal office must approve before final Tourism Office completion';
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'completed',
      final_decision_by = auth.uid(),
      final_decided_at = now_at,
      approver_comments = nullif(btrim(decision_comments), ''),
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id,
    auth.uid(),
    'TOURISM_OFFICE_APPROVED',
    submission.status,
    'completed',
    nullif(btrim(decision_comments), ''),
    now_at
  );
end;
$$;

revoke all on function public.route_tourism_submission_to_municipal_offices(uuid, jsonb, text, text)
  from public;
revoke all on function public.decide_tourism_submission_route_step(uuid, boolean, text)
  from public;
revoke all on function public.complete_routed_tourism_submission(uuid, text)
  from public;
grant execute on function public.route_tourism_submission_to_municipal_offices(uuid, jsonb, text, text)
  to authenticated;
grant execute on function public.decide_tourism_submission_route_step(uuid, boolean, text)
  to authenticated;
grant execute on function public.complete_routed_tourism_submission(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
