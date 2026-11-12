alter table public.workflow_routing_steps
  add column if not exists assigned_by_role text;

update public.workflow_routing_steps step
set assigned_by_role = profile.role
from public.profiles profile
where profile.id = step.assigned_by
  and step.assigned_by_role is null;

create or replace function public.set_workflow_routing_step_assigner_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_by is null then
    new.assigned_by_role := null;
  else
    select profile.role
      into new.assigned_by_role
    from public.profiles profile
    where profile.id = new.assigned_by;
  end if;
  return new;
end;
$$;

revoke all on function public.set_workflow_routing_step_assigner_role()
  from public, anon, authenticated;

drop trigger if exists set_workflow_routing_step_assigner_role
  on public.workflow_routing_steps;
create trigger set_workflow_routing_step_assigner_role
before insert or update of assigned_by on public.workflow_routing_steps
for each row
execute function public.set_workflow_routing_step_assigner_role();

alter table public.workflow_messages
  add column if not exists routing_step_id uuid
    references public.workflow_routing_steps(id) on delete cascade;

with candidates as (
  select
    message.id as message_id,
    step.id as routing_step_id,
    row_number() over (
      partition by message.id
      order by step.assigned_at desc nulls last, step.id
    ) as message_rank,
    row_number() over (
      partition by step.id
      order by message.created_at desc, message.id
    ) as step_rank
  from public.workflow_messages message
  join public.workflow_submissions submission
    on submission.id = message.submission_id
  join public.workflow_routing_plans plan
    on plan.submission_id = submission.id
   and plan.status in ('finalized', 'superseded')
  join public.workflow_routing_steps step
    on step.routing_plan_id = plan.id
   and step.assignment_source = 'office_forward'
   and step.assigned_by = message.sender_id
  where message.routing_step_id is null
    and message.created_at = coalesce(step.assigned_at, step.created_at)
),
matched_messages as (
  select message_id, routing_step_id
  from candidates
  where message_rank = 1 and step_rank = 1
)
update public.workflow_messages message
set routing_step_id = matched_messages.routing_step_id
from matched_messages
where message.id = matched_messages.message_id;

update public.workflow_routing_steps
set comments = null
where assignment_source = 'office_forward'
  and comments is not null;

update public.workflow_audit_logs
set comments = 'Forwarded for an office recommendation'
where action_type = 'SUBMISSION_FORWARDED'
  and comments is not null;

create index if not exists workflow_messages_assignment_thread_idx
  on public.workflow_messages (submission_id, routing_step_id, created_at desc);

-- Null scope is the submitter thread; a routing step scopes an office pair.
create or replace function public.can_access_workflow_message_conversation(
  target_submission_id uuid,
  target_routing_step_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_submissions submission
    join public.profiles actor on actor.id = auth.uid()
    join auth.users account on account.id = actor.id
    where submission.id = target_submission_id
      and actor.is_active
      and (account.banned_until is null or account.banned_until <= timezone('utc', now()))
      and (
        (
          target_routing_step_id is null
          and (
            submission.user_id = auth.uid()
            or actor.role = submission.selected_office_role
          )
        )
        or (
          target_routing_step_id is not null
          and exists (
            select 1
            from public.workflow_routing_plans plan
            join public.workflow_routing_steps step
              on step.routing_plan_id = plan.id
            where plan.submission_id = submission.id
              and plan.status in ('finalized', 'superseded')
              and step.id = target_routing_step_id
              and step.assignment_source in ('office_forward', 'tourism_officer')
              and actor.role in (step.office_role, step.assigned_by_role)
          )
        )
      )
  )
$$;

revoke all on function public.can_access_workflow_message_conversation(uuid, uuid)
  from public, anon;
grant execute on function public.can_access_workflow_message_conversation(uuid, uuid)
  to authenticated;

grant insert (routing_step_id)
  on public.workflow_messages to authenticated;

drop policy if exists "Participants can view document messages"
  on public.workflow_messages;
create policy "Participants can view document messages"
  on public.workflow_messages
  for select
  to authenticated
  using (
    public.can_access_workflow_message_conversation(submission_id, routing_step_id)
  );

drop policy if exists "Participants can send document messages"
  on public.workflow_messages;
create policy "Participants can send document messages"
  on public.workflow_messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.can_access_workflow_message_conversation(submission_id, routing_step_id)
  );

drop policy if exists "Participants can view message attachments"
  on public.workflow_message_attachments;
create policy "Participants can view message attachments"
  on public.workflow_message_attachments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workflow_messages message
      where message.id = workflow_message_attachments.message_id
        and message.submission_id = workflow_message_attachments.submission_id
        and public.can_access_workflow_message_conversation(
          message.submission_id,
          message.routing_step_id
        )
    )
  );

drop policy if exists "Message senders can add attachments"
  on public.workflow_message_attachments;
create policy "Message senders can add attachments"
  on public.workflow_message_attachments
  for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1
      from public.workflow_messages message
      where message.id = message_id
        and message.submission_id = workflow_message_attachments.submission_id
        and message.sender_id = auth.uid()
        and public.can_access_workflow_message_conversation(
          message.submission_id,
          message.routing_step_id
        )
        and (
          (
            message.routing_step_id is null
            and file_path like (
              submission_id::text || '/' || auth.uid()::text || '/'
                || message_id::text || '/%'
            )
          )
          or (
            message.routing_step_id is not null
            and file_path like (
              submission_id::text || '/' || auth.uid()::text || '/'
                || message.routing_step_id::text || '/' || message_id::text || '/%'
            )
          )
        )
    )
  );

drop policy if exists "Participants can view message read receipts"
  on public.workflow_message_reads;
create policy "Participants can view message read receipts"
  on public.workflow_message_reads
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workflow_messages message
      where message.id = workflow_message_reads.message_id
        and message.submission_id = workflow_message_reads.submission_id
        and public.can_access_workflow_message_conversation(
          message.submission_id,
          message.routing_step_id
        )
    )
  );

drop policy if exists "Participants can mark messages as read"
  on public.workflow_message_reads;
create policy "Participants can mark messages as read"
  on public.workflow_message_reads
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.workflow_messages message
      where message.id = workflow_message_reads.message_id
        and message.submission_id = workflow_message_reads.submission_id
        and message.sender_id <> auth.uid()
        and public.can_access_workflow_message_conversation(
          message.submission_id,
          message.routing_step_id
        )
    )
  );

create or replace function public.can_upload_workflow_message_file(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_submissions submission
    where submission.id::text = split_part(object_name, '/', 1)
      and split_part(object_name, '/', 2) = auth.uid()::text
      and (
        (
          cardinality(string_to_array(object_name, '/')) = 4
          and public.can_access_workflow_message_conversation(submission.id, null)
        )
        or exists (
          select 1
          from public.workflow_routing_steps step
          where step.id::text = split_part(object_name, '/', 3)
            and cardinality(string_to_array(object_name, '/')) = 5
            and public.can_access_workflow_message_conversation(submission.id, step.id)
        )
        or (
          cardinality(string_to_array(object_name, '/')) = 5
          and not exists (
            select 1
            from public.workflow_routing_steps step
            where step.id::text = split_part(object_name, '/', 3)
          )
          and exists (
            select 1
            from public.workflow_submissions eligible_submission
            join public.profiles actor on actor.id = auth.uid()
            join auth.users account on account.id = actor.id
            where eligible_submission.id = submission.id
              and eligible_submission.status = 'in_process'
              and actor.is_active
              and (account.banned_until is null or account.banned_until <= timezone('utc', now()))
              and actor.role in (
                'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
              )
              and (
                eligible_submission.selected_office_role = actor.role
                or exists (
                  select 1
                  from public.workflow_routing_plans plan
                  join public.workflow_routing_steps assigned_step
                    on assigned_step.routing_plan_id = plan.id
                  where plan.submission_id = eligible_submission.id
                    and plan.is_current
                    and plan.status = 'finalized'
                    and assigned_step.office_role = actor.role
                    and assigned_step.status = 'in_progress'
                )
              )
          )
        )
      )
  )
$$;

revoke all on function public.can_upload_workflow_message_file(text)
  from public, anon;
grant execute on function public.can_upload_workflow_message_file(text)
  to authenticated;

create or replace function public.can_access_workflow_message_file(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_message_attachments attachment
    join public.workflow_messages message
      on message.id = attachment.message_id
     and message.submission_id = attachment.submission_id
    where attachment.file_path = object_name
      and public.can_access_workflow_message_conversation(
        message.submission_id,
        message.routing_step_id
      )
  )
$$;

revoke all on function public.can_access_workflow_message_file(text)
  from public, anon;
grant execute on function public.can_access_workflow_message_file(text)
  to authenticated;

drop policy if exists "Participants can upload message files" on storage.objects;
create policy "Participants can upload message files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'workflow_message_attachments'
    and public.can_upload_workflow_message_file(name)
  );

create or replace function public.notify_workflow_message_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.workflow_submissions;
  thread_step public.workflow_routing_steps;
begin
  select *
    into submission
  from public.workflow_submissions
  where id = new.submission_id;

  if new.routing_step_id is not null then
    select *
      into thread_step
    from public.workflow_routing_steps
    where id = new.routing_step_id;
  end if;

  insert into public.workflow_notifications (
    recipient_id,
    submission_id,
    event_type,
    title,
    message
  )
  select
    participant.id,
    new.submission_id,
    'DOCUMENT_MESSAGE:' || new.id::text,
    'New message on ' || coalesce(submission.tracking_number, 'document'),
    new.sender_name || ' sent a message about "' || submission.file_name
      || '". Sign in to Docuflow to view and reply.'
  from public.profiles participant
  join auth.users account on account.id = participant.id
  where participant.id <> new.sender_id
    and participant.is_active
    and (account.banned_until is null or account.banned_until <= timezone('utc', now()))
    and (
      new.routing_step_id is null
      or exists (
        select 1
        from public.workflow_messages earlier_message
        where earlier_message.routing_step_id = new.routing_step_id
          and earlier_message.id <> new.id
      )
    )
    and (
      (
        new.routing_step_id is null
        and (
          participant.id = submission.user_id
          or participant.role = submission.selected_office_role
        )
      )
      or (
        new.routing_step_id is not null
        and participant.role in (thread_step.office_role, thread_step.assigned_by_role)
      )
    )
  on conflict (recipient_id, submission_id, event_type, title, message)
  do nothing;

  return new;
end;
$$;

revoke all on function public.notify_workflow_message_participants()
  from public, anon, authenticated;

drop function if exists public.forward_workflow_submission_to_office(
  uuid, text, uuid, text, jsonb
);

create function public.forward_workflow_submission_to_office(
  target_submission_id uuid,
  target_office_role text,
  message_id uuid,
  target_assignment_id uuid,
  message_body text,
  attachment_records jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  current_plan public.workflow_routing_plans;
  current_step public.workflow_routing_steps;
  plan_id uuid;
  next_version integer;
  now_at timestamptz := timezone('utc', now());
  request_context text := nullif(btrim(message_body), '');
  attachment_count integer;
begin
  if actor_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'An active office representative is required to forward this submission';
  end if;
  if target_office_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) or target_office_role = actor_role then
    raise exception 'Choose a different active office to receive this submission';
  end if;
  if message_id is null or target_assignment_id is null
    or target_assignment_id = message_id then
    raise exception 'Message and assignment identifiers are required';
  end if;
  if request_context is not null and char_length(request_context) > 5000 then
    raise exception 'Forwarding context must be 5,000 characters or fewer';
  end if;
  if attachment_records is null
    or jsonb_typeof(attachment_records) is distinct from 'array'
    or jsonb_array_length(attachment_records) < 1
    or jsonb_array_length(attachment_records) > 5 then
    raise exception 'Attach the current document, with up to four additional files';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found or submission.status <> 'in_process' then
    raise exception 'Only an office processing this submission can forward it';
  end if;
  if target_office_role = submission.selected_office_role then
    raise exception 'The target office must differ from the responsible office';
  end if;

  select * into current_plan
  from public.workflow_routing_plans
  where submission_id = target_submission_id
    and is_current
    and status = 'finalized'
  for update;

  if found then
    select step.* into current_step
    from public.workflow_routing_steps step
    where step.routing_plan_id = current_plan.id
      and step.office_role = actor_role
      and step.status in ('pending', 'in_progress')
    for update;

    if current_step.id is null
      and submission.selected_office_role is distinct from actor_role then
      raise exception 'Your office does not have an active assignment to forward';
    end if;

    if exists (
      select 1
      from public.workflow_routing_plans plan
      join public.workflow_routing_steps step on step.routing_plan_id = plan.id
      where plan.submission_id = target_submission_id
        and step.status in ('pending', 'in_progress')
        and (current_step.id is null or step.id <> current_step.id)
    ) then
      raise exception 'Complete or return other pending office assignments before forwarding';
    end if;
  elsif submission.selected_office_role is distinct from actor_role then
    raise exception 'Only the responsible office can create a new office assignment';
  elsif public.workflow_mvp_has_pending_assignment(target_submission_id) then
    raise exception 'Complete or return the pending office assignment before forwarding';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    join auth.users account on account.id = profile.id
    where profile.role = target_office_role
      and profile.is_active
      and (account.banned_until is null or account.banned_until <= now_at)
  ) then
    raise exception 'The selected office has no active representatives';
  end if;

  select count(*) into attachment_count
  from jsonb_to_recordset(attachment_records) as attachment(
    file_name text, file_path text, file_type text, file_size bigint
  )
  where nullif(btrim(attachment.file_name), '') is not null
    and attachment.file_type is not null
    and attachment.file_size > 0
    and attachment.file_size <= 10485760
    and attachment.file_path like (
      target_submission_id::text || '/' || auth.uid()::text || '/'
        || target_assignment_id::text || '/' || message_id::text || '/%'
    );
  if attachment_count <> jsonb_array_length(attachment_records) then
    raise exception 'A forwarded document attachment is invalid';
  end if;
  if not exists (
    select 1
    from jsonb_to_recordset(attachment_records) as attachment(
      file_name text, file_path text, file_type text, file_size bigint
    )
    where attachment.file_name = submission.file_name
      and attachment.file_type = submission.file_type
      and attachment.file_size = submission.file_size
  ) then
    raise exception 'Attach the submission’s current document version';
  end if;

  if current_plan.id is not null then
    if current_step.id is not null then
      update public.workflow_routing_steps
      set status = 'completed',
          started_at = coalesce(current_step.started_at, now_at),
          completed_by = auth.uid(),
          completed_at = now_at,
          comments = 'Forwarded to ' || target_office_role
      where id = current_step.id;
    end if;

    update public.workflow_routing_plans
    set status = 'superseded',
        is_current = false,
        finalized_by = null,
        finalized_at = null
    where id = current_plan.id;
  end if;

  select coalesce(max(plan.version), 0) + 1
  into next_version
  from public.workflow_routing_plans plan
  where plan.submission_id = target_submission_id;

  insert into public.workflow_routing_plans (
    submission_id, version, status, is_current, created_by, finalized_by, finalized_at
  )
  values (
    target_submission_id, next_version, 'finalized', true, auth.uid(), auth.uid(), now_at
  )
  returning id into plan_id;

  insert into public.workflow_routing_steps (
    id, routing_plan_id, sequence_number, office_role, status, assigned_by,
    assigned_by_role, assigned_at, started_at, responsibility, assignment_source, comments
  )
  values (
    target_assignment_id, plan_id, 1, target_office_role, 'in_progress', auth.uid(),
    actor_role, now_at, now_at, 'recommendation', 'office_forward', null
  );

  insert into public.workflow_messages (
    id, submission_id, sender_id, body, routing_step_id
  )
  values (
    message_id,
    target_submission_id,
    auth.uid(),
    coalesce(request_context, 'Office assignment created.'),
    target_assignment_id
  );

  insert into public.workflow_message_attachments (
    submission_id, message_id, uploaded_by, file_name, file_path, file_type, file_size
  )
  select
    target_submission_id, message_id, auth.uid(),
    attachment.file_name, attachment.file_path, attachment.file_type, attachment.file_size
  from jsonb_to_recordset(attachment_records) as attachment(
    file_name text, file_path text, file_type text, file_size bigint
  );

  perform public.workflow_mvp_record_history(
    target_submission_id,
    'SUBMISSION_FORWARDED',
    submission.status,
    submission.status,
    target_office_role || ' — Recommendation',
    now_at
  );

  if actor_role is distinct from submission.selected_office_role then
    perform public.workflow_mvp_record_history(
      target_submission_id,
      'OFFICE_ASSIGNMENT_FORWARDED_ONWARD',
      submission.status,
      submission.status,
      actor_role || ' forwarded the assignment to ' || target_office_role,
      now_at
    );

    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select
      profile.id,
      target_submission_id,
      'OFFICE_ASSIGNMENT_FORWARDED_ONWARD',
      'An office forwarded its assignment onward',
      coalesce(submission.tracking_number, 'Pending tracking number')
        || ' — ' || submission.file_name
    from public.profiles profile
    join auth.users account on account.id = profile.id
    where profile.role = submission.selected_office_role
      and profile.is_active
      and (account.banned_until is null or account.banned_until <= now_at)
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
  end if;

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    target_submission_id,
    'OFFICE_ASSIGNMENT_FORWARDED',
    'Document forwarded for Recommendation',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.role = target_office_role
    and profile.is_active
    and (account.banned_until is null or account.banned_until <= now_at)
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;

revoke all on function public.forward_workflow_submission_to_office(
  uuid, text, uuid, uuid, text, jsonb
) from public, anon;
grant execute on function public.forward_workflow_submission_to_office(
  uuid, text, uuid, uuid, text, jsonb
) to authenticated;

create or replace function public.receive_workflow_assignment(target_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  assignment_step public.workflow_routing_steps;
begin
  select step.* into assignment_step
  from public.workflow_routing_plans plan
  join public.workflow_routing_steps step on step.routing_plan_id = plan.id
  join public.workflow_submissions submission on submission.id = plan.submission_id
  where plan.submission_id = target_submission_id
    and plan.is_current
    and plan.status = 'finalized'
    and submission.status = 'in_process'
    and step.office_role = actor_role
    and step.status in ('pending', 'in_progress')
  for update of step;

  if not found then
    raise exception 'Your office has no pending assignment for this submission';
  end if;

  if assignment_step.status = 'pending' then
    update public.workflow_routing_steps
    set status = 'in_progress',
        started_at = timezone('utc', now())
    where id = assignment_step.id;
  end if;
end;
$$;

revoke all on function public.receive_workflow_assignment(uuid) from public, anon;
grant execute on function public.receive_workflow_assignment(uuid) to authenticated;
