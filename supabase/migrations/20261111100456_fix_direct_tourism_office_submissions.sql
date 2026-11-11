drop trigger if exists require_manual_tourism_office_decision_insert
  on public.workflow_submissions;

-- Repair rows that the obsolete insert trigger left waiting for Tourism review.
alter table public.workflow_submissions
  disable trigger record_workflow_audit_event;

select set_config('app.workflow_authorized_transition', 'on', true);

update public.workflow_submissions as submission
set selected_office_role = submission.initial_destination_role,
    status = 'submitted',
    updated_at = timezone('utc', now())
where submission.status = 'pending_approver'
  and submission.selected_office_role is null
  and submission.initial_destination_role = 'tourism_officer'
  and not exists (
    select 1
    from public.workflow_routing_plans plan
    where plan.submission_id = submission.id
      and plan.is_current
  );

alter table public.workflow_submissions
  enable trigger record_workflow_audit_event;
