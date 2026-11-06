create or replace function public.workflow_categories_for_role(role_name text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case role_name
    when 'municipal_treasurer' then array[
      'Tax and Payment Documents',
      'Business Permit Fees',
      'Official Receipts',
      'Financial Requests'
    ]
    when 'mayor_office' then array[
      'Executive Requests',
      'Complaints',
      'Mayoral Endorsements',
      'General Correspondence'
    ]
    when 'sangguniang_bayan' then array[
      'Proposed Ordinances',
      'Proposed Resolutions',
      'Legislative Requests',
      'Session-Related Submissions'
    ]
    else array[]::text[]
  end
$$;

create or replace function public.is_submission_for_current_office(submission_category text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    submission_category = any(
      public.workflow_categories_for_role(public.current_profile_role())
    ),
    false
  )
$$;

create or replace function public.is_workflow_file_accessible(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_submissions submission
    where submission.file_path = object_name
      and (
        submission.user_id = auth.uid()
        or public.is_workflow_staff()
        or public.is_submission_for_current_office(submission.category)
      )
  )
$$;

drop policy if exists "Users can view their own profile" on public.profiles;
drop policy if exists "Users and workflow staff can view profiles" on public.profiles;

create policy "Users and authorized staff can view profiles"
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.is_workflow_admin()
    or public.current_profile_role() = 'approver'
    or exists (
      select 1
      from public.workflow_submissions submission
      where submission.user_id = profiles.id
        and public.is_submission_for_current_office(submission.category)
    )
  );

drop policy if exists "Users and staff can view authorized submissions"
  on public.workflow_submissions;

create policy "Users and staff can view authorized submissions"
  on public.workflow_submissions
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_workflow_staff()
    or public.is_submission_for_current_office(category)
  );

drop policy if exists "Users and staff can update authorized submissions"
  on public.workflow_submissions;

create policy "Users and staff can update authorized submissions"
  on public.workflow_submissions
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_workflow_staff()
    or public.is_submission_for_current_office(category)
  )
  with check (
    user_id = auth.uid()
    or public.is_workflow_staff()
    or public.is_submission_for_current_office(category)
  );

drop policy if exists "Users and workflow staff can view authorized audit logs"
  on public.workflow_audit_logs;
drop policy if exists "Users and staff can view authorized audit logs"
  on public.workflow_audit_logs;

create policy "Users and staff can view authorized audit logs"
  on public.workflow_audit_logs
  for select
  to authenticated
  using (
    public.is_workflow_staff()
    or exists (
      select 1
      from public.workflow_submissions submission
      where submission.id = workflow_audit_logs.submission_id
        and (
          submission.user_id = auth.uid()
          or public.is_submission_for_current_office(submission.category)
        )
    )
  );

drop policy if exists "Workflow users can read uploaded files" on storage.objects;

create policy "Workflow users can read uploaded files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'workflow_uploads'
    and (
      name like (auth.uid()::text || '/%')
      or public.is_workflow_staff()
      or public.is_workflow_file_accessible(name)
    )
  );

create or replace function public.enforce_workflow_submission_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();

  if actor_role is null then
    raise exception 'A valid authenticated profile is required to change a submission';
  end if;

  if actor_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then
    if new.status not in ('pending_admin')
      or old.status not in ('pending', 'pending_approver')
      or not (new.category = any(public.workflow_categories_for_role(actor_role)))
      or coalesce(length(btrim(new.approver_comments)), 0) = 0
      or (
        to_jsonb(new) - array['status', 'approver_comments', 'updated_at']
        is distinct from
        to_jsonb(old) - array['status', 'approver_comments', 'updated_at']
      ) then
      raise exception 'Office users may only add review feedback and forward documents in their category';
    end if;

    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if old.status in ('pending', 'pending_approver') then
    if new.status in ('pending_admin', 'declined_by_approver')
      and actor_role = 'approver' then
      return new;
    end if;
    raise exception 'Only an authorized reviewer can complete verification';
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
    'SUBMITTED', 'RETURNED_FOR_CORRECTION', 'FINAL_APPROVAL',
    'FINAL_REJECTION', 'WORKFLOW_COMPLETED'
  ) then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    values (
      submission.user_id, new.submission_id, new.action_type,
      notification_title, notification_message
    )
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
  end if;

  if new.action_type in (
    'SUBMITTED', 'VERIFICATION_PASSED', 'FINAL_APPROVAL',
    'FINAL_REJECTION', 'WORKFLOW_COMPLETED'
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
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
  end if;

  if new.action_type in ('SUBMITTED', 'RETURNED_FOR_CORRECTION') then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select profile.id, new.submission_id, new.action_type,
      notification_title, notification_message
    from public.profiles profile
    where profile.role = 'approver'
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;

    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select profile.id, new.submission_id, new.action_type,
      notification_title, notification_message
    from public.profiles profile
    where submission.category = any(
      public.workflow_categories_for_role(profile.role)
    )
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
  end if;

  return new;
end;
$$;
