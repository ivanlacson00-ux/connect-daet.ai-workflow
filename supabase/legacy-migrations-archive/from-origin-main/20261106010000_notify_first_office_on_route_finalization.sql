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

  return new;
end;
$$;
