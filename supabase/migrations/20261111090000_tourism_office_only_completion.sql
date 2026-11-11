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
  ) then
    raise exception 'Tourism Office submissions must be completed within the Tourism Office';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_tourism_office_submission_routing
  on public.workflow_routing_plans;
create trigger prevent_tourism_office_submission_routing
before insert on public.workflow_routing_plans
for each row
execute function public.prevent_tourism_office_submission_routing();
revoke all on function public.prevent_tourism_office_submission_routing() from public;

create or replace function public.prevent_tourism_office_submission_forwarding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.initial_destination_role = 'tourism_officer'
    and new.status in ('pending_admin', 'pending_office', 'pending_mayor') then
    raise exception 'Tourism Office submissions cannot be forwarded to a municipal office';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_tourism_office_submission_forwarding
  on public.workflow_submissions;
create trigger prevent_tourism_office_submission_forwarding
before update of status on public.workflow_submissions
for each row
execute function public.prevent_tourism_office_submission_forwarding();
revoke all on function public.prevent_tourism_office_submission_forwarding() from public;

create or replace function public.complete_tourism_office_submission(
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
    raise exception 'An active Tourism Office member is required to complete this request';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found
    or submission.status not in ('pending', 'pending_approver')
    or submission.initial_destination_role is distinct from 'tourism_officer'
    or submission.selected_office_role is not null then
    raise exception 'This request is not awaiting a Tourism Office decision';
  end if;
  if exists (
    select 1
    from public.workflow_routing_plans plan
    where plan.submission_id = target_submission_id
      and plan.is_current
  ) then
    raise exception 'This Tourism Office request has an active municipal route and cannot be completed';
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'completed',
      selected_office_role = null,
      final_decision_office_role = null,
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

revoke all on function public.complete_tourism_office_submission(uuid, text) from public;
grant execute on function public.complete_tourism_office_submission(uuid, text) to authenticated;
