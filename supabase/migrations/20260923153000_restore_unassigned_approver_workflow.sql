-- Restore the original workflow model: every approver can process every submission.
-- Notification history remains enabled, but assignment is no longer required.
drop trigger if exists create_workflow_notifications
  on public.workflow_audit_logs;
drop function if exists public.create_workflow_notifications();
drop function if exists public.assign_workflow_submission(uuid, uuid);
drop table if exists public.workflow_assignments;

drop policy if exists "Users and workflow staff can view profiles" on public.profiles;
create policy "Users can view their own profile"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_workflow_admin());

drop policy if exists "Users and staff can view authorized submissions"
  on public.workflow_submissions;

create policy "Users and staff can view authorized submissions"
  on public.workflow_submissions
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_workflow_staff());

drop policy if exists "Users and staff can update authorized submissions"
  on public.workflow_submissions;

create policy "Users and staff can update authorized submissions"
  on public.workflow_submissions
  for update
  to authenticated
  using (user_id = auth.uid() or public.is_workflow_staff())
  with check (user_id = auth.uid() or public.is_workflow_staff());

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

  select role into actor_role
  from public.profiles
  where id = auth.uid();

  if actor_role is null then
    raise exception 'A valid authenticated profile is required to change workflow status';
  end if;

  if old.status in ('pending', 'pending_approver') then
    if new.status in ('pending_admin', 'declined_by_approver')
      and actor_role = 'approver' then
      return new;
    end if;
    raise exception 'Only an approver can complete or decline verification';
  elsif old.status = 'pending_admin' then
    if new.status in ('approved', 'declined_by_admin')
      and actor_role = 'admin' then
      return new;
    end if;
    raise exception 'Only an administrator can approve or decline a submission';
  elsif old.status = 'approved' then
    if new.status = 'completed' and actor_role = 'admin' then
      return new;
    end if;
    raise exception 'Only an administrator can complete an approved submission';
  elsif old.status = 'declined_by_approver' then
    if new.status = 'pending'
      and actor_role = 'user'
      and new.user_id = auth.uid() then
      return new;
    end if;
    raise exception 'Only the submitting user can resubmit a returned document';
  end if;

  raise exception 'Invalid workflow transition from % to %', old.status, new.status;
end;
$$;

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
  select * into submission
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

  return new;
end;
$$;

create trigger create_workflow_notifications
after insert on public.workflow_audit_logs
for each row
execute function public.create_workflow_notifications();
