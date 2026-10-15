-- Replace broad/testing policies with role-aware policies enforced by Supabase.
create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
$$;

create or replace function public.is_workflow_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_role() in ('approver', 'admin')
$$;

create or replace function public.is_workflow_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_role() = 'admin'
$$;

drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Users can view their own profile" on public.profiles;

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_workflow_admin());

create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid() or public.is_workflow_admin())
  with check (
    public.is_workflow_admin()
    or (
      id = auth.uid()
      and role = public.current_profile_role()
    )
  );

drop policy if exists "Allow all inserts for testing" on public.workflow_submissions;
drop policy if exists "Approvers and admins can update submissions" on public.workflow_submissions;
drop policy if exists "Approvers and admins can view all submissions" on public.workflow_submissions;
drop policy if exists "Users can insert their own submissions" on public.workflow_submissions;
drop policy if exists "Users can view their own submissions" on public.workflow_submissions;

alter table public.workflow_submissions enable row level security;

create policy "Users and staff can view authorized submissions"
  on public.workflow_submissions
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_workflow_staff());

create policy "Users can insert their own submissions"
  on public.workflow_submissions
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users and staff can update authorized submissions"
  on public.workflow_submissions
  for update
  to authenticated
  using (user_id = auth.uid() or public.is_workflow_staff())
  with check (user_id = auth.uid() or public.is_workflow_staff());

drop policy if exists "Admins can view all audit logs" on public.workflow_audit_logs;
drop policy if exists "Anyone can insert audit logs" on public.workflow_audit_logs;
drop policy if exists "Users can view audit logs for their submissions" on public.workflow_audit_logs;

alter table public.workflow_audit_logs enable row level security;

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
        and submission.user_id = auth.uid()
    )
  );
