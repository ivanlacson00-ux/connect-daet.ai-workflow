-- Persist workflow notifications for users, assigned approvers, and administrators.
create table if not exists public.workflow_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  submission_id uuid not null references public.workflow_submissions(id) on delete cascade,
  event_type text not null,
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists workflow_notifications_recipient_created_at_idx
  on public.workflow_notifications (recipient_id, created_at desc);

-- Remove exact duplicate deliveries created by repeated trigger execution.
with duplicate_notifications as (
  select
    id,
    row_number() over (
      partition by recipient_id, submission_id, event_type, title, message
      order by created_at desc, id desc
    ) as duplicate_rank
  from public.workflow_notifications
)
delete from public.workflow_notifications notification
using duplicate_notifications duplicate
where notification.id = duplicate.id
  and duplicate.duplicate_rank > 1;

create unique index if not exists workflow_notifications_exact_delivery_idx
  on public.workflow_notifications (recipient_id, submission_id, event_type, title, message);

insert into public.workflow_notifications (
  recipient_id,
  submission_id,
  event_type,
  title,
  message
)
select
  assignment.approver_id,
  submission.id,
  'ASSIGNED',
  'Document assigned for verification',
  coalesce(submission.tracking_number, 'Pending tracking number')
    || ' — ' || submission.file_name
from public.workflow_assignments assignment
join public.workflow_submissions submission
  on submission.id = assignment.submission_id
where assignment.status = 'active'
on conflict (recipient_id, submission_id, event_type, title, message)
do nothing;

alter table public.workflow_notifications enable row level security;

drop policy if exists "Users can view their workflow notifications"
  on public.workflow_notifications;

create policy "Users can view their workflow notifications"
  on public.workflow_notifications
  for select
  to authenticated
  using (recipient_id = auth.uid());

drop policy if exists "Users can update their workflow notifications"
  on public.workflow_notifications;

create policy "Users can update their workflow notifications"
  on public.workflow_notifications
  for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

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
    when 'ASSIGNED' then 'Document assigned for verification'
    when 'REASSIGNED' then 'Document assignment changed'
    when 'VERIFICATION_PASSED' then 'Verification completed'
    when 'RETURNED_FOR_CORRECTION' then 'Document returned for correction'
    when 'FINAL_APPROVAL' then 'Document approved'
    when 'FINAL_REJECTION' then 'Document rejected'
    when 'WORKFLOW_COMPLETED' then 'Workflow completed'
    else 'Workflow status updated'
  end;

  notification_message := coalesce(submission.tracking_number, 'Pending tracking number')
    || ' — ' || submission.file_name;

  if new.action_type in ('SUBMITTED', 'RETURNED_FOR_CORRECTION', 'FINAL_APPROVAL',
                         'FINAL_REJECTION', 'WORKFLOW_COMPLETED') then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    values (
      submission.user_id, new.submission_id, new.action_type,
      notification_title, notification_message
    );
  end if;

  if new.action_type in ('SUBMITTED', 'VERIFICATION_PASSED', 'FINAL_APPROVAL',
                         'FINAL_REJECTION', 'WORKFLOW_COMPLETED') then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select
      profile.id, new.submission_id, new.action_type,
      notification_title, notification_message
    from public.profiles profile
    where profile.role = 'admin'
      and profile.id <> coalesce(new.action_by, '00000000-0000-0000-0000-000000000000'::uuid);
  end if;

  if new.action_type in ('ASSIGNED', 'REASSIGNED') then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select
      assignment.approver_id, new.submission_id, new.action_type,
      notification_title, notification_message
    from public.workflow_assignments assignment
    where assignment.submission_id = new.submission_id
      and assignment.status = 'active';
  elsif new.action_type in ('SUBMITTED', 'RETURNED_FOR_CORRECTION') then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select
      assignment.approver_id, new.submission_id, new.action_type,
      notification_title, notification_message
    from public.workflow_assignments assignment
    where assignment.submission_id = new.submission_id
      and assignment.status = 'active';
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
