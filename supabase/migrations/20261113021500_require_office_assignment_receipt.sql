create or replace function public.workflow_require_receipt_for_forwarded_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.assignment_source = 'office_forward' then
    new.status := 'pending';
    new.started_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.workflow_require_receipt_for_forwarded_assignment()
  from public, anon, authenticated;

drop trigger if exists workflow_require_receipt_for_forwarded_assignment
  on public.workflow_routing_steps;
create trigger workflow_require_receipt_for_forwarded_assignment
before insert on public.workflow_routing_steps
for each row
execute function public.workflow_require_receipt_for_forwarded_assignment();

update public.workflow_routing_steps step
set status = 'pending',
    started_at = null
from public.workflow_routing_plans plan
where plan.id = step.routing_plan_id
  and plan.is_current
  and plan.status = 'finalized'
  and step.assignment_source = 'office_forward'
  and step.status = 'in_progress';
