begin;

drop function if exists public.request_workflow_submission_changes(uuid, text);

create function public.request_workflow_submission_changes(
  target_submission_id uuid,
  request_comments text,
  expected_revision_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  now_at timestamptz := timezone('utc', now());
  reason text := nullif(btrim(request_comments), '');
  audit_event_id uuid;
begin
  if actor_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'An active responsible-office member is required to request changes';
  end if;
  if reason is null or char_length(reason) > 5000 then
    raise exception 'Provide a change request of 5,000 characters or fewer';
  end if;

  select *
    into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;

  if not found
    or submission.status <> 'in_process'
    or submission.selected_office_role is distinct from actor_role then
    raise exception 'Only the responsible office can request changes while in process';
  end if;
  if submission.reopen_count <> 0 then
    raise exception 'Changes can only be requested before the submission is reopened';
  end if;
  if submission.current_revision_id is null
    or expected_revision_id is distinct from submission.current_revision_id then
    raise exception 'The submission revision changed. Refresh and try again';
  end if;
  if public.workflow_mvp_has_pending_assignment(target_submission_id) then
    raise exception 'A Pending office assignment must be completed, returned, or withdrawn first';
  end if;
  if exists (
    select 1
    from public.workflow_change_requests request
    where request.submission_id = target_submission_id
  ) then
    raise exception 'This submission already has change-request history';
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  perform set_config('app.workflow_authorized_revision_transition', 'on', true);
  update public.workflow_submissions
  set status = 'changes_requested',
      office_comments = reason,
      closure_reason = 'changes_requested',
      closed_at = now_at,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_revision_transition', 'off', true);
  perform set_config('app.workflow_authorized_transition', 'off', true);

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments,
    created_at, revision_id
  )
  values (
    target_submission_id, auth.uid(), 'CHANGES_REQUESTED', 'in_process',
    'changes_requested', reason, now_at, submission.current_revision_id
  )
  returning id into audit_event_id;

  insert into public.workflow_change_requests (
    submission_id, requested_by_office, requested_by_user, message,
    against_revision_id, status, source_audit_event_id, backfill_quality,
    created_at, updated_at
  )
  values (
    target_submission_id, actor_role, auth.uid(), reason,
    submission.current_revision_id, 'open', audit_event_id, 'complete',
    now_at, now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  values (
    submission.user_id, target_submission_id, 'CHANGES_REQUESTED',
    'Changes requested for your submission',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name || ': ' || reason
  )
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;

revoke all on function public.request_workflow_submission_changes(uuid, text, uuid)
  from public, anon;
grant execute on function public.request_workflow_submission_changes(uuid, text, uuid)
  to authenticated;

drop function if exists public.respond_to_workflow_submission_changes(
  uuid, text, text, text, text, text, bigint
);

create or replace function public.workflow_mvp_close_submission_internal(
  target_submission_id uuid,
  closure_note text,
  closure_file_path text,
  closure_file_name text,
  closure_file_type text,
  closure_file_size bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
#variable_conflict use_variable
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  now_at timestamptz := timezone('utc', now());
  note text := nullif(btrim(closure_note), '');
  has_file boolean := closure_file_path is not null
    or closure_file_name is not null
    or closure_file_type is not null
    or closure_file_size is not null;
begin
  if actor_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'An active responsible-office representative is required to complete this submission';
  end if;
  if note is not null and char_length(note) > 5000 then
    raise exception 'Completion note must be no more than 5,000 characters';
  end if;
  if has_file and (
    closure_file_path is null
    or closure_file_path not like (auth.uid()::text || '/%')
    or nullif(btrim(closure_file_name), '') is null
    or nullif(btrim(closure_file_type), '') is null
    or closure_file_size is null
    or closure_file_size < 1
    or closure_file_size > 10485760
  ) then
    raise exception 'Provide complete metadata for the optional completion document';
  end if;

  select *
    into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission not found';
  end if;
  if submission.status <> 'in_process'
    or submission.selected_office_role is distinct from actor_role then
    raise exception 'Only the responsible office can complete a submission in process';
  end if;
  if public.workflow_mvp_has_pending_assignment(target_submission_id) then
    raise exception 'Pending office assignments must be finished before completing this submission';
  end if;

  if has_file then
    insert into public.workflow_submission_attachments (
      submission_id, file_name, file_path, file_type, file_size, uploaded_by, created_at
    )
    values (
      target_submission_id, closure_file_name, closure_file_path, closure_file_type,
      closure_file_size, auth.uid(), now_at
    );
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions as target
  set status = 'completed',
      closed_by = auth.uid(),
      closure_note = note,
      closure_file_path = workflow_mvp_close_submission_internal.closure_file_path,
      closure_file_name = workflow_mvp_close_submission_internal.closure_file_name,
      closure_file_type = workflow_mvp_close_submission_internal.closure_file_type,
      closure_file_size = workflow_mvp_close_submission_internal.closure_file_size,
      completed_at = now_at,
      updated_at = now_at
  where target.id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  insert into public.workflow_submission_reward_ledger (
    submission_id, user_id, points, responsible_office_role, completed_by, awarded_at
  )
  select target_submission_id, submission.user_id, 10, actor_role, auth.uid(), now_at
  where submission.selected_office_role = actor_role
  on conflict (submission_id) do nothing;

  perform public.workflow_mvp_record_history(
    target_submission_id, 'SUBMISSION_CLOSED', submission.status, 'completed',
    concat_ws(E'\n', note, case when has_file then 'Completion document: ' || closure_file_name end),
    now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  values (
    submission.user_id, target_submission_id, 'SUBMISSION_CLOSED',
    'Your submission has been completed',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name
  )
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$function$;

create or replace function public.withdraw_workflow_assignment(
  target_submission_id uuid,
  target_assignment_office_role text,
  withdrawal_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  pending_step public.workflow_routing_steps;
  now_at timestamptz := timezone('utc', now());
  reason text := nullif(btrim(withdrawal_reason), '');
begin
  if actor_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'An active responsible-office member is required to withdraw an assignment';
  end if;
  if reason is null then
    raise exception 'Provide a reason for withdrawing the assignment';
  end if;

  select *
    into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found or submission.selected_office_role is distinct from actor_role then
    raise exception 'Only the responsible office can withdraw an assignment';
  end if;
  if submission.status <> 'in_process' then
    raise exception 'This submission cannot withdraw an assignment in its current status';
  end if;
  if target_assignment_office_role is null
    or target_assignment_office_role = submission.selected_office_role then
    raise exception 'Select the forwarded office assignment to withdraw';
  end if;

  select step.*
    into pending_step
  from public.workflow_routing_plans plan
  join public.workflow_routing_steps step on step.routing_plan_id = plan.id
  where plan.submission_id = target_submission_id
    and plan.is_current
    and plan.status = 'finalized'
    and step.office_role = target_assignment_office_role
    and step.status in ('pending', 'in_progress')
  for update of step;
  if not found then
    raise exception 'That office has no Pending assignment to withdraw';
  end if;

  update public.workflow_routing_steps
  set status = 'withdrawn',
      decided_by = auth.uid(),
      decided_at = now_at,
      comments = reason
  where id = pending_step.id;

  perform public.workflow_mvp_record_history(
    target_submission_id, 'ASSIGNMENT_WITHDRAWN', submission.status, submission.status,
    public.workflow_office_label(actor_role) || ' withdrew the assignment with '
      || public.workflow_office_label(target_assignment_office_role), now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    target_submission_id,
    'ASSIGNMENT_WITHDRAWN:' || pending_step.id::text,
    public.workflow_office_label(actor_role) || ' withdrew your assignment',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name || E'\n' || reason
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.role = target_assignment_office_role
    and profile.is_active
    and (account.banned_until is null or account.banned_until <= now_at)
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$function$;

create or replace function public.can_write_workflow_message_conversation(
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
    where submission.id = target_submission_id
      and public.can_access_workflow_message_conversation(
        submission.id,
        target_routing_step_id
      )
      and (
        submission.status not in ('changes_requested', 'returned_for_requirements')
        or (
          submission.user_id = auth.uid()
          and target_routing_step_id is null
        )
      )
  )
$$;

revoke all on function public.can_write_workflow_message_conversation(uuid, uuid)
  from public, anon;
grant execute on function public.can_write_workflow_message_conversation(uuid, uuid)
  to authenticated;

drop policy if exists "Participants can send document messages"
  on public.workflow_messages;
create policy "Participants can send document messages"
  on public.workflow_messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.can_write_workflow_message_conversation(submission_id, routing_step_id)
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
        and public.can_write_workflow_message_conversation(
          message.submission_id,
          message.routing_step_id
        )
    )
    and exists (
      select 1
      from public.workflow_messages message
      where message.id = message_id
        and message.submission_id = workflow_message_attachments.submission_id
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
        and public.can_write_workflow_message_conversation(
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
          and public.can_write_workflow_message_conversation(submission.id, null)
        )
        or exists (
          select 1
          from public.workflow_routing_steps step
          where step.id::text = split_part(object_name, '/', 3)
            and cardinality(string_to_array(object_name, '/')) = 5
            and public.can_write_workflow_message_conversation(submission.id, step.id)
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
              and public.can_write_workflow_message_conversation(
                eligible_submission.id,
                null
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

commit;
