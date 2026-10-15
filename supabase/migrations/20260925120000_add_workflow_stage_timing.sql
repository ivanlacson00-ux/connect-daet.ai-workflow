-- Keep stage timestamps and the active role deadline on each submission.
alter table public.workflow_submissions
  add column if not exists submitted_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists current_stage_started_at timestamptz,
  add column if not exists current_stage_due_at timestamptz,
  add column if not exists current_responsible_role text;

create or replace function public.workflow_stage_deadline(
  stage_status text,
  stage_started_at timestamptz
)
returns timestamptz
language sql
immutable
as $$
  select case stage_status
    when 'pending' then stage_started_at + interval '2 days'
    when 'pending_approver' then stage_started_at + interval '2 days'
    when 'pending_admin' then stage_started_at + interval '2 days'
    when 'approved' then stage_started_at + interval '1 day'
    else null
  end
$$;

create or replace function public.sync_workflow_stage_timing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_time timestamptz := coalesce(new.updated_at, timezone('utc', now()));
begin
  if tg_op = 'INSERT' then
    new.submitted_at := coalesce(new.submitted_at, new.created_at, event_time);
    new.current_stage_started_at := coalesce(new.current_stage_started_at, new.submitted_at);
  elsif new.status is distinct from old.status then
    if new.status in ('pending', 'pending_approver') then
      new.current_stage_started_at := event_time;
    elsif new.status = 'pending_admin' then
      new.verified_at := coalesce(new.verified_at, event_time);
      new.current_stage_started_at := event_time;
    elsif new.status = 'approved' then
      new.approved_at := coalesce(new.approved_at, event_time);
      new.current_stage_started_at := event_time;
    elsif new.status = 'completed' then
      new.completed_at := coalesce(new.completed_at, event_time);
      new.current_stage_started_at := null;
    end if;
  end if;

  new.current_stage_due_at := public.workflow_stage_deadline(
    new.status,
    new.current_stage_started_at
  );
  new.current_responsible_role := case
    when new.status in ('pending', 'pending_approver') then 'approver'
    when new.status in ('pending_admin', 'approved') then 'admin'
    else null
  end;

  return new;
end;
$$;

drop trigger if exists sync_workflow_stage_timing
  on public.workflow_submissions;

create trigger sync_workflow_stage_timing
before insert or update of status, updated_at
on public.workflow_submissions
for each row
execute function public.sync_workflow_stage_timing();

-- Backfill existing records from the authoritative audit history.
update public.workflow_submissions as submission
set submitted_at = coalesce(
      submission.submitted_at,
      (
        select min(log.created_at)
        from public.workflow_audit_logs as log
        where log.submission_id = submission.id
          and log.action_type = 'SUBMITTED'
      ),
      submission.created_at
    ),
    verified_at = coalesce(
      submission.verified_at,
      (
        select min(log.created_at)
        from public.workflow_audit_logs as log
        where log.submission_id = submission.id
          and log.action_type = 'VERIFICATION_PASSED'
      )
    ),
    approved_at = coalesce(
      submission.approved_at,
      (
        select min(log.created_at)
        from public.workflow_audit_logs as log
        where log.submission_id = submission.id
          and log.action_type = 'FINAL_APPROVAL'
      )
    ),
    completed_at = coalesce(
      submission.completed_at,
      (
        select min(log.created_at)
        from public.workflow_audit_logs as log
        where log.submission_id = submission.id
          and log.action_type = 'WORKFLOW_COMPLETED'
      )
    ),
    current_stage_started_at = case
      when submission.status in ('pending', 'pending_approver') then coalesce(
        submission.submitted_at,
        (
          select min(log.created_at)
          from public.workflow_audit_logs as log
          where log.submission_id = submission.id
            and log.action_type = 'SUBMITTED'
        ),
        submission.created_at
      )
      when submission.status = 'pending_admin' then coalesce(
        submission.verified_at,
        (
          select min(log.created_at)
          from public.workflow_audit_logs as log
          where log.submission_id = submission.id
            and log.action_type = 'VERIFICATION_PASSED'
        ),
        submission.submitted_at,
        submission.created_at
      )
      when submission.status = 'approved' then coalesce(
        submission.approved_at,
        (
          select min(log.created_at)
          from public.workflow_audit_logs as log
          where log.submission_id = submission.id
            and log.action_type = 'FINAL_APPROVAL'
        ),
        submission.updated_at
      )
      else null
    end,
    current_responsible_role = case
      when submission.status in ('pending', 'pending_approver') then 'approver'
      when submission.status in ('pending_admin', 'approved') then 'admin'
      else null
    end;

update public.workflow_submissions
set current_stage_due_at = public.workflow_stage_deadline(
  status,
  current_stage_started_at
);
