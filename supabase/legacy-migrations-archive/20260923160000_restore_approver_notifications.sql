-- Notify every approver when a document enters or returns to verification.
-- This keeps verification open to all approvers without requiring assignment.
create or replace function public.create_workflow_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.workflow_submissions;
  notification_title text;
  notification_message text;
begin
  select *
    into submission
  from public.workflow_submissions
  where id = new.submission_id;

  notification_title := case new.action_type
    when 'SUBMITTED' then 'New document submitted'
    when 'VERIFICATION_PASSED' then 'Verification completed'
    when 'RETURNED_FOR_CORRECTION' then 'Document returned for correction'
    when 'FINAL_APPROVAL' then 'Document approved'
    when 'FINAL_REJECTION' then 'Document rejected'
    when 'WORKFLOW_COMPLETED' then 'Workflow completed'
    else 'Workflow status updated'
  end;

  notification_message := coalesce(submission.tracking_number, 'Pending tracking number')
    || ' — ' || submission.file_name;

  if new.action_type in (
    'SUBMITTED',
    'RETURNED_FOR_CORRECTION',
    'FINAL_APPROVAL',
    'FINAL_REJECTION',
    'WORKFLOW_COMPLETED'
  ) then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    values (
      submission.user_id, new.submission_id, new.action_type,
      notification_title, notification_message
    )
    on conflict (recipient_id, submission_id, event_type, title, message)
    do nothing;
  end if;

  if new.action_type in (
    'SUBMITTED',
    'VERIFICATION_PASSED',
    'FINAL_APPROVAL',
    'FINAL_REJECTION',
    'WORKFLOW_COMPLETED'
  ) then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select profile.id, new.submission_id, new.action_type,
      notification_title, notification_message
    from public.profiles profile
    where profile.role = 'admin'
      and profile.id <> coalesce(
        new.action_by,
        '00000000-0000-0000-0000-000000000000'::uuid
      )
    on conflict (recipient_id, submission_id, event_type, title, message)
    do nothing;
  end if;

  if new.action_type in ('SUBMITTED', 'RETURNED_FOR_CORRECTION') then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select profile.id, new.submission_id, new.action_type,
      notification_title, notification_message
    from public.profiles profile
    where profile.role = 'approver'
    on conflict (recipient_id, submission_id, event_type, title, message)
    do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists create_workflow_notifications
  on public.workflow_audit_logs;

create trigger create_workflow_notifications
after insert on public.workflow_audit_logs
for each row
execute function public.create_workflow_notifications();

-- Backfill the initial submission notification for pending documents that
-- were created while approver delivery was disabled.
delete from public.workflow_notifications
where event_type in ('ASSIGNED', 'REASSIGNED');

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
on conflict (recipient_id, submission_id, event_type, title, message)
do nothing;

-- Allow staff to display the requester identity on their notification cards.
drop policy if exists "Users can view their own profile" on public.profiles;

create policy "Users and workflow staff can view profiles"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_workflow_staff());
