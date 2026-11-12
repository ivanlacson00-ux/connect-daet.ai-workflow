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
  join auth.users account on account.id = profile.id
  where profile.id = auth.uid()
    and profile.is_active
    and account.banned_until is null;

  if auth.uid() is null or actor_role is null then
    raise exception 'An active authenticated profile is required';
  end if;

  select *
  into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;

  if not found then
    raise exception 'Submission % not found', target_submission_id;
  end if;

  if actor_role = 'tourism_officer'
    and submission.status in ('pending', 'pending_approver')
    and next_status = 'pending_admin'
    and routed_office_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then
    update public.workflow_submissions
    set status = next_status,
        selected_office_role = routed_office_role,
        approver_comments = decision_comments,
        updated_at = timezone('utc', now())
    where id = target_submission_id;
    return;
  end if;

  if actor_role = 'system_admin'
    and submission.status = 'pending_admin'
    and next_status = 'pending_office'
    and routed_office_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then
    update public.workflow_submissions
    set status = next_status,
        selected_office_role = routed_office_role,
        admin_comments = decision_comments,
        updated_at = timezone('utc', now())
    where id = target_submission_id;
    return;
  end if;

  if actor_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan')
    and actor_role = submission.selected_office_role
    and submission.status = 'pending_office'
    and next_status = 'pending_mayor' then
    update public.workflow_submissions
    set status = next_status,
        office_comments = decision_comments,
        updated_at = timezone('utc', now())
    where id = target_submission_id;
    return;
  end if;

  if actor_role = 'mayor_office'
    and submission.status = 'pending_mayor'
    and next_status = 'returned_for_requirements'
    and coalesce(length(btrim(decision_comments)), 0) > 0 then
    update public.workflow_submissions
    set status = next_status,
        mayor_comments = decision_comments,
        updated_at = timezone('utc', now())
    where id = target_submission_id;
    return;
  end if;

  raise exception 'Generic approval and rejection decisions are not available; use Close Submission, request changes, or the configured formal-decision workflow';
end;
$$;

revoke all on function public.decide_workflow_submission(uuid, text, text, text) from public, anon;
grant execute on function public.decide_workflow_submission(uuid, text, text, text) to authenticated;

revoke all on function public.decide_workflow_route_step(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.finalize_workflow_submission(uuid, text) from public, anon;
grant execute on function public.finalize_workflow_submission(uuid, text) to authenticated;
