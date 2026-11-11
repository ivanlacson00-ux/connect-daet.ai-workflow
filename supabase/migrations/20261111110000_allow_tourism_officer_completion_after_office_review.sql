create or replace function public.complete_office_forwarded_submission(
  target_submission_id uuid,
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
  now_at timestamptz := timezone('utc', now());
begin
  if auth.uid() is null
    or actor_role is distinct from 'tourism_officer'
    or not exists (
      select 1
      from auth.users account
      where account.id = auth.uid()
        and account.banned_until is null
    ) then
    raise exception 'An active Tourism Officer is required to complete this submission';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found
    or submission.status is distinct from 'pending_approver'
    or submission.initial_destination_role is null
    or submission.initial_destination_role not in (
      'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
    )
    or submission.selected_office_role is distinct from submission.initial_destination_role
    or not exists (
      select 1
      from public.workflow_audit_logs log
      where log.submission_id = target_submission_id
        and log.action_type = 'OFFICE_FORWARDED_TO_TOURISM_OFFICER'
        and log.new_status = 'pending_approver'
    ) then
    raise exception 'This submission must first be reviewed and forwarded by its initial municipal office';
  end if;

  if exists (
    select 1
    from public.workflow_routing_plans plan
    join public.workflow_routing_steps step on step.routing_plan_id = plan.id
    where plan.submission_id = target_submission_id
      and plan.is_current
      and plan.status = 'finalized'
      and step.status <> 'approved'
  ) then
    raise exception 'All finalized office assignments must be completed before the Tourism Officer can complete this submission';
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'completed',
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
    'APPROVER_COMPLETED',
    'pending_approver',
    'completed',
    nullif(btrim(decision_comments), ''),
    now_at
  );
end;
$$;

revoke all on function public.complete_office_forwarded_submission(uuid, text) from public;
grant execute on function public.complete_office_forwarded_submission(uuid, text) to authenticated;
