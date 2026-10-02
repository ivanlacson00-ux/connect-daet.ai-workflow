-- Track who owns each verification assignment and preserve reassignment history.
create table if not exists public.workflow_assignments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.workflow_submissions(id) on delete cascade,
  approver_id uuid not null references public.profiles(id) on delete restrict,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'reassigned', 'completed')),
  assigned_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz
);

create unique index if not exists workflow_assignments_one_active_per_submission_idx
  on public.workflow_assignments (submission_id)
  where status = 'active';

create index if not exists workflow_assignments_approver_status_idx
  on public.workflow_assignments (approver_id, status);

drop policy if exists "Users can view their own profile" on public.profiles;

create policy "Users and workflow staff can view profiles"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_workflow_staff());

create or replace function public.is_submission_assigned_to_current_user(target_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_assignments
    where submission_id = target_submission_id
      and approver_id = auth.uid()
      and status = 'active'
  )
$$;

create or replace function public.is_submission_owned_by_current_user(target_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_submissions
    where id = target_submission_id
      and user_id = auth.uid()
  )
$$;

create or replace function public.assign_workflow_submission(
  target_submission_id uuid,
  target_approver_id uuid
)
returns public.workflow_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  target_role text;
  previous_assignment public.workflow_assignments;
  new_assignment public.workflow_assignments;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();

  if actor_role <> 'admin' then
    raise exception 'Only an administrator can assign workflow submissions';
  end if;

  select role into target_role
  from public.profiles
  where id = target_approver_id;

  if target_role <> 'approver' then
    raise exception 'Assignments must target an approver profile';
  end if;

  if not exists (
    select 1
    from public.workflow_submissions
    where id = target_submission_id
  ) then
    raise exception 'Workflow submission does not exist';
  end if;

  select *
    into previous_assignment
  from public.workflow_assignments
  where submission_id = target_submission_id
    and status = 'active'
  for update;

  if previous_assignment.approver_id = target_approver_id then
    return previous_assignment;
  end if;

  if previous_assignment.id is not null then
    update public.workflow_assignments
    set status = 'reassigned',
        ended_at = timezone('utc', now())
    where id = previous_assignment.id;
  end if;

  insert into public.workflow_assignments (
    submission_id,
    approver_id,
    assigned_by
  )
  values (
    target_submission_id,
    target_approver_id,
    auth.uid()
  )
  returning * into new_assignment;

  insert into public.workflow_audit_logs (
    submission_id,
    action_by,
    action_type,
    comments
  )
  values (
    target_submission_id,
    auth.uid(),
    case when previous_assignment.id is null then 'ASSIGNED' else 'REASSIGNED' end,
    'Assigned to approver profile ' || target_approver_id::text
  );

  insert into public.workflow_notifications (
    recipient_id,
    submission_id,
    event_type,
    title,
    message
  )
  select
    target_approver_id,
    submission.id,
    case when previous_assignment.id is null then 'ASSIGNED' else 'REASSIGNED' end,
    case when previous_assignment.id is null
      then 'Document assigned for verification'
      else 'Document assignment changed'
    end,
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name
  from public.workflow_submissions submission
  where submission.id = target_submission_id
  on conflict (recipient_id, submission_id, event_type, title, message)
  do nothing;

  return new_assignment;
end;
$$;

grant execute on function public.assign_workflow_submission(uuid, uuid) to authenticated;

alter table public.workflow_assignments enable row level security;

drop policy if exists "Authorized users can view workflow assignments"
  on public.workflow_assignments;

create policy "Authorized users can view workflow assignments"
  on public.workflow_assignments
  for select
  to authenticated
  using (
    public.is_workflow_admin()
    or approver_id = auth.uid()
    or public.is_submission_owned_by_current_user(workflow_assignments.submission_id)
  );

drop policy if exists "Admins can manage workflow assignments"
  on public.workflow_assignments;

create policy "Admins can manage workflow assignments"
  on public.workflow_assignments
  for all
  to authenticated
  using (public.is_workflow_admin())
  with check (public.is_workflow_admin());

drop policy if exists "Users and staff can view authorized submissions"
  on public.workflow_submissions;

create policy "Users and staff can view authorized submissions"
  on public.workflow_submissions
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_workflow_admin()
    or public.is_submission_assigned_to_current_user(workflow_submissions.id)
  );

drop policy if exists "Users and staff can update authorized submissions"
  on public.workflow_submissions;

create policy "Users and staff can update authorized submissions"
  on public.workflow_submissions
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_workflow_admin()
    or public.is_submission_assigned_to_current_user(workflow_submissions.id)
  )
  with check (
    user_id = auth.uid()
    or public.is_workflow_admin()
    or public.is_submission_assigned_to_current_user(workflow_submissions.id)
  );

-- Require an active assignment when an approver changes verification status.
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
      if actor_role <> 'approver'
        or not public.is_submission_assigned_to_current_user(old.id) then
        raise exception 'Only the assigned approver can complete or decline verification';
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
