-- Enforce the current workflow transition model without renaming existing statuses.
-- This preserves compatibility while preventing unauthorized or invalid status changes.
create or replace function public.enforce_workflow_submission_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
begin
  if new.status = old.status then
    return new;
  end if;

  select role
    into actor_role
  from public.profiles
  where id = auth.uid();

  if actor_role is null then
    raise exception 'A valid authenticated profile is required to change workflow status';
  end if;

  if old.status in ('pending', 'pending_approver') then
    if new.status in ('pending_admin', 'declined_by_approver') then
      if actor_role <> 'approver' then
        raise exception 'Only an approver can complete or decline verification';
      end if;
    else
      raise exception 'Invalid workflow transition from % to %', old.status, new.status;
    end if;
  elsif old.status = 'pending_admin' then
    if new.status in ('approved', 'declined_by_admin') then
      if actor_role <> 'admin' then
        raise exception 'Only an administrator can approve or decline a submission';
      end if;
    else
      raise exception 'Invalid workflow transition from % to %', old.status, new.status;
    end if;
  elsif old.status = 'approved' then
    if new.status = 'completed' then
      if actor_role <> 'admin' then
        raise exception 'Only an administrator can complete an approved submission';
      end if;
    else
      raise exception 'Invalid workflow transition from % to %', old.status, new.status;
    end if;
  elsif old.status = 'declined_by_approver' then
    if new.status = 'pending' then
      if actor_role <> 'user' or new.user_id <> auth.uid() then
        raise exception 'Only the submitting user can resubmit a returned document';
      end if;
    else
      raise exception 'Invalid workflow transition from % to %', old.status, new.status;
    end if;
  else
    raise exception 'Invalid workflow transition from % to %', old.status, new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_workflow_submission_transition
  on public.workflow_submissions;

create trigger enforce_workflow_submission_transition
before update of status on public.workflow_submissions
for each row
execute function public.enforce_workflow_submission_transition();
