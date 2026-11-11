-- Audit fixes (2026-11-11). Apply after 20261111130000_allow_tourism_municipal_approval_routing.sql.
-- Every statement is idempotent and no existing rows are deleted.
--
-- 1. Fix runtime SQL errors in Tourism Office routing RPCs.
-- 2. Close direct PostgREST write paths that bypassed the workflow RPCs
--    (workflow_submissions, profiles, workflow_notifications, workflow_tracking_sequences).
-- 3. Seed default final-decision authority for each municipal office (office decides its own requests).
-- 4. Allow retrieval QR codes for requests completed directly by a municipal office.
-- 5. Remove duplicate / unnecessary notifications; fix e-mail links for renamed roles;
--    stop e-mailing deactivated (removed) accounts.

-- 1a. assignment.ordinality referenced the wrong alias (runtime error 42703).
CREATE OR REPLACE FUNCTION public.route_tourism_submission_to_municipal_offices(target_submission_id uuid, assignment_records jsonb, routing_mode text, assignment_comments text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor_role text := public.current_profile_role();
  submission public.workflow_submissions;
  plan_id uuid;
  now_at timestamptz := timezone('utc', now());
  assignment_count integer;
  first_office_role text;
begin
  if auth.uid() is null
    or actor_role is distinct from 'tourism_officer'
    or not exists (
      select 1 from auth.users account
      where account.id = auth.uid() and account.banned_until is null
    ) then
    raise exception 'An active Tourism Officer is required to route this submission';
  end if;
  if routing_mode is null or routing_mode not in ('sequential', 'simultaneous') then
    raise exception 'Choose sequential or simultaneous municipal office routing';
  end if;
  if assignment_records is null
    or jsonb_typeof(assignment_records) is distinct from 'array' then
    raise exception 'Select at least one municipal office for approval';
  end if;
  if jsonb_array_length(assignment_records) = 0 then
    raise exception 'Select at least one municipal office for approval';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found
    or submission.status is distinct from 'pending_approver'
    or submission.initial_destination_role is distinct from 'tourism_officer'
    or submission.selected_office_role is not null then
    raise exception 'This submission is not awaiting a Tourism Officer decision';
  end if;
  if exists (
    select 1
    from public.workflow_routing_plans plan
    where plan.submission_id = target_submission_id
      and plan.is_current
  ) then
    raise exception 'This Tourism submission already has a municipal review route';
  end if;

  select count(*) into assignment_count
  from jsonb_to_recordset(assignment_records) as assignment(
    office_role text,
    responsibility text
  );
  if assignment_count <> jsonb_array_length(assignment_records)
    or exists (
      select 1
      from jsonb_to_recordset(assignment_records) as assignment(
        office_role text,
        responsibility text
      )
      where assignment.office_role is null
        or assignment.office_role not in (
          'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
        )
        or assignment.responsibility is null
        or assignment.responsibility not in (
          'mandatory_approval_clearance',
          'evaluation_verification',
          'recommendation'
        )
    )
    or assignment_count <> (
      select count(distinct assignment.office_role)
      from jsonb_to_recordset(assignment_records) as assignment(
        office_role text,
        responsibility text
      )
    ) then
    raise exception 'Choose unique municipal offices and valid review responsibilities';
  end if;

  perform set_config('app.tourism_office_routing', 'on', true);
  insert into public.workflow_routing_plans (
    submission_id, version, status, is_current, created_by, finalized_by, finalized_at
  )
  values (
    target_submission_id,
    coalesce((
      select max(plan.version) + 1
      from public.workflow_routing_plans plan
      where plan.submission_id = target_submission_id
    ), 1),
    'finalized',
    true,
    auth.uid(),
    auth.uid(),
    now_at
  )
  returning id into plan_id;
  perform set_config('app.tourism_office_routing', 'off', true);

  insert into public.workflow_routing_steps (
    routing_plan_id,
    sequence_number,
    office_role,
    status,
    assigned_by,
    assigned_at,
    started_at,
    responsibility,
    assignment_source
  )
  select
    plan_id,
    case when routing_mode = 'simultaneous' then 1 else assignment_record.ordinality::integer end,
    assignment.office_role,
    case
      when routing_mode = 'simultaneous' or assignment_record.ordinality = 1 then 'in_progress'
      else 'pending'
    end,
    case
      when routing_mode = 'simultaneous' or assignment_record.ordinality = 1 then auth.uid()
      else null
    end,
    case
      when routing_mode = 'simultaneous' or assignment_record.ordinality = 1 then now_at
      else null
    end,
    case
      when routing_mode = 'simultaneous' or assignment_record.ordinality = 1 then now_at
      else null
    end,
    assignment.responsibility,
    'tourism_officer'
  from jsonb_array_elements(assignment_records) with ordinality
    as assignment_record(value, ordinality)
  cross join lateral jsonb_to_record(assignment_record.value) as assignment(
    office_role text,
    responsibility text
  )
  order by assignment_record.ordinality;

  select step.office_role into first_office_role
  from public.workflow_routing_steps step
  where step.routing_plan_id = plan_id
    and step.status = 'in_progress'
  order by step.sequence_number, step.office_role
  limit 1;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'pending_office',
      selected_office_role = first_office_role,
      final_decision_office_role = null,
      approver_comments = nullif(btrim(assignment_comments), ''),
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  select
    target_submission_id,
    auth.uid(),
    'TOURISM_OFFICE_ROUTE_STEP_ASSIGNED',
    'pending_approver',
    'pending_office',
    assignment.office_role || ' — ' || assignment.responsibility,
    now_at
  from jsonb_to_recordset(assignment_records) as assignment(
    office_role text,
    responsibility text
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    target_submission_id,
    'TOURISM_OFFICE_ROUTE_STEP_ASSIGNED',
    'Municipal approval requested',
    coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
  from public.workflow_routing_steps step
  join public.profiles profile on profile.role = step.office_role
  where step.routing_plan_id = plan_id
    and step.status = 'in_progress'
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  values (
    submission.user_id,
    target_submission_id,
    'TOURISM_OFFICER_ASSIGNMENTS_CREATED',
    'Municipal reviews requested',
    coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
  )
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;

  return plan_id;
end;
$function$;

-- 1b. WITH ORDINALITY cannot be combined with a column definition list (runtime error 42601).
CREATE OR REPLACE FUNCTION public.create_tourism_officer_assignments(target_submission_id uuid, assignment_records jsonb, routing_mode text, assignment_comments text DEFAULT NULL::text, final_decision_office_role text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  submission public.workflow_submissions;
  plan_id uuid;
  next_version integer;
  now_at timestamptz := timezone('utc', now());
  assignment_count integer;
  decision_office_role text;
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'tourism_officer' then
    raise exception 'Only the Tourism Officer can create additional office assignments';
  end if;
  if routing_mode is null or routing_mode not in ('sequential', 'simultaneous') then
    raise exception 'Choose sequential or simultaneous office routing';
  end if;
  if assignment_records is null
    or jsonb_typeof(assignment_records) is distinct from 'array' then
    raise exception 'Office assignments must be provided as a list';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found
    or submission.status <> 'pending_approver'
    or submission.initial_destination_role is null then
    raise exception 'The Tourism Officer can only assign offices after receiving a reviewed submission';
  end if;
  if jsonb_array_length(assignment_records) = 0
    and submission.initial_destination_role <> 'tourism_officer' then
    raise exception 'Select at least one additional office assignment';
  end if;
  if submission.initial_destination_role = 'tourism_officer' then
    if final_decision_office_role is null or final_decision_office_role not in (
      'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
    ) then
      raise exception 'Select the municipal office that will make the final decision';
    end if;
    decision_office_role := final_decision_office_role;
  else
    if final_decision_office_role is not null
      and final_decision_office_role is distinct from submission.initial_destination_role then
      raise exception 'The submitter-selected municipal office retains final decision authority';
    end if;
    decision_office_role := submission.initial_destination_role;
  end if;

  select count(*) into assignment_count
  from jsonb_to_recordset(assignment_records) as assignment(
    office_role text,
    responsibility text
  );
  if assignment_count <> jsonb_array_length(assignment_records) then
    raise exception 'Each additional assignment must include an office and responsibility';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(assignment_records) as assignment(
      office_role text,
      responsibility text
    )
    where assignment.office_role not in (
      'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
    )
      or (
        submission.initial_destination_role <> 'tourism_officer'
        and assignment.office_role = submission.initial_destination_role
      )
      or assignment.responsibility not in (
        'mandatory_approval_clearance',
        'evaluation_verification',
        'recommendation'
      )
  ) then
    raise exception 'Assignments must use a supported additional office and responsibility';
  end if;
  if assignment_count <> (
    select count(distinct assignment.office_role)
    from jsonb_to_recordset(assignment_records) as assignment(
      office_role text,
      responsibility text
    )
  ) then
    raise exception 'An office can only appear once in the additional assignments';
  end if;

  update public.workflow_routing_plans
  set status = 'superseded', is_current = false
  where submission_id = target_submission_id
    and is_current;

  select coalesce(max(version), 0) + 1 into next_version
  from public.workflow_routing_plans
  where submission_id = target_submission_id;

  insert into public.workflow_routing_plans (
    submission_id, version, status, is_current, created_by, finalized_by, finalized_at
  )
  values (
    target_submission_id, next_version, 'finalized', true, auth.uid(), auth.uid(), now_at
  )
  returning id into plan_id;

  insert into public.workflow_routing_steps (
    routing_plan_id,
    sequence_number,
    office_role,
    status,
    assigned_by,
    assigned_at,
    started_at,
    responsibility,
    assignment_source
  )
  select
    plan_id,
    case when routing_mode = 'simultaneous' then 1 else assignment.ordinality::integer end,
    assignment.office_role,
    case
      when routing_mode = 'simultaneous' or assignment.ordinality = 1 then 'in_progress'
      else 'pending'
    end,
    case
      when routing_mode = 'simultaneous' or assignment.ordinality = 1 then auth.uid()
      else null
    end,
    case
      when routing_mode = 'simultaneous' or assignment.ordinality = 1 then now_at
      else null
    end,
    case
      when routing_mode = 'simultaneous' or assignment.ordinality = 1 then now_at
      else null
    end,
    assignment.responsibility,
    'tourism_officer'
  from rows from (
    jsonb_to_recordset(assignment_records) as (office_role text, responsibility text)
  ) with ordinality as assignment(office_role, responsibility, ordinality)
  order by assignment.ordinality;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'pending_office',
      selected_office_role = decision_office_role,
      final_decision_office_role = decision_office_role,
      approver_comments = nullif(btrim(assignment_comments), ''),
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id,
    auth.uid(),
    'TOURISM_OFFICER_ASSIGNMENTS_CREATED',
    'pending_approver',
    'pending_office',
    routing_mode || ': ' || coalesce(nullif(btrim(assignment_comments), ''), 'Additional offices assigned'),
    now_at
  );

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  select
    target_submission_id,
    auth.uid(),
    'OFFICE_ROUTE_STEP_ASSIGNED',
    'pending_approver',
    'pending_office',
    assignment.office_role || ' — ' || assignment.responsibility,
    now_at
  from jsonb_to_recordset(assignment_records) as assignment(
    office_role text,
    responsibility text
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    target_submission_id,
    'OFFICE_ROUTE_STEP_ASSIGNED',
    'Additional office assignment received',
    coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
  from public.workflow_routing_steps step
  join public.profiles profile on profile.role = step.office_role
  where step.routing_plan_id = plan_id
    and step.status = 'in_progress'
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;

  if assignment_count = 0 then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select
      profile.id,
      target_submission_id,
      'OFFICE_ROUTE_STEP_ASSIGNED',
      'Final office decision requested',
      coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
    from public.profiles profile
    where profile.role = decision_office_role
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
  end if;

  return plan_id;
end;
$function$;

-- 4. Retrieval QR codes for requests completed directly by a municipal office.
CREATE OR REPLACE FUNCTION public.create_workflow_retrieval_qr(target_submission_id uuid)
 RETURNS TABLE(retrieval_token uuid, expires_at timestamp with time zone, retrieval_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_office_role text;
  retrieval public.workflow_document_retrievals;
  token_created boolean := false;
  inserted_rows integer;
begin
  if auth.uid() is null
    or coalesce(public.current_profile_role(), '') <> 'submitter'
    or not exists (
      select 1
      from public.workflow_submissions submission
      where submission.id = target_submission_id
        and submission.user_id = auth.uid()
        and submission.status in ('completed', 'approved')
    ) then
    raise exception 'An eligible request belonging to the signed-in user is required';
  end if;

  select step.office_role
  into target_office_role
  from public.workflow_routing_plans plan
  join public.workflow_routing_steps step on step.routing_plan_id = plan.id
  where plan.submission_id = target_submission_id
    and plan.is_current
    and plan.status = 'finalized'
    and step.status = 'approved'
    and not exists (
      select 1
      from public.workflow_routing_steps later_step
      where later_step.routing_plan_id = plan.id
        and later_step.sequence_number > step.sequence_number
    )
    and not exists (
      select 1
      from public.workflow_routing_steps unfinished_step
      where unfinished_step.routing_plan_id = plan.id
        and unfinished_step.status <> 'approved'
    )
  order by step.sequence_number desc
  limit 1;

  if target_office_role is null
    and not exists (
      select 1
      from public.workflow_routing_plans plan
      where plan.submission_id = target_submission_id
        and plan.is_current
    ) then
    -- Direct office submissions have no routing plan: the office that made the
    -- final decision keeps the physical file.
    select coalesce(submission.final_decision_office_role, submission.selected_office_role, submission.initial_destination_role)
      into target_office_role
    from public.workflow_submissions submission
    where submission.id = target_submission_id
      and submission.status = 'completed'
      and coalesce(submission.final_decision_office_role, submission.selected_office_role, submission.initial_destination_role)
        in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan');
  end if;
  if target_office_role is null then
    raise exception 'The request must complete its finalized municipal office route before a retrieval QR code can be issued';
  end if;

  insert into public.workflow_document_retrievals (submission_id, office_role)
  values (target_submission_id, target_office_role)
  on conflict (submission_id) do nothing;
  get diagnostics inserted_rows = row_count;
  token_created := inserted_rows > 0;

  select *
  into retrieval
  from public.workflow_document_retrievals
  where submission_id = target_submission_id
  for update;

  if retrieval.status = 'released' then
    raise exception 'This document has already been released';
  end if;

  if retrieval.status = 'revoked' or retrieval.expires_at <= now() then
    update public.workflow_document_retrievals
    set qr_token = gen_random_uuid(),
        office_role = target_office_role,
        status = 'active',
        generated_at = now(),
        expires_at = now() + interval '1 year',
        updated_at = now()
    where submission_id = target_submission_id
    returning * into retrieval;
    token_created := true;
  end if;

  if token_created then
    insert into public.workflow_document_retrieval_events (
      submission_id, actor_id, actor_role, action_type
    )
    values (
      target_submission_id, auth.uid(), 'submitter', 'QR_GENERATED'
    );
  end if;

  return query
  select retrieval.qr_token, retrieval.expires_at, retrieval.status;
end;
$function$;

-- 5a. Do not notify the Tourism Officer about direct office submissions (and avoid duplicates).
CREATE OR REPLACE FUNCTION public.notify_approvers_of_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  submission public.workflow_submissions;
begin
  if new.action_type <> 'SUBMITTED' then
    return new;
  end if;

  select * into submission
  from public.workflow_submissions
  where id = new.submission_id;

  if not found then
    raise exception 'Submission % not found for approver notification', new.submission_id;
  end if;

  -- Submissions with an explicit destination are notified by create_workflow_submission:
  -- direct office requests must not involve the Tourism Officer, and Tourism Office
  -- requests already receive SUBMISSION_ROUTED_TO_TOURISM_OFFICER.
  if submission.initial_destination_role is not null then
    return new;
  end if;

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    submission.id,
    'SUBMITTED',
    'New document submitted',
    coalesce(submission.tracking_number, 'Pending tracking number')
      || ' — ' || submission.file_name
  from public.profiles profile
  where profile.role = 'tourism_officer'
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;

  return new;
end;
$function$;

-- 5b. One 'Additional requirements requested' notification per office return.
CREATE OR REPLACE FUNCTION public.create_workflow_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  submission public.workflow_submissions;
  notification_title text;
  notification_message text;
begin
  select * into submission
  from public.workflow_submissions
  where id = new.submission_id;

  -- A municipal office return (pending_office -> returned_for_requirements) is announced
  -- by the ROUTE_REQUIREMENTS_REQUESTED entry, which carries the office remarks.
  if new.action_type = 'RETURNED_FOR_REQUIREMENTS' and new.old_status = 'pending_office' then
    return new;
  end if;

  notification_title := case new.action_type
    when 'SUBMITTED' then 'Document submitted'
    when 'APPROVER_APPROVED' then 'Approver review completed'
    when 'APPROVER_REJECTED' then 'Request returned by approver'
    when 'ADMIN_VERIFIED' then 'Administrative review completed'
    when 'ADMIN_REJECTED' then 'Request rejected during administrative review'
    when 'OFFICE_REVIEW_COMPLETED' then 'Municipal office review completed'
    when 'OFFICE_REJECTED' then 'Request rejected by municipal office'
    when 'RETURNED_FOR_REQUIREMENTS' then 'Additional requirements requested'
    when 'REQUIREMENTS_RESUBMITTED' then 'Additional requirements submitted'
    when 'MAYOR_APPROVED' then 'Final decision: approved'
    when 'MAYOR_REJECTED' then 'Final decision: rejected'
    when 'WORKFLOW_COMPLETED' then 'Request completed'
    when 'FINAL_APPROVAL' then 'Document approved'
    when 'FINAL_REJECTION' then 'Document rejected'
    when 'VERIFICATION_PASSED' then 'Verification completed'
    when 'RETURNED_FOR_CORRECTION' then 'Document returned for correction'
    else 'Workflow status updated'
  end;
  notification_message := coalesce(submission.tracking_number, 'Pending tracking number')
    || ' — ' || submission.file_name;
  if new.action_type in ('APPROVER_APPROVED', 'ADMIN_VERIFIED', 'OFFICE_REVIEW_COMPLETED') then
    notification_message := notification_message || E'\nResponsible office: '
      || case submission.selected_office_role
        when 'municipal_treasurer' then 'Municipal Treasurer''s Office'
        when 'mayor_office' then 'Mayor''s Office'
        when 'sangguniang_bayan' then 'Sangguniang Bayan Office'
        else 'Unassigned'
      end;
  end if;
  if new.comments is not null and length(btrim(new.comments)) > 0 then
    notification_message := notification_message || E'\n' || new.comments;
  end if;

  if new.action_type in (
    'SUBMITTED',
    'APPROVER_APPROVED',
    'APPROVER_REJECTED',
    'ADMIN_VERIFIED',
    'ADMIN_REJECTED',
    'OFFICE_REVIEW_COMPLETED',
    'OFFICE_REJECTED',
    'RETURNED_FOR_REQUIREMENTS',
    'REQUIREMENTS_RESUBMITTED',
    'MAYOR_APPROVED',
    'MAYOR_REJECTED',
    'WORKFLOW_COMPLETED',
    'FINAL_APPROVAL',
    'FINAL_REJECTION',
    'VERIFICATION_PASSED',
    'RETURNED_FOR_CORRECTION'
  ) then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    values (
      submission.user_id, new.submission_id, new.action_type,
      notification_title, notification_message
    )
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
  end if;

  if new.action_type in ('APPROVER_APPROVED', 'APPROVER_REJECTED', 'OFFICE_REVIEW_COMPLETED')
    or new.action_type = 'REQUIREMENTS_RESUBMITTED' then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select profile.id, new.submission_id, new.action_type,
      notification_title, notification_message
    from public.profiles profile
    where profile.role = 'system_admin'
      and profile.id <> coalesce(
        new.action_by,
        '00000000-0000-0000-0000-000000000000'::uuid
      )
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
  end if;

  if new.action_type in ('ADMIN_VERIFIED', 'REQUIREMENTS_RESUBMITTED') then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select profile.id, new.submission_id, new.action_type,
      notification_title, notification_message
    from public.profiles profile
    where profile.role = submission.selected_office_role
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
  end if;

  if new.action_type = 'OFFICE_REVIEW_COMPLETED' then
    insert into public.workflow_notifications (
      recipient_id, submission_id, event_type, title, message
    )
    select profile.id, new.submission_id, new.action_type,
      notification_title, notification_message
    from public.profiles profile
    where profile.role = 'mayor_office'
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
  end if;

  return new;
end;
$function$;

-- 5c. E-mail links for the renamed system_admin / tourism_officer roles; skip removed accounts.
CREATE OR REPLACE FUNCTION public.queue_workflow_notification_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient_email text;
  recipient_role text;
  recipient_name text;
  document_reference text;
  action_path text;
  request_title text;
begin
  select profile.email, profile.role, nullif(btrim(profile.full_name), '')
    into recipient_email, recipient_role, recipient_name
  from public.profiles profile
  where profile.id = new.recipient_id
    and profile.is_active = true;
  if nullif(btrim(recipient_email), '') is null then return new; end if;

  if new.interoffice_request_id is not null then
    select request.title, request.reference_number
      into request_title, document_reference
    from public.workflow_interoffice_requests request
    where request.id = new.interoffice_request_id;
    if recipient_role = 'submitter' and new.submission_id is not null then
      select submission.tracking_number
        into document_reference
      from public.workflow_submissions submission
      where submission.id = new.submission_id;
      action_path := '/workflow/user/file_registry/' || new.submission_id::text;
    else
      action_path := '/workflow/inter-office?request=' || new.interoffice_request_id::text;
    end if;
  else
    select submission.tracking_number
      into document_reference
    from public.workflow_submissions submission
    where submission.id = new.submission_id;
    request_title := new.title;
    action_path := case recipient_role
      when 'submitter' then '/workflow/user/file_registry/' || new.submission_id::text
      when 'system_admin' then '/workflow/admin/submissions/' || new.submission_id::text
      when 'tourism_officer' then '/workflow/approver/file_management/' || new.submission_id::text
      when 'municipal_treasurer' then '/workflow/approver/file_management/' || new.submission_id::text
      when 'mayor_office' then '/workflow/approver/file_management/' || new.submission_id::text
      when 'sangguniang_bayan' then '/workflow/approver/file_management/' || new.submission_id::text
      else '/workflow'
    end;
  end if;

  insert into public.workflow_email_outbox (
    notification_id, recipient_id, recipient_email, subject, body,
    event_type, notification_title, document_reference, action_path, recipient_name
  )
  values (
    new.id, new.recipient_id, recipient_email,
    'CONNECT-Daet: ' || coalesce(request_title, new.title),
    new.message, new.event_type, new.title, document_reference,
    action_path, recipient_name
  )
  on conflict (notification_id) do nothing;
  return new;
end;
$function$;


-- 2a. workflow_submissions: every workflow change goes through SECURITY DEFINER RPCs,
--     which bypass RLS. The broad UPDATE policy let submitters, offices and the Tourism
--     Officer rewrite columns such as file_path, selected_office_role or description
--     directly, because enforce_workflow_submission_transition only fires on UPDATE OF status.
drop policy if exists "Users and staff can update authorized submissions" on public.workflow_submissions;
drop policy if exists "Administrators can update submissions" on public.workflow_submissions;
create policy "Administrators can update submissions"
  on public.workflow_submissions
  for update
  to authenticated
  using (public.is_workflow_admin())
  with check (public.is_workflow_admin());

create or replace function public.guard_workflow_submission_direct_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.workflow_authorized_transition', true) = 'on'
    or coalesce(auth.role(), '') <> 'authenticated'
    or public.current_profile_role() = 'system_admin'
    or new.status is distinct from old.status then
    -- Status changes remain governed by enforce_workflow_submission_transition.
    return new;
  end if;
  if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'Workflow records can only be changed through an authorized stage decision';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_workflow_submission_direct_update on public.workflow_submissions;
create trigger guard_workflow_submission_direct_update
before update on public.workflow_submissions
for each row
execute function public.guard_workflow_submission_direct_update();

-- 2b. profiles: users may edit their own descriptive details but not the e-mail address
--     that receives workflow notifications, their active state, or their role.
create or replace function public.guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated'
    or public.current_profile_role() = 'system_admin' then
    return new;
  end if;
  if new.id is distinct from old.id
    or new.role is distinct from old.role
    or new.email is distinct from old.email
    or new.is_active is distinct from old.is_active then
    raise exception 'Only an administrator can change account e-mail, role, or active state';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_self_update on public.profiles;
create trigger guard_profile_self_update
before update on public.profiles
for each row
execute function public.guard_profile_self_update();

-- 2c. workflow_notifications: recipients may only mark notifications as read.
revoke update on public.workflow_notifications from anon, authenticated;
grant update (read_at) on public.workflow_notifications to authenticated;

-- 2d. workflow_tracking_sequences had RLS disabled and was writable through the API;
--     generate_workflow_tracking_number() was executable by anonymous callers.
alter table public.workflow_tracking_sequences enable row level security;
revoke all on public.workflow_tracking_sequences from anon, authenticated;
revoke execute on function public.generate_workflow_tracking_number() from public, anon, authenticated;

-- 3. Default final-decision authority: each municipal office decides requests sent to it.
--    Without a row, finalize_workflow_submission always fails for direct office requests.
--    Administrators can still add document-specific rules or remove a default in User Management.
insert into public.workflow_final_decision_authorities (office_role, document_type, required_profile_role)
select office.role, null, office.role
from (values ('municipal_treasurer'), ('mayor_office'), ('sangguniang_bayan')) as office(role)
where not exists (
  select 1
  from public.workflow_final_decision_authorities existing
  where existing.office_role = office.role
    and existing.document_type is null
);

-- 6. Let uploaders delete their own workflow_uploads objects that were never linked to a
--    submission, attachment or version (the upload pages already call remove() to roll back
--    failed submissions, but no DELETE policy existed, so orphaned files were left behind).
create or replace function public.workflow_upload_is_linked(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.workflow_submissions where file_path = object_name)
    or exists (select 1 from public.workflow_submission_attachments where file_path = object_name)
    or exists (select 1 from public.workflow_submission_versions where file_path = object_name)
$$;
revoke execute on function public.workflow_upload_is_linked(text) from public, anon;
grant execute on function public.workflow_upload_is_linked(text) to authenticated;

drop policy if exists "Uploader can remove unlinked workflow files" on storage.objects;
create policy "Uploader can remove unlinked workflow files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'workflow_uploads'
    and name like auth.uid()::text || '/%'
    and not public.workflow_upload_is_linked(name)
  );
