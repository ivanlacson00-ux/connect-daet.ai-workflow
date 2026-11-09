alter table public.workflow_routing_steps
  add column if not exists requirements_requested_at timestamptz,
  add column if not exists requirements_resubmitted_at timestamptz,
  add column if not exists requirements_comments text;

create or replace function public.enforce_workflow_submission_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  allowed_office_roles text[] := array[
    'municipal_treasurer',
    'mayor_office',
    'sangguniang_bayan'
  ];
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();

  if actor_role is null then
    raise exception 'A valid authenticated profile is required to change a submission';
  end if;

  if old.status = 'pending_office'
    and actor_role = old.selected_office_role
    and (
      (
        new.status = 'pending_office'
        and new.selected_office_role is distinct from old.selected_office_role
        and exists (
          select 1
          from public.workflow_routing_plans plan
          join public.workflow_routing_steps completed_step
            on completed_step.routing_plan_id = plan.id
          join public.workflow_routing_steps next_step
            on next_step.routing_plan_id = plan.id
          where plan.submission_id = old.id
            and plan.is_current
            and plan.status = 'finalized'
            and completed_step.office_role = old.selected_office_role
            and completed_step.status = 'approved'
            and completed_step.decided_by = auth.uid()
            and next_step.office_role = new.selected_office_role
            and next_step.status = 'in_progress'
            and next_step.sequence_number > completed_step.sequence_number
            and not exists (
              select 1
              from public.workflow_routing_steps earlier_step
              where earlier_step.routing_plan_id = plan.id
                and earlier_step.sequence_number > completed_step.sequence_number
                and earlier_step.sequence_number < next_step.sequence_number
                and earlier_step.status <> 'approved'
            )
        )
        and (
          to_jsonb(new) - array[
            'selected_office_role', 'office_comments', 'mayor_comments',
            'mayor_decided_at', 'updated_at'
          ]
          is not distinct from
          to_jsonb(old) - array[
            'selected_office_role', 'office_comments', 'mayor_comments',
            'mayor_decided_at', 'updated_at'
          ]
        )
      )
      or (
        new.status = 'pending_admin'
        and new.selected_office_role is null
        and exists (
          select 1
          from public.workflow_routing_plans plan
          join public.workflow_routing_steps completed_step
            on completed_step.routing_plan_id = plan.id
          where plan.submission_id = old.id
            and plan.is_current
            and plan.status = 'finalized'
            and completed_step.office_role = old.selected_office_role
            and completed_step.status = 'approved'
            and completed_step.decided_by = auth.uid()
            and not exists (
              select 1
              from public.workflow_routing_steps unfinished_step
              where unfinished_step.routing_plan_id = plan.id
                and unfinished_step.status <> 'approved'
            )
        )
        and (
          to_jsonb(new) - array[
            'status', 'selected_office_role', 'office_comments', 'mayor_comments',
            'mayor_decided_at', 'updated_at'
          ]
          is not distinct from
          to_jsonb(old) - array[
            'status', 'selected_office_role', 'office_comments', 'mayor_comments',
            'mayor_decided_at', 'updated_at'
          ]
        )
      )
      or (
        new.status = 'declined_by_office'
        and coalesce(length(btrim(new.office_comments)), 0) > 0
        and exists (
          select 1
          from public.workflow_routing_plans plan
          join public.workflow_routing_steps rejected_step
            on rejected_step.routing_plan_id = plan.id
          where plan.submission_id = old.id
            and plan.is_current
            and plan.status = 'finalized'
            and rejected_step.office_role = old.selected_office_role
            and rejected_step.status = 'rejected'
            and rejected_step.decided_by = auth.uid()
        )
        and (
          to_jsonb(new) - array['status', 'office_comments', 'updated_at']
          is not distinct from
          to_jsonb(old) - array['status', 'office_comments', 'updated_at']
        )
      )
      or (
        actor_role = 'mayor_office'
        and new.status = 'returned_for_requirements'
        and new.selected_office_role is null
        and coalesce(length(btrim(new.mayor_comments)), 0) > 0
        and exists (
          select 1
          from public.workflow_routing_plans plan
          join public.workflow_routing_steps mayor_step
            on mayor_step.routing_plan_id = plan.id
          where plan.submission_id = old.id
            and plan.is_current
            and plan.status = 'finalized'
            and mayor_step.office_role = 'mayor_office'
            and mayor_step.status = 'in_progress'
            and not exists (
              select 1
              from public.workflow_routing_steps later_step
              where later_step.routing_plan_id = plan.id
                and later_step.sequence_number > mayor_step.sequence_number
            )
        )
        and (
          to_jsonb(new) - array['status', 'selected_office_role', 'mayor_comments', 'updated_at']
          is not distinct from
          to_jsonb(old) - array['status', 'selected_office_role', 'mayor_comments', 'updated_at']
        )
      )
    ) then
    return new;
  end if;

  if actor_role = 'admin' and old.status = 'pending_admin'
    and new.status = 'completed'
    and exists (
      select 1
      from public.workflow_routing_plans plan
      where plan.submission_id = old.id
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
            and step.status <> 'approved'
        )
    )
    and (
      to_jsonb(new) - array['status', 'updated_at']
      is not distinct from
      to_jsonb(old) - array['status', 'updated_at']
    ) then
    return new;
  end if;

  if new.status is not distinct from old.status then
    if actor_role = 'admin' then
      return new;
    end if;
    raise exception 'Workflow records can only be changed through an authorized stage decision';
  end if;

  if actor_role = 'approver'
    and old.status in ('pending', 'pending_approver') then
    if new.status = 'pending_admin'
      and new.selected_office_role is null
      and exists (
        select 1
        from public.workflow_routing_plans plan
        join public.workflow_routing_steps step
          on step.routing_plan_id = plan.id
        where plan.submission_id = old.id
          and plan.is_current
          and plan.status = 'proposed'
      )
      and (
        to_jsonb(new) - array['status', 'selected_office_role', 'approver_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'selected_office_role', 'approver_comments', 'updated_at']
      ) then
      return new;
    elsif new.status = 'declined_by_approver'
      and coalesce(length(btrim(new.approver_comments)), 0) > 0
      and (
        to_jsonb(new) - array['status', 'approver_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'approver_comments', 'updated_at']
      ) then
      new.archived_at := coalesce(new.archived_at, timezone('utc', now()));
      new.archived_by := auth.uid();
      return new;
    end if;
    raise exception 'Approver must select an office or provide a rejection reason';
  end if;

  if actor_role = 'admin' and old.status = 'pending_admin' then
    if new.status = 'pending_office'
      and new.selected_office_role = any(allowed_office_roles)
      and not exists (
        select 1
        from public.workflow_routing_plans plan
        where plan.submission_id = old.id
          and plan.is_current
          and plan.status = 'proposed'
      )
      and (
        not exists (
          select 1
          from public.workflow_routing_plans plan
          where plan.submission_id = old.id
            and plan.is_current
        )
        or exists (
          select 1
          from public.workflow_routing_plans plan
          join public.workflow_routing_steps step
            on step.routing_plan_id = plan.id
          where plan.submission_id = old.id
            and plan.is_current
            and plan.status = 'finalized'
            and step.office_role = new.selected_office_role
            and step.status = 'in_progress'
        )
      )
      and (
        to_jsonb(new) - array['status', 'selected_office_role', 'admin_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'selected_office_role', 'admin_comments', 'updated_at']
      ) then
      return new;
    elsif new.status = 'declined_by_admin'
      and coalesce(length(btrim(new.admin_comments)), 0) > 0
      and (
        to_jsonb(new) - array['status', 'admin_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'admin_comments', 'updated_at']
      ) then
      new.archived_at := coalesce(new.archived_at, timezone('utc', now()));
      new.archived_by := auth.uid();
      return new;
    end if;
    raise exception 'Administrator must verify routing or provide a rejection reason';
  end if;

  if actor_role = old.selected_office_role and old.status = 'pending_office' then
    if new.status = 'pending_mayor'
      and not exists (
        select 1
        from public.workflow_routing_plans plan
        where plan.submission_id = old.id
          and plan.is_current
          and plan.status = 'finalized'
      )
      and (
        to_jsonb(new) - array['status', 'office_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'office_comments', 'updated_at']
      ) then
      return new;
    elsif new.status = 'declined_by_office'
      and not exists (
        select 1
        from public.workflow_routing_plans plan
        where plan.submission_id = old.id
          and plan.is_current
          and plan.status = 'finalized'
      )
      and coalesce(length(btrim(new.office_comments)), 0) > 0
      and (
        to_jsonb(new) - array['status', 'office_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'office_comments', 'updated_at']
      ) then
      new.archived_at := coalesce(new.archived_at, timezone('utc', now()));
      new.archived_by := auth.uid();
      return new;
    end if;
    raise exception 'Assigned office must forward the request or provide a rejection reason';
  end if;

  if actor_role = 'mayor_office' and old.status = 'pending_mayor' then
    if new.status = 'completed'
      and (
        to_jsonb(new) - array['status', 'mayor_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'mayor_comments', 'updated_at']
      ) then
      new.archived_at := coalesce(new.archived_at, timezone('utc', now()));
      new.archived_by := auth.uid();
      return new;
    elsif new.status = 'declined_by_mayor'
      and coalesce(length(btrim(new.mayor_comments)), 0) > 0
      and (
        to_jsonb(new) - array['status', 'mayor_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'mayor_comments', 'updated_at']
      ) then
      new.archived_at := coalesce(new.archived_at, timezone('utc', now()));
      new.archived_by := auth.uid();
      return new;
    elsif new.status = 'returned_for_requirements'
      and coalesce(length(btrim(new.mayor_comments)), 0) > 0
      and (
        to_jsonb(new) - array['status', 'mayor_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'mayor_comments', 'updated_at']
      ) then
      return new;
    end if;
    raise exception 'Mayor must approve, reject with a reason, or request additional requirements';
  end if;

  if actor_role = 'user' and old.user_id = auth.uid()
    and old.status = 'returned_for_requirements'
    and new.status = 'pending_office'
    and new.selected_office_role = 'mayor_office'
    and coalesce(length(btrim(new.sender_response)), 0) > 0
    and exists (
      select 1
      from public.workflow_routing_plans plan
      join public.workflow_routing_steps mayor_step
        on mayor_step.routing_plan_id = plan.id
      where plan.submission_id = old.id
        and plan.is_current
        and plan.status = 'finalized'
        and mayor_step.office_role = 'mayor_office'
        and mayor_step.status = 'in_progress'
        and mayor_step.requirements_requested_at is not null
    )
    and (
      to_jsonb(new) - array['status', 'selected_office_role', 'sender_response', 'updated_at']
      is not distinct from
      to_jsonb(old) - array['status', 'selected_office_role', 'sender_response', 'updated_at']
    ) then
    return new;
  end if;

  if actor_role = 'user' and old.user_id = auth.uid()
    and old.status = 'returned_for_requirements'
    and new.status = 'pending_mayor'
    and not exists (
      select 1
      from public.workflow_routing_plans plan
      where plan.submission_id = old.id
        and plan.is_current
        and plan.status = 'finalized'
    )
    and coalesce(length(btrim(new.sender_response)), 0) > 0
    and (
      to_jsonb(new) - array['status', 'sender_response', 'updated_at']
      is not distinct from
      to_jsonb(old) - array['status', 'sender_response', 'updated_at']
    ) then
    return new;
  end if;

  if actor_role = 'admin' and old.status = 'approved' and new.status = 'completed' then
    return new;
  end if;

  raise exception 'Invalid workflow transition from % to % for role %',
    old.status, new.status, actor_role;
end;
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
      if new.status in ('pending', 'pending_approver') then
        new.current_stage_started_at := event_time;
      elsif new.status in ('pending_admin', 'pending_office', 'pending_mayor', 'returned_for_requirements') then
        new.current_stage_started_at := event_time;
        if new.status = 'pending_office' then
          new.verified_at := coalesce(new.verified_at, event_time);
          if office_route_advanced then
            new.office_reviewed_at := event_time;
          else
            new.office_reviewed_at := null;
          end if;
        elsif new.status = 'pending_mayor' and old.status = 'pending_office' then
          new.office_reviewed_at := event_time;
        elsif new.status = 'pending_admin' and old.status = 'pending_office' then
          new.office_reviewed_at := event_time;
        end if;
      elsif new.status = 'completed' then
        new.completed_at := coalesce(new.completed_at, event_time);
        new.approved_at := coalesce(new.approved_at, event_time);
        if old.status = 'pending_mayor' then
          new.mayor_decided_at := coalesce(new.mayor_decided_at, event_time);
        end if;
        new.current_stage_started_at := null;
      elsif new.status like 'declined_by_%' then
        if old.status = 'pending_mayor' then
          new.mayor_decided_at := coalesce(new.mayor_decided_at, event_time);
        elsif old.status = 'pending_office' then
          new.office_reviewed_at := coalesce(new.office_reviewed_at, event_time);
        end if;
        new.current_stage_started_at := null;
      end if;
    end if;
  end if;

  new.current_stage_due_at := public.workflow_stage_deadline(
    new.status,
    new.current_stage_started_at
  );
  new.current_responsible_role := case
    when new.status in ('pending', 'pending_approver') then 'approver'
    when new.status = 'pending_admin' then 'admin'
    when new.status = 'pending_office' then new.selected_office_role
    when new.status = 'pending_mayor' then 'mayor_office'
    when new.status = 'returned_for_requirements' then 'user'
    else null
  end;
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
        case when old.status = 'returned_for_requirements'
          then new.sender_response
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

create or replace function public.propose_workflow_route(
  target_submission_id uuid,
  proposed_office_roles text[],
  proposal_comments text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  submission public.workflow_submissions;
  plan_id uuid;
  next_version integer;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();

  if auth.uid() is null or actor_role is distinct from 'approver' then
    raise exception 'Only an authenticated approver can propose a route';
  end if;
  if proposed_office_roles is null or cardinality(proposed_office_roles) = 0 then
    raise exception 'Select at least one municipal office for the proposed route';
  end if;
  if exists (
    select 1
    from unnest(proposed_office_roles) as roles(office_role)
    where office_role not in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan')
  ) or cardinality(proposed_office_roles) <> (
    select count(distinct office_role)
    from unnest(proposed_office_roles) as roles(office_role)
  ) then
    raise exception 'The proposed route contains an unsupported or duplicate office';
  end if;
  if array_position(proposed_office_roles, 'mayor_office') is not null
    and array_position(proposed_office_roles, 'mayor_office') <> cardinality(proposed_office_roles) then
    raise exception 'The Mayor''s Office must be the final route step';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission % not found', target_submission_id;
  end if;
  if submission.status not in ('pending', 'pending_approver') then
    raise exception 'Submission is no longer awaiting approver review';
  end if;

  update public.workflow_routing_plans
  set status = 'withdrawn', is_current = false
  where submission_id = target_submission_id and is_current;

  select coalesce(max(version), 0) + 1 into next_version
  from public.workflow_routing_plans
  where submission_id = target_submission_id;

  insert into public.workflow_routing_plans (
    submission_id, version, status, created_by
  )
  values (target_submission_id, next_version, 'proposed', auth.uid())
  returning id into plan_id;

  insert into public.workflow_routing_steps (
    routing_plan_id, sequence_number, office_role
  )
  select plan_id, ordinality::integer, office_role
  from unnest(proposed_office_roles) with ordinality as proposed(office_role, ordinality);

  update public.workflow_submissions
  set status = 'pending_admin',
      selected_office_role = null,
      approver_comments = nullif(btrim(proposal_comments), ''),
      updated_at = timezone('utc', now())
  where id = target_submission_id;

  return plan_id;
end;
$$;

create or replace function public.finalize_workflow_route(
  target_submission_id uuid,
  final_office_roles text[],
  administrative_comments text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  submission public.workflow_submissions;
  proposed_plan public.workflow_routing_plans;
  plan_id uuid;
  next_version integer;
  first_office_role text;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();

  if auth.uid() is null or actor_role is distinct from 'admin' then
    raise exception 'Only an authenticated administrator can finalize a route';
  end if;
  if final_office_roles is null or cardinality(final_office_roles) = 0 then
    raise exception 'The finalized route must include at least one office';
  end if;
  if exists (
    select 1
    from unnest(final_office_roles) as roles(office_role)
    where office_role not in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan')
  ) or cardinality(final_office_roles) <> (
    select count(distinct office_role)
    from unnest(final_office_roles) as roles(office_role)
  ) then
    raise exception 'The finalized route contains an unsupported or duplicate office';
  end if;
  if array_position(final_office_roles, 'mayor_office') is not null
    and array_position(final_office_roles, 'mayor_office') <> cardinality(final_office_roles) then
    raise exception 'The Mayor''s Office must be the final route step';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission % not found', target_submission_id;
  end if;
  if submission.status <> 'pending_admin' then
    raise exception 'Submission is not awaiting administrative route finalization';
  end if;

  select * into proposed_plan
  from public.workflow_routing_plans
  where submission_id = target_submission_id
    and is_current
    and status = 'proposed'
  for update;
  if not found then
    raise exception 'No current approver-proposed route exists for this submission';
  end if;

  update public.workflow_routing_plans
  set status = 'superseded', is_current = false
  where id = proposed_plan.id;

  select coalesce(max(version), 0) + 1 into next_version
  from public.workflow_routing_plans
  where submission_id = target_submission_id;

  insert into public.workflow_routing_plans (
    submission_id, version, status, is_current, created_by, finalized_by, finalized_at
  )
  values (
    target_submission_id, next_version, 'finalized', true,
    auth.uid(), auth.uid(), timezone('utc', now())
  )
  returning id into plan_id;

  insert into public.workflow_routing_steps (
    routing_plan_id, sequence_number, office_role, status,
    assigned_by, assigned_at, started_at
  )
  select
    plan_id,
    ordinality::integer,
    office_role,
    case when ordinality = 1 then 'in_progress' else 'pending' end,
    case when ordinality = 1 then auth.uid() else null end,
    case when ordinality = 1 then timezone('utc', now()) else null end,
    case when ordinality = 1 then timezone('utc', now()) else null end
  from unnest(final_office_roles) with ordinality as finalized(office_role, ordinality);

  select office_role into first_office_role
  from unnest(final_office_roles) with ordinality as finalized(office_role, ordinality)
  where ordinality = 1;

  update public.workflow_submissions
  set status = 'pending_office',
      selected_office_role = first_office_role,
      admin_comments = nullif(btrim(administrative_comments), ''),
      updated_at = timezone('utc', now())
  where id = target_submission_id;

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments
  )
  values (
    target_submission_id,
    auth.uid(),
    'OFFICE_ROUTE_STEP_ASSIGNED',
    'pending_admin',
    'pending_office',
    first_office_role
  );

  return plan_id;
end;
$$;

create or replace function public.decide_workflow_route_step(
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
  actor_role text;
  submission public.workflow_submissions;
  current_plan public.workflow_routing_plans;
  current_step public.workflow_routing_steps;
  next_step public.workflow_routing_steps;
  now_at timestamptz := timezone('utc', now());
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();

  if auth.uid() is null or actor_role is null or actor_role not in (
    'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'Only a municipal office assigned to this route can decide this step';
  end if;
  if not approve_step and coalesce(length(btrim(decision_comments)), 0) = 0 then
    raise exception 'Provide a reason before rejecting this request';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission % not found', target_submission_id;
  end if;
  if submission.status <> 'pending_office'
    or submission.selected_office_role is distinct from actor_role then
    raise exception 'This request is not currently assigned to your office';
  end if;

  select * into current_plan
  from public.workflow_routing_plans
  where submission_id = target_submission_id
    and is_current
    and status = 'finalized'
  for update;
  if not found then
    raise exception 'No finalized route exists for this submission';
  end if;

  select * into current_step
  from public.workflow_routing_steps
  where routing_plan_id = current_plan.id
    and office_role = actor_role
    and status = 'in_progress'
  for update;
  if not found then
    raise exception 'Your office has no active step in the finalized route';
  end if;

  if not approve_step then
    update public.workflow_routing_steps
    set status = 'rejected',
        decided_by = auth.uid(),
        decided_at = now_at,
        comments = btrim(decision_comments)
    where id = current_step.id;

    update public.workflow_submissions
    set status = 'declined_by_office',
        office_comments = btrim(decision_comments),
        updated_at = now_at
    where id = target_submission_id;
    return;
  end if;

  update public.workflow_routing_steps
  set status = 'approved',
      decided_by = auth.uid(),
      decided_at = now_at,
      comments = nullif(btrim(decision_comments), '')
  where id = current_step.id;

  select * into next_step
  from public.workflow_routing_steps
  where routing_plan_id = current_plan.id
    and sequence_number > current_step.sequence_number
    and status = 'pending'
  order by sequence_number
  limit 1
  for update;

  if found then
    update public.workflow_routing_steps
    set status = 'in_progress',
        assigned_by = current_plan.finalized_by,
        assigned_at = now_at,
        started_at = now_at
    where id = next_step.id;

    update public.workflow_submissions
    set selected_office_role = next_step.office_role,
        mayor_decided_at = case when actor_role = 'mayor_office' then now_at else mayor_decided_at end,
        mayor_comments = case when actor_role = 'mayor_office' then nullif(btrim(decision_comments), '') else mayor_comments end,
        office_comments = nullif(btrim(decision_comments), ''),
        updated_at = now_at
    where id = target_submission_id;

    insert into public.workflow_audit_logs (
      submission_id, action_by, action_type, old_status, new_status, comments
    )
    values (
      target_submission_id, auth.uid(), 'OFFICE_ROUTE_STEP_APPROVED',
      'pending_office', 'pending_office',
      current_step.office_role || coalesce(': ' || nullif(btrim(decision_comments), ''), '')
    );
    insert into public.workflow_audit_logs (
      submission_id, action_by, action_type, old_status, new_status, comments
    )
    values (
      target_submission_id, auth.uid(), 'OFFICE_ROUTE_STEP_ASSIGNED',
      'pending_office', 'pending_office', next_step.office_role
    );
  else
    update public.workflow_submissions
    set status = 'pending_admin',
        selected_office_role = null,
        mayor_decided_at = case when actor_role = 'mayor_office' then now_at else mayor_decided_at end,
        mayor_comments = case when actor_role = 'mayor_office' then nullif(btrim(decision_comments), '') else mayor_comments end,
        office_comments = nullif(btrim(decision_comments), ''),
        updated_at = now_at
    where id = target_submission_id;

    insert into public.workflow_audit_logs (
      submission_id, action_by, action_type, old_status, new_status, comments
    )
    values (
      target_submission_id, auth.uid(), 'OFFICE_ROUTE_STEP_APPROVED',
      'pending_office', 'pending_admin',
      current_step.office_role || coalesce(': ' || nullif(btrim(decision_comments), ''), '')
    );
  end if;
end;
$$;

create or replace function public.request_workflow_route_requirements(
  target_submission_id uuid,
  request_comments text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  submission public.workflow_submissions;
  current_plan public.workflow_routing_plans;
  mayor_step public.workflow_routing_steps;
  now_at timestamptz := timezone('utc', now());
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();
  if auth.uid() is null or actor_role is distinct from 'mayor_office' then
    raise exception 'Only the Mayor''s Office can request additional requirements';
  end if;
  if coalesce(length(btrim(request_comments)), 0) = 0 then
    raise exception 'Explain the additional requirements before returning the request';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission % not found', target_submission_id;
  end if;
  if submission.status <> 'pending_office'
    or submission.selected_office_role is distinct from 'mayor_office' then
    raise exception 'The Mayor''s Office does not currently have this route step';
  end if;

  select * into current_plan
  from public.workflow_routing_plans
  where submission_id = target_submission_id
    and is_current
    and status = 'finalized'
  for update;
  if not found then
    raise exception 'No finalized route exists for this submission';
  end if;

  select * into mayor_step
  from public.workflow_routing_steps
  where routing_plan_id = current_plan.id
    and office_role = 'mayor_office'
    and status = 'in_progress'
  for update;
  if not found then
    raise exception 'The Mayor''s Office has no active route step';
  end if;
  if exists (
    select 1
    from public.workflow_routing_steps later_step
    where later_step.routing_plan_id = current_plan.id
      and later_step.sequence_number > mayor_step.sequence_number
  ) then
    raise exception 'The Mayor must be the active final route step to request requirements';
  end if;

  update public.workflow_routing_steps
  set requirements_requested_at = now_at,
      requirements_comments = btrim(request_comments)
  where id = mayor_step.id;

  update public.workflow_submissions
  set status = 'returned_for_requirements',
      selected_office_role = null,
      mayor_comments = btrim(request_comments),
      updated_at = now_at
  where id = target_submission_id;

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments
  )
  values (
    target_submission_id, auth.uid(), 'ROUTE_REQUIREMENTS_REQUESTED',
    'pending_office', 'returned_for_requirements', btrim(request_comments)
  );
end;
$$;

create or replace function public.respond_to_workflow_route_requirements(
  target_submission_id uuid,
  sender_comments text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  submission public.workflow_submissions;
  current_plan public.workflow_routing_plans;
  mayor_step public.workflow_routing_steps;
  now_at timestamptz := timezone('utc', now());
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();
  if auth.uid() is null or actor_role is distinct from 'user' then
    raise exception 'Only the submitting user can provide the requested information';
  end if;
  if coalesce(length(btrim(sender_comments)), 0) = 0 then
    raise exception 'Enter a response before resubmitting this request';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission not found for this user';
  end if;
  if submission.user_id is distinct from auth.uid() then
    raise exception 'Submission not found for this user';
  end if;
  if submission.status <> 'returned_for_requirements' then
    raise exception 'This request is not waiting for additional requirements';
  end if;

  select * into current_plan
  from public.workflow_routing_plans
  where submission_id = target_submission_id
    and is_current
    and status = 'finalized'
  for update;
  if not found then
    raise exception 'No finalized route exists for this submission';
  end if;

  select * into mayor_step
  from public.workflow_routing_steps
  where routing_plan_id = current_plan.id
    and office_role = 'mayor_office'
    and status = 'in_progress'
    and requirements_requested_at is not null
  for update;
  if not found then
    raise exception 'The Mayor route step is not waiting for a response';
  end if;

  update public.workflow_routing_steps
  set requirements_resubmitted_at = now_at
  where id = mayor_step.id;

  update public.workflow_submissions
  set status = 'pending_office',
      selected_office_role = 'mayor_office',
      sender_response = btrim(sender_comments),
      updated_at = now_at
  where id = target_submission_id;
end;
$$;

create or replace function public.complete_workflow_after_route(
  target_submission_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  submission public.workflow_submissions;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();
  if auth.uid() is null or actor_role is distinct from 'admin' then
    raise exception 'Only an authenticated administrator can complete this request';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission % not found', target_submission_id;
  end if;
  if submission.status <> 'pending_admin'
    or not exists (
      select 1
      from public.workflow_routing_plans plan
      where plan.submission_id = target_submission_id
        and plan.is_current
        and plan.status = 'finalized'
        and exists (
          select 1 from public.workflow_routing_steps step
          where step.routing_plan_id = plan.id
        )
        and not exists (
          select 1 from public.workflow_routing_steps step
          where step.routing_plan_id = plan.id
            and step.status <> 'approved'
        )
    ) then
    raise exception 'All offices on a finalized route must approve before administration can complete the request';
  end if;

  update public.workflow_submissions
  set status = 'completed',
      updated_at = timezone('utc', now())
  where id = target_submission_id;
end;
$$;

create or replace function public.create_workflow_route_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.workflow_submissions;
  notification_title text;
  notification_message text;
  active_office_role text;
begin
  if new.action_type not in (
    'OFFICE_ROUTE_STEP_APPROVED',
    'OFFICE_ROUTE_STEP_ASSIGNED',
    'OFFICE_REJECTED',
    'ROUTE_REQUIREMENTS_REQUESTED',
    'ROUTE_RETURNED_TO_ADMIN'
  ) then
    return new;
  end if;

  select * into submission
  from public.workflow_submissions
  where id = new.submission_id;

  notification_title := case new.action_type
    when 'OFFICE_ROUTE_STEP_APPROVED' then 'Municipal office route step approved'
    when 'OFFICE_ROUTE_STEP_ASSIGNED' then 'Document assigned to your office'
    when 'OFFICE_REJECTED' then 'A municipal office rejected the request'
    when 'ROUTE_REQUIREMENTS_REQUESTED' then 'Mayor requested additional requirements'
    else 'Office route completed; administrative review needed'
  end;
  notification_message := coalesce(submission.tracking_number, 'Pending tracking number')
    || ' — ' || submission.file_name;
  if new.comments is not null and length(btrim(new.comments)) > 0 then
    notification_message := notification_message || E'\n' || new.comments;
  end if;

  if new.action_type = 'ROUTE_RETURNED_TO_ADMIN'
    or (
      new.action_type = 'OFFICE_ROUTE_STEP_APPROVED'
      and new.new_status <> 'pending_admin'
    ) then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    values (
      submission.user_id, new.submission_id, new.action_type,
      notification_title, notification_message
    )
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;

  end if;

  if new.action_type in (
    'OFFICE_REJECTED', 'ROUTE_REQUIREMENTS_REQUESTED', 'ROUTE_RETURNED_TO_ADMIN'
  )
    or (
      new.action_type = 'OFFICE_ROUTE_STEP_APPROVED'
      and new.new_status <> 'pending_admin'
    ) then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select
      profile.id, new.submission_id, new.action_type,
      notification_title, notification_message
    from public.profiles profile
    where profile.role = 'admin'
      and profile.id <> coalesce(
        new.action_by,
        '00000000-0000-0000-0000-000000000000'::uuid
      )
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
  end if;

  if new.action_type = 'OFFICE_ROUTE_STEP_ASSIGNED' then
    if submission.status = 'pending_office' then
      active_office_role := submission.selected_office_role;
    else
      select step.office_role into active_office_role
      from public.workflow_routing_plans plan
      join public.workflow_routing_steps step on step.routing_plan_id = plan.id
      where plan.submission_id = new.submission_id
        and plan.is_current
        and plan.status = 'finalized'
        and step.status = 'in_progress'
      limit 1;
    end if;

    if new.old_status <> 'pending_admin' then
      insert into public.workflow_notifications (
        recipient_id, submission_id, event_type, title, message
      )
      select
        profile.id, new.submission_id, new.action_type,
        notification_title, notification_message
      from public.profiles profile
      where profile.role = active_office_role
      on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists create_workflow_route_notifications
  on public.workflow_audit_logs;
create trigger create_workflow_route_notifications
after insert on public.workflow_audit_logs
for each row
execute function public.create_workflow_route_notifications();

revoke all on function public.propose_workflow_route(uuid, text[], text) from public;
revoke all on function public.finalize_workflow_route(uuid, text[], text) from public;
revoke all on function public.decide_workflow_route_step(uuid, boolean, text) from public;
revoke all on function public.request_workflow_route_requirements(uuid, text) from public;
revoke all on function public.respond_to_workflow_route_requirements(uuid, text) from public;
revoke all on function public.complete_workflow_after_route(uuid) from public;
grant execute on function public.propose_workflow_route(uuid, text[], text) to authenticated;
grant execute on function public.finalize_workflow_route(uuid, text[], text) to authenticated;
grant execute on function public.decide_workflow_route_step(uuid, boolean, text) to authenticated;
grant execute on function public.request_workflow_route_requirements(uuid, text) to authenticated;
grant execute on function public.respond_to_workflow_route_requirements(uuid, text) to authenticated;
grant execute on function public.complete_workflow_after_route(uuid) to authenticated;
