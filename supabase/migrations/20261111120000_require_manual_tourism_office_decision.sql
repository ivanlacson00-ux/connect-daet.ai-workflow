create or replace function public.require_manual_tourism_office_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
    and new.initial_destination_role = 'tourism_officer' then
    new.status := 'pending_approver';
    new.selected_office_role := null;
    new.final_decision_office_role := null;
    new.final_decision_by := null;
    new.final_decided_at := null;
  end if;

  if tg_op = 'UPDATE'
    and old.initial_destination_role = 'tourism_officer'
    and new.status = 'completed'
    and old.status is distinct from 'completed'
    and (
      current_setting('app.workflow_authorized_transition', true) is distinct from 'on'
      or auth.uid() is null
      or public.current_profile_role() is distinct from 'tourism_officer'
    ) then
    raise exception 'A Tourism Officer must explicitly approve this submission before it can be completed';
  end if;

  return new;
end;
$$;

drop trigger if exists require_manual_tourism_office_decision_insert
  on public.workflow_submissions;
create trigger require_manual_tourism_office_decision_insert
before insert on public.workflow_submissions
for each row
execute function public.require_manual_tourism_office_decision();

drop trigger if exists require_manual_tourism_office_decision_update
  on public.workflow_submissions;
create trigger require_manual_tourism_office_decision_update
before update of status on public.workflow_submissions
for each row
execute function public.require_manual_tourism_office_decision();

revoke all on function public.require_manual_tourism_office_decision() from public;
