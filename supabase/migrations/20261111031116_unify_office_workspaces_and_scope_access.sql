create or replace function public.is_workflow_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_role() = 'system_admin'
$$;

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
    'tourism_officer',
    'municipal_treasurer',
    'mayor_office',
    'sangguniang_bayan'
  )
  and exists (
    select 1
    from public.workflow_submissions submission
    where submission.id = target_submission_id
      and (
        submission.selected_office_role = public.current_profile_role()
        or submission.initial_destination_role = public.current_profile_role()
        or exists (
          select 1
          from public.workflow_routing_plans plan
          join public.workflow_routing_steps step
            on step.routing_plan_id = plan.id
          where plan.submission_id = submission.id
            and plan.status in ('finalized', 'superseded')
            and step.office_role = public.current_profile_role()
            and step.status <> 'skipped'
        )
      )
  )
$$;

revoke all on function public.is_submission_assigned_to_current_office(uuid)
  from public, anon;
grant execute on function public.is_submission_assigned_to_current_office(uuid)
  to authenticated;

alter table public.workflow_submissions
  drop constraint if exists workflow_submissions_selected_office_role_check;
alter table public.workflow_submissions
  add constraint workflow_submissions_selected_office_role_check
  check (
    selected_office_role is null
    or selected_office_role in (
      'tourism_officer',
      'municipal_treasurer',
      'mayor_office',
      'sangguniang_bayan'
    )
  );

alter table public.workflow_routing_steps
  drop constraint if exists workflow_routing_steps_office_role_check;
alter table public.workflow_routing_steps
  add constraint workflow_routing_steps_office_role_check
  check (
    office_role in (
      'tourism_officer',
      'municipal_treasurer',
      'mayor_office',
      'sangguniang_bayan'
    )
  );

drop policy if exists "Users can view their own profile" on public.profiles;
drop policy if exists "Users and workflow staff can view profiles" on public.profiles;
drop policy if exists "Users and authorized staff can view profiles" on public.profiles;
drop policy if exists "Users and authorized workflow staff can view profiles" on public.profiles;
create policy "Users and authorized workflow staff can view profiles"
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.is_workflow_admin()
    or exists (
      select 1
      from public.workflow_submissions submission
      where submission.user_id = profiles.id
        and public.is_submission_assigned_to_current_office(submission.id)
    )
  );

drop policy if exists "Users and staff can view authorized submissions"
  on public.workflow_submissions;
drop policy if exists "Participants and admins can view submissions"
  on public.workflow_submissions;
create policy "Users and staff can view authorized submissions"
  on public.workflow_submissions
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_workflow_admin()
    or public.is_submission_assigned_to_current_office(id)
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
    or public.is_submission_assigned_to_current_office(id)
  )
  with check (
    user_id = auth.uid()
    or public.is_workflow_admin()
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
          or public.is_workflow_admin()
          or public.is_submission_assigned_to_current_office(submission.id)
        )
    )
  );

drop policy if exists "Authorized users can view submission versions"
  on public.workflow_submission_versions;
create policy "Authorized users can view submission versions"
  on public.workflow_submission_versions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workflow_submissions submission
      where submission.id = workflow_submission_versions.submission_id
        and (
          submission.user_id = auth.uid()
          or public.is_workflow_admin()
          or public.is_submission_assigned_to_current_office(submission.id)
        )
    )
  );

drop policy if exists "Users and staff can view authorized audit logs"
  on public.workflow_audit_logs;
drop policy if exists "Users and workflow staff can view authorized audit logs"
  on public.workflow_audit_logs;
drop policy if exists "Participants can view audit logs"
  on public.workflow_audit_logs;
create policy "Users and staff can view authorized audit logs"
  on public.workflow_audit_logs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workflow_submissions submission
      where submission.id = workflow_audit_logs.submission_id
        and (
          submission.user_id = auth.uid()
          or public.is_workflow_admin()
          or public.is_submission_assigned_to_current_office(submission.id)
        )
    )
  );

create or replace function public.can_view_workflow_routing_plan(target_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_routing_plans plan
    join public.workflow_submissions submission
      on submission.id = plan.submission_id
    where plan.id = target_plan_id
      and (
        submission.user_id = auth.uid()
        or public.is_workflow_admin()
        or public.is_submission_assigned_to_current_office(submission.id)
      )
  )
$$;

revoke all on function public.can_view_workflow_routing_plan(uuid)
  from public, anon;
grant execute on function public.can_view_workflow_routing_plan(uuid)
  to authenticated;

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
      or exists (
        select 1
        from public.workflow_submission_versions version
        where version.submission_id = submission.id
          and version.file_path = object_name
      )
    )
      and (
        submission.user_id = auth.uid()
        or public.is_workflow_admin()
        or public.is_submission_assigned_to_current_office(submission.id)
      )
  )
$$;

drop policy if exists "Workflow users can read uploaded files" on storage.objects;
create policy "Workflow users can read uploaded files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'workflow_uploads'
    and (
      name like (auth.uid()::text || '/%')
      or public.is_workflow_admin()
      or public.is_workflow_file_accessible(name)
    )
  );

create or replace function public.can_access_workflow_messaging(target_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_submissions submission
    where submission.id = target_submission_id
      and (
        submission.user_id = auth.uid()
        or public.is_workflow_admin()
        or public.is_submission_assigned_to_current_office(submission.id)
      )
  )
$$;

revoke all on function public.can_access_workflow_messaging(uuid)
  from public, anon;
grant execute on function public.can_access_workflow_messaging(uuid)
  to authenticated;

do $$
declare
  source text;
  original_source text;
  start_position integer;
  end_position integer;
  case_start integer;
  case_end integer;
  old_roles_pattern text := $pattern$target_office_role not in[[:space:]]*\([[:space:]]*'municipal_treasurer'[[:space:]]*,[[:space:]]*'mayor_office'[[:space:]]*,[[:space:]]*'sangguniang_bayan'[[:space:]]*\)$pattern$;
  new_roles text := $roles$target_office_role not in ('tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan')$roles$;
  new_actor_check text := $new$
  if actor_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'Your role cannot forward a submission to an office';
  end if;

  if not (
    (
      submission.status = 'pending_office'
      and (
        submission.selected_office_role = actor_role
        or exists (
          select 1
          from public.workflow_routing_plans plan
          join public.workflow_routing_steps step on step.routing_plan_id = plan.id
          where plan.submission_id = target_submission_id
            and plan.is_current
            and plan.status = 'finalized'
            and step.office_role = actor_role
            and step.status = 'in_progress'
        )
      )
    )
    or (
      actor_role = 'tourism_officer'
      and submission.status in ('pending', 'pending_approver')
      and submission.initial_destination_role = actor_role
    )
    or (
      submission.status = 'pending_mayor'
      and actor_role = 'mayor_office'
      and (
        submission.selected_office_role = actor_role
        or exists (
          select 1
          from public.workflow_routing_plans plan
          join public.workflow_routing_steps step on step.routing_plan_id = plan.id
          where plan.submission_id = target_submission_id
            and plan.is_current
            and plan.status = 'finalized'
            and step.office_role = actor_role
            and step.status = 'in_progress'
        )
      )
    )
  ) then
    raise exception 'This submission is not assigned to your office for processing';
  end if;
$new$;
  new_final_role text := $new$
      final_decision_office_role = case
        when initial_destination_role = 'tourism_officer'
          and target_office_role <> 'tourism_officer' then target_office_role
        else coalesce(final_decision_office_role, initial_destination_role)
      end,
$new$;
begin
  select p.prosrc into source
  from pg_proc p
  where p.oid = 'public.forward_workflow_submission_to_office(uuid,text,uuid,text,jsonb)'::regprocedure;
  original_source := source;

  if position('target_office_role not in' in source) = 0 then
    raise exception 'Could not safely update office forwarding authorization';
  end if;

  source := regexp_replace(source, old_roles_pattern, new_roles, 'g');
  start_position := strpos(source, 'if actor_role = ''tourism_officer'' then');
  end_position := start_position - 1
    + strpos(substring(source from start_position), 'select * into current_plan');
  if start_position = 0 or end_position < start_position then
    raise exception 'Could not safely update office forwarding assignment checks';
  end if;
  source := left(source, start_position - 1)
    || new_actor_check || substring(source from end_position);

  case_start := strpos(source, 'final_decision_office_role = case');
  case_end := case_start - 1
    + strpos(substring(source from case_start), 'end,');
  if case_start = 0 or case_end < case_start then
    raise exception 'Could not safely update forwarded office decision routing';
  end if;
  source := left(source, case_start - 1)
    || new_final_role
    || substring(source from case_end + length('end,'));

  if source = original_source then
    raise exception 'Office forwarding authorization was not changed';
  end if;

  execute format(
    'create or replace function public.forward_workflow_submission_to_office(target_submission_id uuid, target_office_role text, message_id uuid, message_body text, attachment_records jsonb) returns void language plpgsql security definer set search_path = public as %L',
    source
  );
end;
$$;

do $$
declare
  source text;
begin
  execute $ddl$
    create or replace function public.request_workflow_submission_changes(
      target_submission_id uuid,
      request_comments text
    )
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $function$
    declare
      actor_role text := public.current_profile_role();
      submission public.workflow_submissions;
      active_step public.workflow_routing_steps;
      now_at timestamptz := timezone('utc', now());
    begin
      if auth.uid() is null or actor_role not in (
        'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
      ) or not exists (
        select 1
        from public.profiles profile
        join auth.users account on account.id = profile.id
        where profile.id = auth.uid()
          and profile.is_active
          and account.banned_until is null
      ) then
        raise exception 'An active office representative is required to request changes';
      end if;
      if coalesce(length(btrim(request_comments)), 0) = 0 then
        raise exception 'Explain the changes required before returning the submission';
      end if;

      select * into submission
      from public.workflow_submissions
      where id = target_submission_id
      for update;
      if not found or (
        submission.status <> 'pending_office'
        and not (
          actor_role = 'tourism_officer'
          and submission.status in ('pending', 'pending_approver')
          and submission.initial_destination_role = actor_role
        )
      ) then
        raise exception 'This submission is not awaiting office review';
      end if;

      select step.* into active_step
      from public.workflow_routing_plans plan
      join public.workflow_routing_steps step on step.routing_plan_id = plan.id
      where plan.submission_id = target_submission_id
        and plan.is_current
        and plan.status = 'finalized'
        and step.office_role = actor_role
        and step.status = 'in_progress'
      for update of step;

      if submission.selected_office_role is distinct from actor_role
        and active_step.id is null
        and not (
          actor_role = 'tourism_officer'
          and submission.status in ('pending', 'pending_approver')
          and submission.initial_destination_role = actor_role
        ) then
        raise exception 'Your office is not currently assigned to review this submission';
      end if;

      if active_step.id is not null then
        update public.workflow_routing_steps
        set requirements_requested_at = now_at,
            requirements_resubmitted_at = null,
            requirements_comments = btrim(request_comments)
        where id = active_step.id;
      end if;

      perform set_config('app.workflow_authorized_transition', 'on', true);
      update public.workflow_submissions
      set status = 'returned_for_requirements',
          selected_office_role = actor_role,
          office_comments = btrim(request_comments),
          updated_at = now_at
      where id = target_submission_id;
      perform set_config('app.workflow_authorized_transition', 'off', true);

      insert into public.workflow_audit_logs (
        submission_id, action_by, action_type, old_status, new_status, comments, created_at
      )
      values (
        target_submission_id,
        auth.uid(),
        'ROUTE_REQUIREMENTS_REQUESTED',
        submission.status,
        'returned_for_requirements',
        btrim(request_comments),
        now_at
      );
    end;
    $function$;
  $ddl$;
end;
$$;

do $$
declare
  source text;
  original_source text;
  roles_pattern text := $pattern$'municipal_treasurer'[[:space:]]*,[[:space:]]*'mayor_office'[[:space:]]*,[[:space:]]*'sangguniang_bayan'$pattern$;
  new_roles text := $roles$'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'$roles$;
begin
  select p.prosrc into source
  from pg_proc p
  where p.oid = 'public.complete_workflow_assignment(uuid,text)'::regprocedure;
  original_source := source;
  if position('municipal_treasurer' in source) = 0 then
    raise exception 'Could not safely update office assignment completion authorization';
  end if;
  source := regexp_replace(source, roles_pattern, new_roles, 'g');
  if source = original_source then
    raise exception 'Office assignment completion authorization was not changed';
  end if;
  execute format(
    'create or replace function public.complete_workflow_assignment(target_submission_id uuid, completion_notes text default null) returns void language plpgsql security definer set search_path = public as %L',
    source
  );
end;
$$;

do $$
declare
  source text;
  original_source text;
  start_position integer;
  end_position integer;
  new_role_check text := $new$
  if actor_role in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    if not (
      (
        submission.status in ('pending_office', 'pending_mayor')
        and submission.selected_office_role = actor_role
      )
      or (
        actor_role = 'tourism_officer'
        and submission.status in ('pending', 'pending_approver')
        and submission.initial_destination_role = actor_role
      )
    )
      or responsible_office_role is distinct from actor_role then
      raise exception 'Only the responsible office can close this submission';
    end if;
  elsif actor_role = 'system_admin' then
$new$;
begin
  select p.prosrc into source
  from pg_proc p
  where p.oid = 'public.close_workflow_submission(uuid)'::regprocedure;
  original_source := source;
  start_position := strpos(source, 'if actor_role in (');
  end_position := start_position - 1
    + strpos(
      substring(source from start_position),
      'elsif actor_role = ''system_admin'' then'
    );
  if start_position = 0 or end_position < start_position then
    raise exception 'Could not safely update office submission-closure authorization';
  end if;
  source := left(source, start_position - 1)
    || new_role_check || substring(source from end_position + length('elsif actor_role = ''system_admin'' then'));
  if source = original_source then
    raise exception 'Office submission-closure authorization was not changed';
  end if;
  execute format(
    'create or replace function public.close_workflow_submission(target_submission_id uuid) returns void language plpgsql security definer set search_path = public as %L',
    source
  );
end;
$$;

alter table public.workflow_document_retrievals
  drop constraint if exists workflow_document_retrievals_office_role_check;
alter table public.workflow_document_retrievals
  add constraint workflow_document_retrievals_office_role_check
  check (
    office_role in (
      'tourism_officer',
      'municipal_treasurer',
      'mayor_office',
      'sangguniang_bayan'
    )
  );

do $$
declare
  function_oid oid;
  original_source text;
  source text;
  function_definition text;
  source_position integer;
  office_roles_pattern text := $pattern$'municipal_treasurer'[[:space:]]*,[[:space:]]*'mayor_office'[[:space:]]*,[[:space:]]*'sangguniang_bayan'$pattern$;
  office_roles text := $roles$'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'$roles$;
begin
  for function_oid in
    select unnest(array[
      'public.get_workflow_retrieval_by_token(uuid)'::regprocedure,
      'public.update_workflow_document_location(uuid,text,text,text,text,text,text)'::regprocedure,
      'public.release_workflow_document(uuid,boolean)'::regprocedure,
      'public.respond_to_workflow_submission_changes(uuid,text,text,text,text,text,bigint)'::regprocedure
    ])::oid
  loop
    select p.prosrc into original_source
    from pg_proc p
    where p.oid = function_oid;
    source := regexp_replace(original_source, office_roles_pattern, office_roles, 'g');
    if source = original_source then
      raise exception 'Could not safely update office QR-retrieval role access';
    end if;

    select pg_get_functiondef(function_oid) into function_definition;
    source_position := strpos(function_definition, original_source);
    if source_position = 0 then
      raise exception 'Could not safely rebuild an office QR-retrieval function';
    end if;
    function_definition := overlay(
      function_definition
      placing source
      from source_position
      for char_length(original_source)
    );
    execute function_definition;
  end loop;
end;
$$;

do $$
declare
  function_oid oid := 'public.create_workflow_retrieval_qr(uuid)'::regprocedure;
  original_source text;
  source text;
  function_definition text;
  source_position integer;
  route_select_start integer;
  route_select_end integer;
  new_route_select text := $new$
  select coalesce(
    submission.final_decision_office_role,
    (
      select step.office_role
      from public.workflow_routing_plans plan
      join public.workflow_routing_steps step on step.routing_plan_id = plan.id
      where plan.submission_id = target_submission_id
        and plan.is_current
        and plan.status = 'finalized'
        and step.status in ('approved', 'completed')
        and not exists (
          select 1
          from public.workflow_routing_steps unfinished_step
          where unfinished_step.routing_plan_id = plan.id
            and unfinished_step.status not in ('approved', 'completed')
        )
      order by step.sequence_number desc
      limit 1
    ),
    submission.initial_destination_role
  )
  into target_office_role
  from public.workflow_submissions submission
  where submission.id = target_submission_id;

$new$;
begin
  select p.prosrc into original_source
  from pg_proc p
  where p.oid = function_oid;
  source := original_source;
  route_select_start := strpos(source, 'select step.office_role');
  route_select_end := route_select_start - 1
    + strpos(
      substring(source from route_select_start),
      'if target_office_role is null then'
    );
  if route_select_start = 0 or route_select_end < route_select_start then
    raise exception 'Could not safely update office QR assignment resolution';
  end if;

  source := left(source, route_select_start - 1)
    || new_route_select
    || substring(source from route_select_end);
  source := replace(
    source,
    'The request must complete its finalized municipal office route before a retrieval QR code can be issued',
    'The request must be completed by its responsible office before a retrieval QR code can be issued'
  );
  select pg_get_functiondef(function_oid) into function_definition;
  source_position := strpos(function_definition, original_source);
  if source_position = 0 then
    raise exception 'Could not safely rebuild office QR assignment resolution';
  end if;
  function_definition := overlay(
    function_definition
    placing source
    from source_position
    for char_length(original_source)
  );
  execute function_definition;
end;
$$;

notify pgrst, 'reload schema';
