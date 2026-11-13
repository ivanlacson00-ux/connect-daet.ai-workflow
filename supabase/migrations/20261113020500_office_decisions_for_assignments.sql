drop function if exists public.workflow_can_make_final_decision(uuid);
drop function if exists public.decide_workflow_submission_with_authority(uuid, text, text);

create function public.decide_workflow_submission_as_responsible_office(
  target_submission_id uuid,
  final_decision text,
  decision_comments text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  now_at timestamptz := timezone('utc', now());
  normalized_comments text := nullif(btrim(decision_comments), '');
  next_status text;
begin
  if actor_role not in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then
    raise exception 'An active municipal office member is required to make the final decision';
  end if;
  if final_decision is null or final_decision not in ('approve', 'reject') then
    raise exception 'Choose approve or reject';
  end if;
  if final_decision = 'reject' and normalized_comments is null then
    raise exception 'Explain the reason for rejecting this submission';
  end if;
  if normalized_comments is not null and char_length(normalized_comments) > 5000 then
    raise exception 'Decision details must be no more than 5,000 characters';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission not found';
  end if;
  if submission.status <> 'in_process'
    or submission.selected_office_role is distinct from actor_role
    or coalesce(submission.final_decision_office_role, submission.initial_destination_role)
      is distinct from actor_role then
    raise exception 'Only the responsible office can make the final decision while a submission is in process';
  end if;
  if public.workflow_mvp_has_pending_assignment(target_submission_id) then
    raise exception 'Pending office assignments must be finished before the responsible office makes the final decision';
  end if;

  next_status := case final_decision
    when 'approve' then 'approved'
    else 'declined_by_office'
  end;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = next_status,
      final_decision_by = auth.uid(),
      final_decided_at = now_at,
      approved_at = case when final_decision = 'approve' then now_at else approved_at end,
      rejected_at = case when final_decision = 'reject' then now_at else rejected_at end,
      rejection_comment = case when final_decision = 'reject' then normalized_comments else null end,
      office_comments = normalized_comments,
      closure_note = normalized_comments,
      closed_by = auth.uid(),
      completed_at = case when final_decision = 'approve' then now_at else completed_at end,
      current_stage_started_at = null,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  if final_decision = 'approve' then
    insert into public.workflow_submission_reward_ledger (
      submission_id, user_id, points, responsible_office_role, completed_by, awarded_at
    )
    select target_submission_id, submission.user_id, 10, actor_role, auth.uid(), now_at
    where submission.selected_office_role = actor_role
    on conflict (submission_id) do nothing;
  end if;

  perform public.workflow_mvp_record_history(
    target_submission_id,
    case when final_decision = 'approve' then 'SUBMISSION_APPROVED' else 'SUBMISSION_REJECTED' end,
    submission.status,
    next_status,
    normalized_comments,
    now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  values (
    submission.user_id,
    target_submission_id,
    case when final_decision = 'approve' then 'SUBMISSION_APPROVED' else 'SUBMISSION_REJECTED' end,
    case when final_decision = 'approve' then 'Your submission has been approved' else 'Your submission has been rejected' end,
    coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
  )
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;

revoke all on function public.decide_workflow_submission_as_responsible_office(uuid, text, text)
  from public, anon;
grant execute on function public.decide_workflow_submission_as_responsible_office(uuid, text, text)
  to authenticated;
