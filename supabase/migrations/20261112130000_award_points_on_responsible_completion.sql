create table public.workflow_submission_reward_ledger (
  submission_id uuid primary key
    references public.workflow_submissions(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  points integer not null default 10 check (points = 10),
  responsible_office_role text not null check (
    responsible_office_role in (
      'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
    )
  ),
  completed_by uuid references public.profiles(id) on delete set null,
  awarded_at timestamptz not null default timezone('utc', now())
);

create index workflow_submission_reward_ledger_user_id_idx
  on public.workflow_submission_reward_ledger (user_id);

alter table public.workflow_submission_reward_ledger enable row level security;
revoke all on public.workflow_submission_reward_ledger from anon, authenticated;
grant select on public.workflow_submission_reward_ledger to authenticated;

create policy "Submitters can view their reward history"
  on public.workflow_submission_reward_ledger
  for select to authenticated
  using (user_id = auth.uid());

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

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission not found';
  end if;
  if submission.status not in ('in_process', 'changes_requested')
    or submission.selected_office_role is distinct from actor_role then
    raise exception 'Only the responsible office can complete a submission in process or awaiting changes';
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
