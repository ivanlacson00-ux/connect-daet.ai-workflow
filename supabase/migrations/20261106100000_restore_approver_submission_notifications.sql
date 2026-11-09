create or replace function public.notify_approvers_of_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.workflow_submissions;
begin
  if new.action_type <> 'SUBMITTED' then
    return new;
  end if;

  select * into submission
  from public.workflow_submissions
  where id = new.submission_id;

  if not found then
    raise exception 'Submission % not found for approver notification', new.submission_id;
  end if;

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    submission.id,
    'SUBMITTED',
    'New document submitted',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name
  from public.profiles profile
  where profile.role = 'approver'
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;

  return new;
end;
$$;

drop trigger if exists notify_approvers_of_submission
  on public.workflow_audit_logs;
create trigger notify_approvers_of_submission
after insert on public.workflow_audit_logs
for each row
when (new.action_type = 'SUBMITTED')
execute function public.notify_approvers_of_submission();

insert into public.workflow_notifications (
  recipient_id, submission_id, event_type, title, message
)
select
  profile.id,
  submission.id,
  'SUBMITTED',
  'New document submitted',
  coalesce(submission.tracking_number, 'Pending tracking number')
    || ' — ' || submission.file_name
from public.workflow_submissions submission
cross join public.profiles profile
where profile.role = 'approver'
  and submission.status in ('pending', 'pending_approver')
on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
