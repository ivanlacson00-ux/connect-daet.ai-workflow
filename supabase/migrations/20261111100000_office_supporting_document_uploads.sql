create or replace function public.prevent_mto_submission_forwarding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.initial_destination_role = 'municipal_treasurer'
    and old.selected_office_role = 'municipal_treasurer'
    and new.status = 'pending_approver' then
    raise exception 'Municipal Treasurer submissions must be processed by the Municipal Treasurer''s Office';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_mto_submission_forwarding
  on public.workflow_submissions;
create trigger prevent_mto_submission_forwarding
before update of status on public.workflow_submissions
for each row
execute function public.prevent_mto_submission_forwarding();
revoke all on function public.prevent_mto_submission_forwarding() from public;

drop policy if exists "Participants can view supporting document uploaders"
  on public.profiles;
create policy "Participants can view supporting document uploaders"
  on public.profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workflow_submission_attachments attachment
      join public.workflow_submissions submission
        on submission.id = attachment.submission_id
      where attachment.uploaded_by = profiles.id
        and (
          submission.user_id = auth.uid()
          or public.is_workflow_staff()
          or submission.selected_office_role = public.current_profile_role()
          or (
            public.current_profile_role() = 'mayor_office'
            and submission.status = 'pending_mayor'
          )
          or public.is_submission_assigned_to_current_office(submission.id)
        )
    )
  );

create or replace function public.add_workflow_office_supporting_document(
  target_submission_id uuid,
  document_name text,
  document_path text,
  document_type text,
  document_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.current_profile_role();
  submission public.workflow_submissions;
  attachment_id uuid;
  now_at timestamptz := timezone('utc', now());
begin
  if auth.uid() is null or actor_role not in (
    'municipal_treasurer', 'sangguniang_bayan', 'mayor_office'
  ) or not exists (
    select 1
    from auth.users account
    where account.id = auth.uid()
      and account.banned_until is null
  ) then
    raise exception 'An active municipal office member is required to upload a supporting document';
  end if;
  if coalesce(length(btrim(document_name)), 0) = 0
    or coalesce(length(btrim(document_path)), 0) = 0
    or document_path not like (auth.uid()::text || '/%')
    or document_size is null
    or document_size <= 0 then
    raise exception 'Invalid supporting document metadata';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission not found';
  end if;

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
    or (
      submission.status = 'pending_mayor'
      and actor_role = 'mayor_office'
    )
  ) then
    raise exception 'Your office is not currently authorized to add documents to this submission';
  end if;

  insert into public.workflow_submission_attachments (
    submission_id, file_name, file_path, file_type, file_size, uploaded_by, created_at
  )
  values (
    target_submission_id,
    btrim(document_name),
    document_path,
    document_type,
    document_size,
    auth.uid(),
    now_at
  )
  returning id into attachment_id;

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id,
    auth.uid(),
    'OFFICE_SUPPORTING_DOCUMENT_UPLOADED',
    submission.status,
    submission.status,
    btrim(document_name),
    now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  values (
    submission.user_id,
    target_submission_id,
    'OFFICE_SUPPORTING_DOCUMENT_UPLOADED',
    'Office uploaded a supporting document',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || btrim(document_name)
  )
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;

  return attachment_id;
end;
$$;

revoke all on function public.add_workflow_office_supporting_document(uuid, text, text, text, bigint)
  from public;
grant execute on function public.add_workflow_office_supporting_document(uuid, text, text, text, bigint)
  to authenticated;
