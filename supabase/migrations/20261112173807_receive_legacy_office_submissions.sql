create or replace function public.receive_workflow_submission(target_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  now_at timestamptz := timezone('utc', now());
begin
  if actor_role not in (
    'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'An active office representative is required to receive this submission';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found or submission.selected_office_role is distinct from actor_role then
    raise exception 'Only the responsible office can receive this submission';
  end if;
  if submission.status = 'in_process' then
    return;
  end if;
  if submission.status not in ('submitted', 'pending_office') then
    raise exception 'This submission is not waiting to be received';
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'in_process',
      received_by = auth.uid(),
      received_at = now_at,
      office_reviewed_at = now_at,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  perform public.workflow_mvp_record_history(
    target_submission_id, 'SUBMISSION_RECEIVED', submission.status, 'in_process',
    'Processing started by ' || actor_role, now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  values (
    submission.user_id, target_submission_id, 'SUBMISSION_RECEIVED',
    'Your submission is in process',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name
  )
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;

revoke all on function public.receive_workflow_submission(uuid) from public, anon;
grant execute on function public.receive_workflow_submission(uuid) to authenticated;
