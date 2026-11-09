create or replace function public.is_submission_assigned_to_current_office(
  target_submission_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_role() in (
    'municipal_treasurer',
    'sangguniang_bayan',
    'mayor_office'
  )
  and exists (
    select 1
    from public.workflow_routing_plans plan
    join public.workflow_routing_steps step
      on step.routing_plan_id = plan.id
    where plan.submission_id = target_submission_id
      and plan.status in ('finalized', 'superseded')
      and step.office_role = public.current_profile_role()
      and step.status <> 'skipped'
  )
$$;

revoke all on function public.is_submission_assigned_to_current_office(uuid)
  from public;
grant execute on function public.is_submission_assigned_to_current_office(uuid)
  to authenticated;

drop policy if exists "Users and authorized workflow staff can view profiles"
  on public.profiles;
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
          or public.is_submission_assigned_to_current_office(submission.id)
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
    or public.is_submission_assigned_to_current_office(id)
  );

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
          or public.is_submission_assigned_to_current_office(submission.id)
        )
    )
  );

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
          or submission.selected_office_role = public.current_profile_role()
          or (
            public.current_profile_role() = 'mayor_office'
            and submission.status = 'pending_mayor'
          )
          or public.is_submission_assigned_to_current_office(submission.id)
        )
    )
  );

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
        or public.is_submission_assigned_to_current_office(submission.id)
      )
  )
$$;

drop policy if exists "Workflow users can read uploaded files"
  on storage.objects;
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
