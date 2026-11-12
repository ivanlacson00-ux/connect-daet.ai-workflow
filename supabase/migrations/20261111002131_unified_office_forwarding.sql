alter table public.workflow_routing_steps
  drop constraint if exists workflow_routing_steps_assignment_source_check;

alter table public.workflow_routing_steps
  add constraint workflow_routing_steps_assignment_source_check
  check (assignment_source in ('tourism_officer', 'office_forward', 'legacy'));

create or replace function public.forward_workflow_submission_to_office(
  target_submission_id uuid,
  target_office_role text,
  message_id uuid,
  message_body text,
  attachment_records jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.current_profile_role();
  submission public.workflow_submissions;
  current_plan public.workflow_routing_plans;
  current_step public.workflow_routing_steps;
  plan_id uuid;
  next_sequence integer;
  now_at timestamptz := timezone('utc', now());
  message text := nullif(btrim(message_body), '');
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles profile
    join auth.users account on account.id = profile.id
    where profile.id = auth.uid()
      and profile.is_active
      and account.banned_until is null
      and profile.role = actor_role
  ) then
    raise exception 'An active workflow officer is required to forward this submission';
  end if;

  if target_office_role not in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan')
    or target_office_role = actor_role then
    raise exception 'Choose a different municipal office to receive this submission';
  end if;
  if not exists (
    select 1
    from public.profiles profile
    join auth.users account on account.id = profile.id
    where profile.role = target_office_role
      and profile.is_active
      and account.banned_until is null
  ) then
    raise exception 'The selected office has no active representatives';
  end if;
  if message is null or char_length(message) > 5000 then
    raise exception 'Provide context of 1 to 5,000 characters for the receiving office';
  end if;
  if attachment_records is null
    or jsonb_typeof(attachment_records) is distinct from 'array'
    or jsonb_array_length(attachment_records) < 1
    or jsonb_array_length(attachment_records) > 5 then
    raise exception 'Attach at least one document, up to five files';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(attachment_records) as attachment(
      file_name text,
      file_path text,
      file_type text,
      file_size bigint
    )
    where nullif(btrim(attachment.file_name), '') is null
      or attachment.file_path is null
      or attachment.file_type is null
      or attachment.file_size is null
      or attachment.file_size < 1
      or attachment.file_size > 10485760
      or attachment.file_path not like (
        target_submission_id::text || '/' || auth.uid()::text || '/'
          || message_id::text || '/%'
      )
  ) then
    raise exception 'The forwarded document attachment is invalid';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission not found';
  end if;

  if actor_role = 'tourism_officer' then
    if submission.status not in ('pending', 'pending_approver') then
      raise exception 'The Tourism Officer can only forward a submission under Tourism Office review';
    end if;
  elsif actor_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then
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
      or (submission.status = 'pending_mayor' and actor_role = 'mayor_office')
    ) then
      raise exception 'This submission is not assigned to your office for processing';
    end if;
  else
    raise exception 'Your role cannot forward a submission to a municipal office';
  end if;

  select * into current_plan
  from public.workflow_routing_plans
  where submission_id = target_submission_id
    and is_current
    and status = 'finalized'
  for update;

  if found then
    plan_id := current_plan.id;
    if exists (
      select 1
      from public.workflow_routing_steps step
      where step.routing_plan_id = plan_id
        and step.office_role = target_office_role
    ) then
      raise exception 'This office already has an assignment on the current route';
    end if;

    select * into current_step
    from public.workflow_routing_steps step
    where step.routing_plan_id = plan_id
      and step.office_role = actor_role
      and step.status = 'in_progress'
    for update;

    if exists (
      select 1
      from public.workflow_routing_steps step
      where step.routing_plan_id = plan_id
        and step.status in ('pending', 'in_progress')
        and (current_step.id is null or step.id <> current_step.id)
    ) then
      raise exception 'Complete the other pending office assignments before forwarding this submission';
    end if;

    select coalesce(max(step.sequence_number), 0) + 1
    into next_sequence
    from public.workflow_routing_steps step
    where step.routing_plan_id = plan_id;

    if current_step.id is not null then
      update public.workflow_routing_steps
      set status = 'completed',
          completed_by = auth.uid(),
          completed_at = now_at,
          comments = 'Forwarded to ' || target_office_role || ' for Recommendation: ' || message
      where id = current_step.id;

      insert into public.workflow_audit_logs (
        submission_id, action_by, action_type, old_status, new_status, comments, created_at
      )
      values (
        target_submission_id,
        auth.uid(),
        'OFFICE_ASSIGNMENT_COMPLETED',
        submission.status,
        submission.status,
        current_step.office_role || ' — ' || current_step.responsibility
          || '; forwarded to ' || target_office_role,
        now_at
      );
    end if;
  else
    select coalesce(max(plan.version), 0) + 1
    into next_sequence
    from public.workflow_routing_plans plan
    where plan.submission_id = target_submission_id;

    insert into public.workflow_routing_plans (
      submission_id, version, status, is_current, created_by, finalized_by, finalized_at
    )
    values (
      target_submission_id, next_sequence, 'finalized', true, auth.uid(), auth.uid(), now_at
    )
    returning id into plan_id;

    next_sequence := 1;
  end if;

  insert into public.workflow_routing_steps (
    routing_plan_id,
    sequence_number,
    office_role,
    status,
    assigned_by,
    assigned_at,
    started_at,
    responsibility,
    assignment_source,
    comments
  )
  values (
    plan_id,
    next_sequence,
    target_office_role,
    'in_progress',
    auth.uid(),
    now_at,
    now_at,
    'recommendation',
    'office_forward',
    message
  );

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'pending_office',
      selected_office_role = target_office_role,
      final_decision_office_role = case
        when initial_destination_role = 'tourism_officer' then target_office_role
        else coalesce(final_decision_office_role, initial_destination_role)
      end,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id,
    auth.uid(),
    'OFFICE_ASSIGNMENT_FORWARDED',
    submission.status,
    'pending_office',
    target_office_role || ' — Recommendation: ' || message,
    now_at
  );

  insert into public.workflow_messages (id, submission_id, sender_id, body)
  values (message_id, target_submission_id, auth.uid(), message);

  insert into public.workflow_message_attachments (
    submission_id, message_id, uploaded_by, file_name, file_path, file_type, file_size
  )
  select
    target_submission_id,
    message_id,
    auth.uid(),
    attachment.file_name,
    attachment.file_path,
    attachment.file_type,
    attachment.file_size
  from jsonb_to_recordset(attachment_records) as attachment(
    file_name text,
    file_path text,
    file_type text,
    file_size bigint
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    target_submission_id,
    'OFFICE_ROUTE_STEP_ASSIGNED',
    'Document forwarded for Recommendation',
    coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.role = target_office_role
    and profile.is_active
    and account.banned_until is null
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;

revoke all on function public.forward_workflow_submission_to_office(uuid, text, uuid, text, jsonb)
  from public, anon;
grant execute on function public.forward_workflow_submission_to_office(uuid, text, uuid, text, jsonb)
  to authenticated;

revoke all on function public.create_tourism_officer_assignments(uuid, jsonb, text, text, text)
  from public, anon, authenticated;
revoke all on function public.propose_workflow_route(uuid, text[], text)
  from public, anon, authenticated;
