-- Record submission creation and every status transition in one audit stream.
create table if not exists public.workflow_audit_logs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.workflow_submissions(id) on delete cascade,
  action_by uuid references public.profiles(id) on delete set null,
  action_type text not null,
  old_status text,
  new_status text,
  comments text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists workflow_audit_logs_submission_id_created_at_idx
  on public.workflow_audit_logs (submission_id, created_at desc);

create or replace function public.record_workflow_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_type text;
  event_comments text;
begin
  if tg_op = 'INSERT' then
    event_type := 'SUBMITTED';
    event_comments := coalesce(new.description, null);

    insert into public.workflow_audit_logs (
      submission_id,
      action_by,
      action_type,
      old_status,
      new_status,
      comments
    )
    values (
      new.id,
      auth.uid(),
      event_type,
      null,
      new.status,
      event_comments
    );

    return new;
  end if;

  if new.status is distinct from old.status then
    event_type := case new.status
      when 'pending_admin' then 'VERIFICATION_PASSED'
      when 'declined_by_approver' then 'RETURNED_FOR_CORRECTION'
      when 'approved' then 'FINAL_APPROVAL'
      when 'declined_by_admin' then 'FINAL_REJECTION'
      when 'completed' then 'WORKFLOW_COMPLETED'
      else 'STATUS_CHANGED'
    end;

    event_comments := coalesce(new.admin_comments, new.approver_comments, new.rejection_comment, null);

    insert into public.workflow_audit_logs (
      submission_id,
      action_by,
      action_type,
      old_status,
      new_status,
      comments
    )
    values (
      new.id,
      auth.uid(),
      event_type,
      old.status,
      new.status,
      event_comments
    );
  end if;

  return new;
end;
$$;

drop trigger if exists record_workflow_audit_event
  on public.workflow_submissions;

create trigger record_workflow_audit_event
after insert or update of status on public.workflow_submissions
for each row
execute function public.record_workflow_audit_event();
