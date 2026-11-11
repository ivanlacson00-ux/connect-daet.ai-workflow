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
  if submission.status is distinct from 'submitted'
    or submission.received_at is not null then
    raise exception 'A submission can only be withdrawn before the responsible office receives it';
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
