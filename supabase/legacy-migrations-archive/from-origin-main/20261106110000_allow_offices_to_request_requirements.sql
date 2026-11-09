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
        new.status = 'returned_for_requirements'
        and new.selected_office_role is null
        and coalesce(length(btrim(new.office_comments)), 0) > 0
        and exists (
          select 1
          from public.workflow_routing_plans plan
          join public.workflow_routing_steps active_step
            on active_step.routing_plan_id = plan.id
          where plan.submission_id = old.id
            and plan.is_current
            and plan.status = 'finalized'
            and active_step.office_role = old.selected_office_role
            and active_step.status = 'in_progress'
            and active_step.requirements_requested_at is not null
            and active_step.requirements_comments = btrim(new.office_comments)
        )
        and (
          to_jsonb(new) - array[
            'status', 'selected_office_role', 'office_comments', 'mayor_comments', 'updated_at'
          ]
          is not distinct from
          to_jsonb(old) - array[
            'status', 'selected_office_role', 'office_comments', 'mayor_comments', 'updated_at'
          ]
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
    and new.selected_office_role = any(allowed_office_roles)
    and coalesce(length(btrim(new.sender_response)), 0) > 0
    and exists (
      select 1
      from public.workflow_routing_plans plan
      join public.workflow_routing_steps active_step
        on active_step.routing_plan_id = plan.id
      where plan.submission_id = old.id
        and plan.is_current
        and plan.status = 'finalized'
        and active_step.office_role = new.selected_office_role
        and active_step.status = 'in_progress'
        and active_step.requirements_requested_at is not null
        and active_step.requirements_resubmitted_at >= active_step.requirements_requested_at
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
  current_step public.workflow_routing_steps;
  now_at timestamptz := timezone('utc', now());
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();
  if auth.uid() is null or actor_role is null or actor_role not in (
    'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'Only an assigned municipal office can request additional requirements';
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
    or submission.selected_office_role is distinct from actor_role then
    raise exception 'Your office does not currently have this route step';
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
    raise exception 'Your office has no active route step';
  end if;

  update public.workflow_routing_steps
  set requirements_requested_at = now_at,
      requirements_resubmitted_at = null,
      requirements_comments = btrim(request_comments)
  where id = current_step.id;

  update public.workflow_submissions
  set status = 'returned_for_requirements',
      selected_office_role = null,
      office_comments = btrim(request_comments),
      mayor_comments = case
        when actor_role = 'mayor_office' then btrim(request_comments)
        else mayor_comments
      end,
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
  current_step public.workflow_routing_steps;
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

  select * into current_step
  from public.workflow_routing_steps
  where routing_plan_id = current_plan.id
    and status = 'in_progress'
    and requirements_requested_at is not null
    and (
      requirements_resubmitted_at is null
      or requirements_resubmitted_at < requirements_requested_at
    )
  for update;
  if not found then
    raise exception 'No office is waiting for a requirements response';
  end if;

  update public.workflow_routing_steps
  set requirements_resubmitted_at = now_at
  where id = current_step.id;

  update public.workflow_submissions
  set status = 'pending_office',
      selected_office_role = current_step.office_role,
      sender_response = btrim(sender_comments),
      updated_at = now_at
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
    when 'ROUTE_REQUIREMENTS_REQUESTED' then 'Additional requirements requested'
    else 'Office route completed; administrative review needed'
  end;
  notification_message := coalesce(submission.tracking_number, 'Pending tracking number')
    || ' — ' || submission.file_name;
  if new.comments is not null and length(btrim(new.comments)) > 0 then
    notification_message := notification_message || E'\n' || new.comments;
  end if;

  if new.action_type = 'ROUTE_RETURNED_TO_ADMIN'
    or new.action_type = 'ROUTE_REQUIREMENTS_REQUESTED'
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

revoke all on function public.request_workflow_route_requirements(uuid, text) from public;
revoke all on function public.respond_to_workflow_route_requirements(uuid, text) from public;
grant execute on function public.request_workflow_route_requirements(uuid, text) to authenticated;
grant execute on function public.respond_to_workflow_route_requirements(uuid, text) to authenticated;
