create or replace function public.record_proposed_workflow_route()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.workflow_submissions;
  route_summary text;
  notification_message text;
begin
  if old.status not in ('pending', 'pending_approver')
    or new.status <> 'pending_admin'
    or not exists (
      select 1
      from public.workflow_routing_plans plan
      where plan.submission_id = new.id
        and plan.is_current
        and plan.status = 'proposed'
    ) then
    return new;
  end if;

  select string_agg(
    case step.office_role
      when 'municipal_treasurer' then 'Municipal Treasurer''s Office'
      when 'sangguniang_bayan' then 'Sangguniang Bayan Office'
      when 'mayor_office' then 'Mayor''s Office'
    end,
    ' -> ' order by step.sequence_number
  )
  into route_summary
  from public.workflow_routing_plans plan
  join public.workflow_routing_steps step
    on step.routing_plan_id = plan.id
  where plan.submission_id = new.id
    and plan.is_current
    and plan.status = 'proposed';

  if route_summary is null then
    raise exception 'The proposed route must include at least one office';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = new.id;

  notification_message := coalesce(submission.tracking_number, 'Pending tracking number')
    || ' — ' || submission.file_name
    || E'\nProposed route: ' || route_summary;
  if submission.approver_comments is not null then
    notification_message := notification_message
      || E'\nApprover notes: ' || submission.approver_comments;
  end if;

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments
  )
  values (
    new.id,
    auth.uid(),
    'ROUTE_PROPOSED',
    old.status,
    new.status,
    'Proposed route: ' || route_summary
      || case
        when submission.approver_comments is not null
          then E'\nApprover notes: ' || submission.approver_comments
        else ''
      end
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    new.id,
    'ROUTE_PROPOSED',
    'Office route proposed for review',
    notification_message
  from public.profiles profile
  where profile.role = 'admin'
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;

  return new;
end;
$$;

drop trigger if exists record_proposed_workflow_route
  on public.workflow_submissions;
create trigger record_proposed_workflow_route
after update of status on public.workflow_submissions
for each row
when (old.status is distinct from new.status)
execute function public.record_proposed_workflow_route();
