create or replace function public.decide_workflow_submission(
  target_submission_id uuid,
  next_status text,
  decision_comments text default null,
  routed_office_role text default null
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
  select profile.role
  into actor_role
  from public.profiles profile
  where profile.id = auth.uid();

  if auth.uid() is null or actor_role is null then
    raise exception 'A valid authenticated profile is required';
  end if;

  select *
  into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;

  if not found then
    raise exception 'Submission not found';
  end if;

  if actor_role = 'approver'
    and submission.status in ('pending', 'pending_approver') then
    if next_status = 'pending_admin'
      and routed_office_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then
      update public.workflow_submissions
      set status = next_status,
          selected_office_role = routed_office_role,
          approver_comments = decision_comments,
          updated_at = timezone('utc', now())
      where id = target_submission_id;
      return;
    elsif next_status = 'declined_by_approver'
      and coalesce(length(btrim(decision_comments)), 0) > 0 then
      update public.workflow_submissions
      set status = next_status,
          approver_comments = decision_comments,
          updated_at = timezone('utc', now())
      where id = target_submission_id;
      return;
    end if;
    raise exception 'Approver must select an office or provide a rejection reason';
  end if;

  if actor_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan')
    and actor_role = submission.selected_office_role
    and submission.status = 'pending_office' then
    if next_status = 'pending_mayor' then
      update public.workflow_submissions
      set status = next_status,
          office_comments = decision_comments,
          updated_at = timezone('utc', now())
      where id = target_submission_id;
      return;
    elsif next_status = 'declined_by_office'
      and coalesce(length(btrim(decision_comments)), 0) > 0 then
      update public.workflow_submissions
      set status = next_status,
          office_comments = decision_comments,
          updated_at = timezone('utc', now())
      where id = target_submission_id;
      return;
    end if;
    raise exception 'Assigned office must forward the request or provide a rejection reason';
  end if;

  if actor_role = 'mayor_office' and submission.status = 'pending_mayor' then
    if next_status = 'completed' then
      update public.workflow_submissions
      set status = next_status,
          mayor_comments = decision_comments,
          updated_at = timezone('utc', now())
      where id = target_submission_id;
      return;
    elsif next_status in ('declined_by_mayor', 'returned_for_requirements')
      and coalesce(length(btrim(decision_comments)), 0) > 0 then
      update public.workflow_submissions
      set status = next_status,
          mayor_comments = decision_comments,
          updated_at = timezone('utc', now())
      where id = target_submission_id;
      return;
    end if;
    raise exception 'Mayor must approve, reject with a reason, or request additional requirements';
  end if;

  raise exception 'Submission is not awaiting a decision: role=%, status=%',
    coalesce(actor_role, 'unknown'),
    coalesce(submission.status, 'unknown');
end;
$$;

revoke all on function public.decide_workflow_submission(uuid, text, text, text) from public;
grant execute on function public.decide_workflow_submission(uuid, text, text, text) to authenticated;
