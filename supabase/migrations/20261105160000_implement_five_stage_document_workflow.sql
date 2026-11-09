alter table public.workflow_submissions
  add column if not exists purpose text,
  add column if not exists requested_action text,
  add column if not exists intended_recipient text,
  add column if not exists selected_office_role text,
  add column if not exists office_comments text,
  add column if not exists mayor_comments text,
  add column if not exists sender_response text,
  add column if not exists office_reviewed_at timestamptz,
  add column if not exists mayor_decided_at timestamptz;

alter table public.workflow_submissions
  drop constraint if exists workflow_submissions_selected_office_role_check;

alter table public.workflow_submissions
  add constraint workflow_submissions_selected_office_role_check
  check (
    selected_office_role is null
    or selected_office_role in (
      'municipal_treasurer',
      'mayor_office',
      'sangguniang_bayan'
    )
  );

create table if not exists public.workflow_submission_attachments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.workflow_submissions(id) on delete cascade,
  file_name text not null,
  file_path text not null unique,
  file_type text,
  file_size bigint not null check (file_size >= 0),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists workflow_submission_attachments_submission_idx
  on public.workflow_submission_attachments (submission_id, created_at);

alter table public.workflow_submission_attachments enable row level security;

create or replace function public.create_workflow_submission(
  submission_title text,
  submission_file_path text,
  submission_file_url text,
  submission_file_type text,
  submission_file_size bigint,
  submission_document_type text,
  submission_description text,
  submission_purpose text,
  submission_requested_action text,
  submission_intended_recipient text,
  attachment_records jsonb default '[]'::jsonb
)
returns table (id uuid, tracking_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  created_submission public.workflow_submissions;
  attachment_record record;
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'user' then
    raise exception 'Only a submitter can create a workflow submission';
  end if;

  if coalesce(length(btrim(submission_title)), 0) = 0
    or coalesce(length(btrim(submission_file_path)), 0) = 0
    or coalesce(length(btrim(submission_document_type)), 0) = 0
    or coalesce(length(btrim(submission_description)), 0) = 0
    or coalesce(length(btrim(submission_purpose)), 0) = 0
    or coalesce(length(btrim(submission_requested_action)), 0) = 0 then
    raise exception 'Title, document, document type, description, purpose, and requested action are required';
  end if;

  if submission_file_path not like (auth.uid()::text || '/%')
    or jsonb_typeof(attachment_records) is distinct from 'array' then
    raise exception 'Invalid document storage path or attachment list';
  end if;

  insert into public.workflow_submissions (
    user_id,
    file_url,
    file_path,
    file_name,
    file_size,
    file_type,
    category,
    description,
    purpose,
    requested_action,
    intended_recipient,
    status
  )
  values (
    auth.uid(),
    submission_file_url,
    submission_file_path,
    submission_title,
    submission_file_size,
    submission_file_type,
    submission_document_type,
    submission_description,
    submission_purpose,
    submission_requested_action,
    nullif(btrim(submission_intended_recipient), ''),
    'pending'
  )
  returning * into created_submission;

  for attachment_record in
    select *
    from jsonb_to_recordset(attachment_records) as attachment(
      file_name text,
      file_path text,
      file_type text,
      file_size bigint
    )
  loop
    if coalesce(length(btrim(attachment_record.file_name)), 0) = 0
      or attachment_record.file_path not like (auth.uid()::text || '/%')
      or attachment_record.file_size is null
      or attachment_record.file_size < 0 then
      raise exception 'Invalid supporting attachment metadata';
    end if;

    insert into public.workflow_submission_attachments (
      submission_id, file_name, file_path, file_type, file_size, uploaded_by
    )
    values (
      created_submission.id,
      attachment_record.file_name,
      attachment_record.file_path,
      attachment_record.file_type,
      attachment_record.file_size,
      auth.uid()
    );
  end loop;

  return query select created_submission.id, created_submission.tracking_number;
end;
$$;

revoke all on function public.create_workflow_submission(
  text, text, text, text, bigint, text, text, text, text, text, jsonb
) from public;
grant execute on function public.create_workflow_submission(
  text, text, text, text, bigint, text, text, text, text, text, jsonb
) to authenticated;

drop policy if exists "Authorized users can view submission attachments"
  on public.workflow_submission_attachments;
create policy "Authorized users can view submission attachments"
  on public.workflow_submission_attachments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workflow_submissions submission
      where submission.id = workflow_submission_attachments.submission_id
        and (
          submission.user_id = auth.uid()
          or public.is_workflow_staff()
          or submission.selected_office_role = public.current_profile_role()
          or (
            public.current_profile_role() = 'mayor_office'
            and submission.status = 'pending_mayor'
          )
        )
    )
  );

drop policy if exists "Submitters can add attachments to active requests"
  on public.workflow_submission_attachments;
create policy "Submitters can add attachments to active requests"
  on public.workflow_submission_attachments
  for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1
      from public.workflow_submissions submission
      where submission.id = workflow_submission_attachments.submission_id
        and submission.user_id = auth.uid()
        and submission.status in ('pending', 'returned_for_requirements')
    )
  );

drop policy if exists "Submitters can remove attachments while responding"
  on public.workflow_submission_attachments;
create policy "Submitters can remove attachments while responding"
  on public.workflow_submission_attachments
  for delete
  to authenticated
  using (
    uploaded_by = auth.uid()
    and exists (
      select 1
      from public.workflow_submissions submission
      where submission.id = workflow_submission_attachments.submission_id
        and submission.user_id = auth.uid()
        and submission.status = 'returned_for_requirements'
    )
  );

create or replace function public.is_submission_for_current_office(submission_category text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_submissions submission
    where submission.category = submission_category
      and (
        submission.selected_office_role = public.current_profile_role()
        or (
          public.current_profile_role() = 'mayor_office'
          and submission.status = 'pending_mayor'
        )
      )
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
    where (
      submission.file_path = object_name
      or exists (
        select 1
        from public.workflow_submission_attachments attachment
        where attachment.submission_id = submission.id
          and attachment.file_path = object_name
      )
    )
      and (
        submission.user_id = auth.uid()
        or public.is_workflow_staff()
        or submission.selected_office_role = public.current_profile_role()
        or (
          public.current_profile_role() = 'mayor_office'
          and submission.status = 'pending_mayor'
        )
      )
  )
$$;

drop policy if exists "Users and authorized staff can view profiles" on public.profiles;
drop policy if exists "Users and workflow staff can view profiles" on public.profiles;
drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users and authorized workflow staff can view profiles"
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
        and (
          submission.selected_office_role = public.current_profile_role()
          or (
            public.current_profile_role() = 'mayor_office'
            and submission.status = 'pending_mayor'
          )
        )
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
    or selected_office_role = public.current_profile_role()
    or (
      public.current_profile_role() = 'mayor_office'
      and status = 'pending_mayor'
    )
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
    or selected_office_role = public.current_profile_role()
    or (
      public.current_profile_role() = 'mayor_office'
      and status = 'pending_mayor'
    )
  )
  with check (
    user_id = auth.uid()
    or public.is_workflow_staff()
    or selected_office_role = public.current_profile_role()
    or (
      public.current_profile_role() = 'mayor_office'
      and status in ('pending_mayor', 'completed', 'declined_by_mayor', 'returned_for_requirements')
    )
  );

drop policy if exists "Users and staff can view authorized audit logs"
  on public.workflow_audit_logs;
drop policy if exists "Users and workflow staff can view authorized audit logs"
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
          or submission.selected_office_role = public.current_profile_role()
          or (
            public.current_profile_role() = 'mayor_office'
            and submission.status = 'pending_mayor'
          )
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
  allowed_office_roles text[] := array[
    'municipal_treasurer',
    'mayor_office',
    'sangguniang_bayan'
  ];
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();

  if actor_role is null then
    raise exception 'A valid authenticated profile is required to change a submission';
  end if;

  if new.status is not distinct from old.status then
    if actor_role = 'admin' then
      return new;
    end if;
    raise exception 'Workflow records can only be changed through an authorized stage decision';
  end if;

  if actor_role = 'approver'
    and old.status in ('pending', 'pending_approver') then
    if new.status = 'pending_admin'
      and new.selected_office_role = any(allowed_office_roles)
      and (
        to_jsonb(new) - array['status', 'selected_office_role', 'approver_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'selected_office_role', 'approver_comments', 'updated_at']
      ) then
      return new;
    elsif new.status = 'declined_by_approver'
      and coalesce(length(btrim(new.approver_comments)), 0) > 0
      and (
        to_jsonb(new) - array['status', 'approver_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'approver_comments', 'updated_at']
      ) then
      new.archived_at := coalesce(new.archived_at, timezone('utc', now()));
      new.archived_by := auth.uid();
      return new;
    end if;
    raise exception 'Approver must select an office or provide a rejection reason';
  end if;

  if actor_role = 'admin' and old.status = 'pending_admin' then
    if new.status = 'pending_office'
      and new.selected_office_role = any(allowed_office_roles)
      and (
        to_jsonb(new) - array['status', 'selected_office_role', 'admin_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'selected_office_role', 'admin_comments', 'updated_at']
      ) then
      return new;
    elsif new.status = 'declined_by_admin'
      and coalesce(length(btrim(new.admin_comments)), 0) > 0
      and (
        to_jsonb(new) - array['status', 'admin_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'admin_comments', 'updated_at']
      ) then
      new.archived_at := coalesce(new.archived_at, timezone('utc', now()));
      new.archived_by := auth.uid();
      return new;
    end if;
    raise exception 'Administrator must verify routing or provide a rejection reason';
  end if;

  if actor_role = old.selected_office_role and old.status = 'pending_office' then
    if new.status = 'pending_mayor'
      and (
        to_jsonb(new) - array['status', 'office_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'office_comments', 'updated_at']
      ) then
      return new;
    elsif new.status = 'declined_by_office'
      and coalesce(length(btrim(new.office_comments)), 0) > 0
      and (
        to_jsonb(new) - array['status', 'office_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'office_comments', 'updated_at']
      ) then
      new.archived_at := coalesce(new.archived_at, timezone('utc', now()));
      new.archived_by := auth.uid();
      return new;
    end if;
    raise exception 'Assigned office must forward the request or provide a rejection reason';
  end if;

  if actor_role = 'mayor_office' and old.status = 'pending_mayor' then
    if new.status = 'completed'
      and (
        to_jsonb(new) - array['status', 'mayor_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'mayor_comments', 'updated_at']
      ) then
      new.archived_at := coalesce(new.archived_at, timezone('utc', now()));
      new.archived_by := auth.uid();
      return new;
    elsif new.status = 'declined_by_mayor'
      and coalesce(length(btrim(new.mayor_comments)), 0) > 0
      and (
        to_jsonb(new) - array['status', 'mayor_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'mayor_comments', 'updated_at']
      ) then
      new.archived_at := coalesce(new.archived_at, timezone('utc', now()));
      new.archived_by := auth.uid();
      return new;
    elsif new.status = 'returned_for_requirements'
      and coalesce(length(btrim(new.mayor_comments)), 0) > 0
      and (
        to_jsonb(new) - array['status', 'mayor_comments', 'updated_at']
        is not distinct from
        to_jsonb(old) - array['status', 'mayor_comments', 'updated_at']
      ) then
      return new;
    end if;
    raise exception 'Mayor must approve, reject with a reason, or request additional requirements';
  end if;

  if actor_role = 'user' and old.user_id = auth.uid()
    and old.status = 'returned_for_requirements'
    and new.status = 'pending_mayor'
    and coalesce(length(btrim(new.sender_response)), 0) > 0
    and (
      to_jsonb(new) - array['status', 'sender_response', 'updated_at']
      is not distinct from
      to_jsonb(old) - array['status', 'sender_response', 'updated_at']
    ) then
    return new;
  end if;

  if actor_role = 'admin' and old.status = 'approved' and new.status = 'completed' then
    return new;
  end if;

  raise exception 'Invalid workflow transition from % to % for role %',
    old.status, new.status, actor_role;
end;
$$;

create or replace function public.workflow_stage_deadline(
  stage_status text,
  stage_started_at timestamptz
)
returns timestamptz
language sql
immutable
as $$
  select case stage_status
    when 'pending' then stage_started_at + interval '2 days'
    when 'pending_approver' then stage_started_at + interval '2 days'
    when 'pending_admin' then stage_started_at + interval '2 days'
    when 'pending_office' then stage_started_at + interval '2 days'
    when 'pending_mayor' then stage_started_at + interval '2 days'
    when 'returned_for_requirements' then stage_started_at + interval '2 days'
    when 'approved' then stage_started_at + interval '1 day'
    else null
  end
$$;

create or replace function public.sync_workflow_stage_timing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_time timestamptz := coalesce(new.updated_at, timezone('utc', now()));
begin
  if tg_op = 'INSERT' then
    new.submitted_at := coalesce(new.submitted_at, new.created_at, event_time);
    new.current_stage_started_at := coalesce(new.current_stage_started_at, new.submitted_at);
  elsif new.status is distinct from old.status then
    if new.status in ('pending', 'pending_approver') then
      new.current_stage_started_at := event_time;
    elsif new.status in ('pending_admin', 'pending_office', 'pending_mayor', 'returned_for_requirements') then
      new.current_stage_started_at := event_time;
      if new.status = 'pending_office' then
        new.verified_at := coalesce(new.verified_at, event_time);
        new.office_reviewed_at := null;
      elsif new.status = 'pending_mayor' and old.status = 'pending_office' then
        new.office_reviewed_at := event_time;
      end if;
    elsif new.status = 'completed' then
      new.completed_at := coalesce(new.completed_at, event_time);
      new.mayor_decided_at := coalesce(new.mayor_decided_at, event_time);
      new.current_stage_started_at := null;
    elsif new.status like 'declined_by_%' then
      if old.status = 'pending_mayor' then
        new.mayor_decided_at := coalesce(new.mayor_decided_at, event_time);
      elsif old.status = 'pending_office' then
        new.office_reviewed_at := coalesce(new.office_reviewed_at, event_time);
      end if;
      new.current_stage_started_at := null;
    end if;
  end if;

  new.current_stage_due_at := public.workflow_stage_deadline(
    new.status,
    new.current_stage_started_at
  );
  new.current_responsible_role := case
    when new.status in ('pending', 'pending_approver') then 'approver'
    when new.status = 'pending_admin' then 'admin'
    when new.status = 'pending_office' then new.selected_office_role
    when new.status = 'pending_mayor' then 'mayor_office'
    when new.status = 'returned_for_requirements' then 'user'
    else null
  end;
  return new;
end;
$$;

create or replace function public.record_workflow_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_type text;
  event_comments text;
begin
  if tg_op = 'INSERT' then
    event_type := 'SUBMITTED';
    event_comments := coalesce(new.description, null);
    insert into public.workflow_audit_logs (
      submission_id, action_by, action_type, old_status, new_status, comments
    )
    values (new.id, auth.uid(), event_type, null, new.status, event_comments);
    return new;
  end if;

  if new.status is distinct from old.status then
    event_type := case
      when new.status = 'pending_admin' then 'APPROVER_APPROVED'
      when new.status = 'declined_by_approver' then 'APPROVER_REJECTED'
      when new.status = 'pending_office' then 'ADMIN_VERIFIED'
      when new.status = 'declined_by_admin' then 'ADMIN_REJECTED'
      when new.status = 'pending_mayor' and old.status = 'pending_office' then 'OFFICE_REVIEW_COMPLETED'
      when new.status = 'pending_mayor' then 'REQUIREMENTS_RESUBMITTED'
      when new.status = 'declined_by_office' then 'OFFICE_REJECTED'
      when new.status = 'returned_for_requirements' then 'RETURNED_FOR_REQUIREMENTS'
      when new.status = 'declined_by_mayor' then 'MAYOR_REJECTED'
      when new.status = 'completed' and old.status = 'pending_mayor' then 'MAYOR_APPROVED'
      when new.status = 'completed' then 'WORKFLOW_COMPLETED'
      else 'STATUS_CHANGED'
    end;
    event_comments := case new.status
      when 'pending_mayor' then coalesce(new.sender_response, new.office_comments)
      when 'returned_for_requirements' then new.mayor_comments
      when 'completed' then new.mayor_comments
      when 'declined_by_mayor' then new.mayor_comments
      when 'declined_by_office' then new.office_comments
      when 'declined_by_admin' then new.admin_comments
      when 'declined_by_approver' then new.approver_comments
      when 'pending_office' then new.admin_comments
      else coalesce(
        new.sender_response,
        new.mayor_comments,
        new.office_comments,
        new.admin_comments,
        new.approver_comments,
        new.rejection_comment
      )
    end;

    insert into public.workflow_audit_logs (
      submission_id, action_by, action_type, old_status, new_status, comments
    )
    values (
      new.id, auth.uid(), event_type, old.status, new.status,
      case
        when event_type = 'ADMIN_VERIFIED'
          then 'Routing verified for ' || coalesce(new.selected_office_role, 'unassigned office')
        else event_comments
      end
    );
  end if;
  return new;
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
    when 'SUBMITTED' then 'Document submitted'
    when 'APPROVER_APPROVED' then 'Approver review completed'
    when 'APPROVER_REJECTED' then 'Request returned by approver'
    when 'ADMIN_VERIFIED' then 'Administrative review completed'
    when 'ADMIN_REJECTED' then 'Request rejected during administrative review'
    when 'OFFICE_REVIEW_COMPLETED' then 'Municipal office review completed'
    when 'OFFICE_REJECTED' then 'Request rejected by municipal office'
    when 'RETURNED_FOR_REQUIREMENTS' then 'Additional requirements requested'
    when 'REQUIREMENTS_RESUBMITTED' then 'Additional requirements submitted'
    when 'MAYOR_APPROVED' then 'Final decision: approved'
    when 'MAYOR_REJECTED' then 'Final decision: rejected'
    when 'WORKFLOW_COMPLETED' then 'Request completed'
    when 'FINAL_APPROVAL' then 'Document approved'
    when 'FINAL_REJECTION' then 'Document rejected'
    when 'VERIFICATION_PASSED' then 'Verification completed'
    when 'RETURNED_FOR_CORRECTION' then 'Document returned for correction'
    else 'Workflow status updated'
  end;
  notification_message := coalesce(submission.tracking_number, 'Pending tracking number')
    || ' — ' || submission.file_name;
  if new.action_type in ('APPROVER_APPROVED', 'ADMIN_VERIFIED', 'OFFICE_REVIEW_COMPLETED') then
    notification_message := notification_message || E'\nResponsible office: '
      || case submission.selected_office_role
        when 'municipal_treasurer' then 'Municipal Treasurer''s Office'
        when 'mayor_office' then 'Mayor''s Office'
        when 'sangguniang_bayan' then 'Sangguniang Bayan Office'
        else 'Unassigned'
      end;
  end if;
  if new.comments is not null and length(btrim(new.comments)) > 0 then
    notification_message := notification_message || E'\n' || new.comments;
  end if;

  if new.action_type in (
    'SUBMITTED',
    'APPROVER_APPROVED',
    'APPROVER_REJECTED',
    'ADMIN_VERIFIED',
    'ADMIN_REJECTED',
    'OFFICE_REVIEW_COMPLETED',
    'OFFICE_REJECTED',
    'RETURNED_FOR_REQUIREMENTS',
    'REQUIREMENTS_RESUBMITTED',
    'MAYOR_APPROVED',
    'MAYOR_REJECTED',
    'WORKFLOW_COMPLETED',
    'FINAL_APPROVAL',
    'FINAL_REJECTION',
    'VERIFICATION_PASSED',
    'RETURNED_FOR_CORRECTION'
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

  if new.action_type in ('APPROVER_APPROVED', 'APPROVER_REJECTED', 'OFFICE_REVIEW_COMPLETED')
    or new.action_type = 'REQUIREMENTS_RESUBMITTED' then
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

  if new.action_type in ('ADMIN_VERIFIED', 'REQUIREMENTS_RESUBMITTED') then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select profile.id, new.submission_id, new.action_type,
      notification_title, notification_message
    from public.profiles profile
    where profile.role = submission.selected_office_role
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
  end if;

  if new.action_type = 'OFFICE_REVIEW_COMPLETED' then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select profile.id, new.submission_id, new.action_type,
      notification_title, notification_message
    from public.profiles profile
    where profile.role = 'mayor_office'
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
  end if;

  return new;
end;
$$;
