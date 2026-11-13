create or replace function public.workflow_mvp_has_pending_assignment(
  target_submission_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_routing_plans plan
    join public.workflow_routing_steps step on step.routing_plan_id = plan.id
    where plan.submission_id = target_submission_id
      and plan.is_current
      and plan.status = 'finalized'
      and step.status in ('pending', 'in_progress')
  )
$$;

create or replace function public.workflow_can_make_final_decision(
  target_submission_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
  submission public.workflow_submissions;
  authorized_role text;
begin
  if actor_role not in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then
    return false;
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id;
  if not found
    or submission.status <> 'in_process'
    or submission.selected_office_role is distinct from actor_role
    or coalesce(submission.final_decision_office_role, submission.initial_destination_role)
      is distinct from actor_role
    or public.workflow_mvp_has_pending_assignment(target_submission_id) then
    return false;
  end if;

  select authority.required_profile_role into authorized_role
  from public.workflow_final_decision_authorities authority
  where authority.office_role = coalesce(
      submission.final_decision_office_role,
      submission.initial_destination_role
    )
    and (authority.document_type = submission.category or authority.document_type is null)
  order by (authority.document_type is not null) desc
  limit 1;

  return authorized_role is not null and actor_role = authorized_role;
end;
$$;

create or replace function public.decide_workflow_submission_with_authority(
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
  authorized_role text;
  normalized_comments text := nullif(btrim(decision_comments), '');
  now_at timestamptz := timezone('utc', now());
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
    raise exception 'Only the selected final-decision office can decide a submission in process';
  end if;

  select authority.required_profile_role into authorized_role
  from public.workflow_final_decision_authorities authority
  where authority.office_role = coalesce(
      submission.final_decision_office_role,
      submission.initial_destination_role
    )
    and (authority.document_type = submission.category or authority.document_type is null)
  order by (authority.document_type is not null) desc
  limit 1;
  if authorized_role is null then
    raise exception 'Final decision authority is not configured for % and document type "%"',
      coalesce(submission.final_decision_office_role, submission.initial_destination_role),
      coalesce(submission.category, 'unknown');
  end if;
  if actor_role is distinct from authorized_role then
    raise exception 'Your office role is not authorized to make the final decision for this document type';
  end if;
  if public.workflow_mvp_has_pending_assignment(target_submission_id) then
    raise exception 'Pending office assignments must be finished before making the final decision';
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

revoke all on function public.workflow_can_make_final_decision(uuid) from public, anon;
revoke all on function public.decide_workflow_submission_with_authority(uuid, text, text)
  from public, anon;
grant execute on function public.workflow_can_make_final_decision(uuid) to authenticated;
grant execute on function public.decide_workflow_submission_with_authority(uuid, text, text)
  to authenticated;
