alter table public.workflow_submissions
  add column if not exists initial_destination_role text,
  add column if not exists final_decision_office_role text,
  add column if not exists other_document_type text,
  add column if not exists final_decision_by uuid references public.profiles(id) on delete set null,
  add column if not exists final_decided_at timestamptz;

create table if not exists public.workflow_office_document_types (
  office_role text not null check (
    office_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan', 'approver')
  ),
  document_type text not null check (length(btrim(document_type)) > 0),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (office_role, document_type)
);

insert into public.workflow_office_document_types (office_role, document_type)
values
  ('municipal_treasurer', 'Tax and Payment Documents'),
  ('municipal_treasurer', 'Business Permit Fees'),
  ('municipal_treasurer', 'Official Receipts'),
  ('municipal_treasurer', 'Financial Requests'),
  ('municipal_treasurer', 'Other'),
  ('mayor_office', 'Executive Requests'),
  ('mayor_office', 'Complaints'),
  ('mayor_office', 'Mayoral Endorsements'),
  ('mayor_office', 'General Correspondence'),
  ('mayor_office', 'Other'),
  ('sangguniang_bayan', 'Proposed Ordinances'),
  ('sangguniang_bayan', 'Proposed Resolutions'),
  ('sangguniang_bayan', 'Legislative Requests'),
  ('sangguniang_bayan', 'Session-Related Submissions'),
  ('sangguniang_bayan', 'Other'),
  ('approver', 'Other')
on conflict (office_role, document_type) do nothing;

alter table public.workflow_office_document_types enable row level security;
revoke all on public.workflow_office_document_types from anon, authenticated;
grant select on public.workflow_office_document_types to authenticated;

drop policy if exists "Authenticated users can view office document types"
  on public.workflow_office_document_types;
create policy "Authenticated users can view office document types"
  on public.workflow_office_document_types
  for select to authenticated
  using (true);

create or replace function public.workflow_categories_for_role(role_name text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_agg(document_type order by document_type),
    array[]::text[]
  )
  from public.workflow_office_document_types
  where office_role = role_name
$$;

alter table public.workflow_submissions
  add constraint workflow_submissions_other_document_type_check
  check (
    (category = 'Other' and other_document_type is not null
      and length(btrim(other_document_type)) between 1 and 120)
    or (category <> 'Other' and other_document_type is null)
    or (category is null and other_document_type is null)
  );

drop policy if exists "Users can insert their own submissions"
  on public.workflow_submissions;
create policy "Users can insert their own submissions"
  on public.workflow_submissions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = case
      when initial_destination_role = 'approver' then 'pending_approver'
      else 'pending_office'
    end
    and selected_office_role is not distinct from case
      when initial_destination_role = 'approver' then null
      else initial_destination_role
    end
    and exists (
      select 1
      from public.workflow_office_document_types document_type
      where document_type.office_role = initial_destination_role
        and document_type.document_type = category
    )
    and (
      (category = 'Other' and other_document_type is not null
        and length(btrim(other_document_type)) between 1 and 120)
      or (category <> 'Other' and other_document_type is null)
    )
  );

update public.workflow_submissions
set initial_destination_role = selected_office_role
where initial_destination_role is null
  and selected_office_role in (
    'municipal_treasurer',
    'mayor_office',
    'sangguniang_bayan'
  );

alter table public.workflow_submissions
  add constraint workflow_submissions_final_decision_office_role_check
  check (
    final_decision_office_role is null
    or final_decision_office_role in (
      'municipal_treasurer',
      'mayor_office',
      'sangguniang_bayan'
    )
  );

update public.workflow_submissions
set final_decision_office_role = initial_destination_role
where final_decision_office_role is null
  and initial_destination_role in (
    'municipal_treasurer',
    'mayor_office',
    'sangguniang_bayan'
  );

alter table public.workflow_submissions
  add constraint workflow_submissions_initial_destination_role_check
  check (
    initial_destination_role is null
    or initial_destination_role in (
      'municipal_treasurer',
      'mayor_office',
      'sangguniang_bayan',
      'approver'
    )
  );

alter table public.workflow_routing_steps
  add column if not exists responsibility text not null default 'mandatory_approval_clearance',
  add column if not exists assignment_source text not null default 'legacy',
  drop constraint if exists workflow_routing_steps_routing_plan_id_sequence_number_key;

alter table public.workflow_routing_steps
  add constraint workflow_routing_steps_responsibility_check
    check (responsibility in (
      'mandatory_approval_clearance',
      'evaluation_verification',
      'recommendation'
    )),
  add constraint workflow_routing_steps_assignment_source_check
    check (assignment_source in ('tourism_officer', 'legacy'));

create table if not exists public.workflow_submission_versions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.workflow_submissions(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  file_name text not null,
  file_path text not null,
  file_type text not null,
  file_size bigint not null check (file_size > 0),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (submission_id, version_number)
);

create index if not exists workflow_submission_versions_submission_idx
  on public.workflow_submission_versions (submission_id, version_number);

insert into public.workflow_submission_versions (
  submission_id, version_number, file_name, file_path, file_type, file_size, uploaded_by, created_at
)
select
  submission.id,
  1,
  submission.file_name,
  submission.file_path,
  submission.file_type,
  submission.file_size,
  submission.user_id,
  submission.created_at
from public.workflow_submissions submission
where submission.file_name is not null
  and submission.file_path is not null
  and submission.file_type is not null
  and submission.file_size > 0
  and not exists (
    select 1
    from public.workflow_submission_versions version
    where version.submission_id = submission.id
  );

alter table public.workflow_submission_versions enable row level security;
revoke all on public.workflow_submission_versions from anon, authenticated;
grant select on public.workflow_submission_versions to authenticated;

drop policy if exists "Authorized users can view submission versions"
  on public.workflow_submission_versions;
create policy "Authorized users can view submission versions"
  on public.workflow_submission_versions
  for select to authenticated
  using (
    exists (
      select 1
      from public.workflow_submissions submission
      where submission.id = workflow_submission_versions.submission_id
        and (
          submission.user_id = auth.uid()
          or public.is_workflow_staff()
          or submission.selected_office_role = public.current_profile_role()
          or public.is_submission_assigned_to_current_office(submission.id)
        )
    )
  );

drop trigger if exists enforce_workflow_submission_version_file_type
  on public.workflow_submission_versions;
create trigger enforce_workflow_submission_version_file_type
before insert on public.workflow_submission_versions
for each row
execute function public.enforce_workflow_upload_file_type();

create or replace function public.is_workflow_file_accessible(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_submissions submission
    where (
      submission.file_path = object_name
      or exists (
        select 1
        from public.workflow_submission_attachments attachment
        where attachment.submission_id = submission.id
          and attachment.file_path = object_name
      )
      or exists (
        select 1
        from public.workflow_submission_versions version
        where version.submission_id = submission.id
          and version.file_path = object_name
      )
    )
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
$$;

create table if not exists public.workflow_final_decision_authorities (
  id uuid primary key default gen_random_uuid(),
  office_role text not null check (
    office_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan')
  ),
  document_type text,
  required_profile_role text not null check (
    required_profile_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan')
  ),
  configured_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (required_profile_role = office_role),
  check (document_type is null or length(btrim(document_type)) > 0)
);

create unique index if not exists workflow_final_decision_authorities_office_default_idx
  on public.workflow_final_decision_authorities (office_role)
  where document_type is null;

create unique index if not exists workflow_final_decision_authorities_office_document_idx
  on public.workflow_final_decision_authorities (office_role, document_type)
  where document_type is not null;

alter table public.workflow_final_decision_authorities enable row level security;
revoke all on public.workflow_final_decision_authorities from anon, authenticated;
grant select on public.workflow_final_decision_authorities to authenticated;

drop policy if exists "Administrators can view final decision authorities"
  on public.workflow_final_decision_authorities;
create policy "Administrators can view final decision authorities"
  on public.workflow_final_decision_authorities
  for select to authenticated
  using (public.current_profile_role() = 'admin');

create or replace function public.configure_workflow_final_decision_authority(
  authority_office_role text,
  authority_document_type text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  normalized_document_type text := nullif(btrim(authority_document_type), '');
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();

  if auth.uid() is null or actor_role is distinct from 'admin' then
    raise exception 'Only an authenticated administrator can configure final decision authority';
  end if;
  if authority_office_role is null or authority_office_role not in (
    'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'Select a supported municipal office';
  end if;
  if normalized_document_type is not null and not exists (
    select 1
    from public.workflow_office_document_types document_type
    where document_type.office_role = authority_office_role
      and document_type.document_type = normalized_document_type
  ) then
    raise exception 'Select a document type configured for the municipal office';
  end if;

  if normalized_document_type is null then
    insert into public.workflow_final_decision_authorities (
      office_role, document_type, required_profile_role, configured_by, updated_at
    )
    values (
      authority_office_role, null, authority_office_role, auth.uid(), timezone('utc', now())
    )
    on conflict (office_role) where document_type is null
    do update set
      required_profile_role = excluded.required_profile_role,
      configured_by = excluded.configured_by,
      updated_at = excluded.updated_at;
  else
    insert into public.workflow_final_decision_authorities (
      office_role, document_type, required_profile_role, configured_by, updated_at
    )
    values (
      authority_office_role,
      normalized_document_type,
      authority_office_role,
      auth.uid(),
      timezone('utc', now())
    )
    on conflict (office_role, document_type) where document_type is not null
    do update set
      required_profile_role = excluded.required_profile_role,
      configured_by = excluded.configured_by,
      updated_at = excluded.updated_at;
  end if;
end;
$$;

create or replace function public.remove_workflow_final_decision_authority(
  authority_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'admin' then
    raise exception 'Only an authenticated administrator can remove final decision authority';
  end if;

  delete from public.workflow_final_decision_authorities
  where id = authority_id;
  if not found then
    raise exception 'Final decision authority configuration not found';
  end if;
end;
$$;

revoke all on function public.configure_workflow_final_decision_authority(text, text)
  from public;
revoke all on function public.remove_workflow_final_decision_authority(uuid)
  from public;
grant execute on function public.configure_workflow_final_decision_authority(text, text)
  to authenticated;
grant execute on function public.remove_workflow_final_decision_authority(uuid)
  to authenticated;

drop function if exists public.create_workflow_submission(
  text, text, text, text, bigint, text, text, text, text, text, jsonb
);
drop function if exists public.create_workflow_submission(
  text, text, text, text, bigint, text, text, text, text, text, text, jsonb
);

create function public.create_workflow_submission(
  submission_title text,
  submission_file_path text,
  submission_file_url text,
  submission_file_type text,
  submission_file_size bigint,
  submission_document_type text,
  submission_description text,
  submission_purpose text,
  submission_requested_action text,
  submission_intended_recipient text,
  submission_office_role text,
  attachment_records jsonb default '[]'::jsonb,
  submission_other_document_type text default null
)
returns table (id uuid, tracking_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  created_submission public.workflow_submissions;
  attachment_record record;
  normalized_other_document_type text := nullif(btrim(submission_other_document_type), '');
  now_at timestamptz := timezone('utc', now());
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'user' then
    raise exception 'Only a submitter can create a workflow submission';
  end if;
  if coalesce(length(btrim(submission_title)), 0) = 0
    or coalesce(length(btrim(submission_file_path)), 0) = 0
    or coalesce(length(btrim(submission_document_type)), 0) = 0
    or coalesce(length(btrim(submission_description)), 0) = 0 then
    raise exception 'Title, document, document type, and description are required';
  end if;
  if submission_office_role is null or submission_office_role not in (
    'municipal_treasurer', 'mayor_office', 'sangguniang_bayan', 'approver'
  ) then
    raise exception 'Select a valid destination office';
  end if;
  if not exists (
    select 1
    from public.workflow_office_document_types document_type
    where document_type.office_role = submission_office_role
      and document_type.document_type = submission_document_type
  ) then
    raise exception 'Select a document type available for the destination office';
  end if;
  if submission_document_type = 'Other' then
    if normalized_other_document_type is null
      or length(normalized_other_document_type) > 120 then
      raise exception 'Specify the document type using no more than 120 characters';
    end if;
  elsif normalized_other_document_type is not null then
    raise exception 'A custom document type is only allowed when Other is selected';
  end if;
  if submission_file_path not like (auth.uid()::text || '/%')
    or jsonb_typeof(attachment_records) is distinct from 'array' then
    raise exception 'Invalid document storage path or attachment list';
  end if;

  insert into public.workflow_submissions (
    user_id,
    file_url,
    file_path,
    file_name,
    file_size,
    file_type,
    category,
    other_document_type,
    description,
    purpose,
    requested_action,
    intended_recipient,
    selected_office_role,
    initial_destination_role,
    status
  )
  values (
    auth.uid(),
    submission_file_url,
    submission_file_path,
    submission_title,
    submission_file_size,
    submission_file_type,
    submission_document_type,
    normalized_other_document_type,
    submission_description,
    nullif(btrim(submission_purpose), ''),
    nullif(btrim(submission_requested_action), ''),
    nullif(btrim(submission_intended_recipient), ''),
    case when submission_office_role = 'approver' then null else submission_office_role end,
    submission_office_role,
    case when submission_office_role = 'approver' then 'pending_approver' else 'pending_office' end
  )
  returning * into created_submission;

  insert into public.workflow_submission_versions (
    submission_id, version_number, file_name, file_path, file_type, file_size, uploaded_by
  )
  values (
    created_submission.id,
    1,
    created_submission.file_name,
    created_submission.file_path,
    created_submission.file_type,
    created_submission.file_size,
    auth.uid()
  );

  for attachment_record in
    select *
    from jsonb_to_recordset(attachment_records) as attachment(
      file_name text,
      file_path text,
      file_type text,
      file_size bigint
    )
  loop
    if coalesce(length(btrim(attachment_record.file_name)), 0) = 0
      or attachment_record.file_path not like (auth.uid()::text || '/%')
      or attachment_record.file_size is null
      or attachment_record.file_size < 0 then
      raise exception 'Invalid supporting attachment metadata';
    end if;

    insert into public.workflow_submission_attachments (
      submission_id, file_name, file_path, file_type, file_size, uploaded_by
    )
    values (
      created_submission.id,
      attachment_record.file_name,
      attachment_record.file_path,
      attachment_record.file_type,
      attachment_record.file_size,
      auth.uid()
    );
  end loop;

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    created_submission.id,
    auth.uid(),
    case when submission_office_role = 'approver'
      then 'SUBMISSION_ROUTED_TO_TOURISM_OFFICER'
      else 'OFFICE_ROUTE_STEP_ASSIGNED'
    end,
    null,
    created_submission.status,
    'Initial destination selected by submitter: ' || submission_office_role,
    now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    created_submission.id,
    case when submission_office_role = 'approver'
      then 'SUBMISSION_ROUTED_TO_TOURISM_OFFICER'
      else 'OFFICE_ROUTE_STEP_ASSIGNED'
    end,
    'New submission routed to your office',
    coalesce(created_submission.tracking_number, 'Pending tracking number')
      || ' — ' || created_submission.file_name
  from public.profiles profile
  where profile.role = submission_office_role
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;

  return query select created_submission.id, created_submission.tracking_number;
end;
$$;

revoke all on function public.create_workflow_submission(
  text, text, text, text, bigint, text, text, text, text, text, text, jsonb, text
) from public;
grant execute on function public.create_workflow_submission(
  text, text, text, text, bigint, text, text, text, text, text, text, jsonb, text
) to authenticated;

create or replace function public.forward_workflow_submission_to_tourism_officer(
  target_submission_id uuid,
  forwarding_comments text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.current_profile_role();
  submission public.workflow_submissions;
  now_at timestamptz := timezone('utc', now());
begin
  if auth.uid() is null or actor_role not in (
    'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) or not exists (
    select 1
    from auth.users account
    where account.id = auth.uid()
      and account.banned_until is null
  ) then
    raise exception 'Only municipal office staff can forward a submission to the Tourism Officer';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found
    or submission.status <> 'pending_office'
    or submission.selected_office_role is distinct from actor_role
    or submission.initial_destination_role is distinct from actor_role then
    raise exception 'This submission is not awaiting review by your office';
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'pending_approver',
      office_comments = nullif(btrim(forwarding_comments), ''),
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id, auth.uid(), 'OFFICE_FORWARDED_TO_TOURISM_OFFICER',
    'pending_office', 'pending_approver',
    nullif(btrim(forwarding_comments), ''), now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    target_submission_id,
    'OFFICE_FORWARDED_TO_TOURISM_OFFICER',
    'Submission forwarded for Tourism Officer review',
    coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || submission.file_name
  from public.profiles profile
  where profile.role = 'approver'
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;

revoke all on function public.forward_workflow_submission_to_tourism_officer(uuid, text)
  from public;
grant execute on function public.forward_workflow_submission_to_tourism_officer(uuid, text)
  to authenticated;

drop function if exists public.create_tourism_officer_assignments(uuid, jsonb, text, text);

create or replace function public.create_tourism_officer_assignments(
  target_submission_id uuid,
  assignment_records jsonb,
  routing_mode text,
  assignment_comments text default null,
  final_decision_office_role text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.workflow_submissions;
  plan_id uuid;
  next_version integer;
  now_at timestamptz := timezone('utc', now());
  assignment_count integer;
  decision_office_role text;
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'approver' then
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
    and submission.initial_destination_role <> 'approver' then
    raise exception 'Select at least one additional office assignment';
  end if;
  if submission.initial_destination_role = 'approver' then
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
        submission.initial_destination_role <> 'approver'
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
  from jsonb_to_recordset(assignment_records) with ordinality
    as assignment(office_role text, responsibility text, ordinality bigint)
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
$$;

revoke all on function public.create_tourism_officer_assignments(uuid, jsonb, text, text, text)
  from public;
grant execute on function public.create_tourism_officer_assignments(uuid, jsonb, text, text, text)
  to authenticated;

create or replace function public.decide_workflow_route_step(
  target_submission_id uuid,
  approve_step boolean,
  decision_comments text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.current_profile_role();
  submission public.workflow_submissions;
  current_plan public.workflow_routing_plans;
  current_step public.workflow_routing_steps;
  next_sequence integer;
  next_office_role text;
  final_office_role text;
  now_at timestamptz := timezone('utc', now());
begin
  if auth.uid() is null or actor_role not in (
    'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) or not exists (
    select 1
    from auth.users account
    where account.id = auth.uid()
      and account.banned_until is null
  ) then
    raise exception 'An active municipal office member is required to decide this assignment';
  end if;
  if not approve_step and coalesce(length(btrim(decision_comments)), 0) = 0 then
    raise exception 'Provide a reason before rejecting this request';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found or submission.status <> 'pending_office' then
    raise exception 'This submission is not awaiting an office assignment decision';
  end if;

  select * into current_plan
  from public.workflow_routing_plans
  where submission_id = target_submission_id
    and is_current
    and status = 'finalized'
  for update;
  if not found then
    raise exception 'No finalized additional-office assignment exists for this submission';
  end if;

  select * into current_step
  from public.workflow_routing_steps
  where routing_plan_id = current_plan.id
    and office_role = actor_role
    and status = 'in_progress'
  for update;
  if not found then
    raise exception 'Your office has no active assignment for this submission';
  end if;

  update public.workflow_routing_steps
  set status = case when approve_step then 'approved' else 'rejected' end,
      decided_by = auth.uid(),
      decided_at = now_at,
      comments = nullif(btrim(decision_comments), '')
  where id = current_step.id;

  if not approve_step then
    perform set_config('app.workflow_authorized_transition', 'on', true);
    update public.workflow_submissions
    set status = 'declined_by_office',
        selected_office_role = null,
        office_comments = btrim(decision_comments),
        updated_at = now_at
    where id = target_submission_id;
    perform set_config('app.workflow_authorized_transition', 'off', true);

    insert into public.workflow_audit_logs (
      submission_id, action_by, action_type, old_status, new_status, comments, created_at
    )
    values (
      target_submission_id, auth.uid(), 'OFFICE_REJECTED',
      'pending_office', 'declined_by_office',
      current_step.office_role || ': ' || btrim(decision_comments), now_at
    );
    return;
  end if;

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id, auth.uid(), 'OFFICE_ROUTE_STEP_APPROVED',
    'pending_office', 'pending_office',
    current_step.office_role || ' — ' || current_step.responsibility
      || coalesce(': ' || nullif(btrim(decision_comments), ''), ''),
    now_at
  );

  if exists (
    select 1
    from public.workflow_routing_steps step
    where step.routing_plan_id = current_plan.id
      and step.sequence_number = current_step.sequence_number
      and step.status = 'in_progress'
  ) then
    return;
  end if;

  select min(step.sequence_number) into next_sequence
  from public.workflow_routing_steps step
  where step.routing_plan_id = current_plan.id
    and step.sequence_number > current_step.sequence_number
    and step.status = 'pending';

  if next_sequence is not null then
    update public.workflow_routing_steps
    set status = 'in_progress',
        assigned_by = current_plan.finalized_by,
        assigned_at = now_at,
        started_at = now_at
    where routing_plan_id = current_plan.id
      and sequence_number = next_sequence
      and status = 'pending';

    select step.office_role into next_office_role
    from public.workflow_routing_steps step
    where step.routing_plan_id = current_plan.id
      and step.sequence_number = next_sequence
      and step.status = 'in_progress'
    order by step.office_role
    limit 1;

    perform set_config('app.workflow_authorized_transition', 'on', true);
    update public.workflow_submissions
    set selected_office_role = next_office_role,
        updated_at = now_at
    where id = target_submission_id;
    perform set_config('app.workflow_authorized_transition', 'off', true);

    insert into public.workflow_audit_logs (
      submission_id, action_by, action_type, old_status, new_status, comments, created_at
    )
    select
      target_submission_id, auth.uid(), 'OFFICE_ROUTE_STEP_ASSIGNED',
      'pending_office', 'pending_office', step.office_role || ' — ' || step.responsibility, now_at
    from public.workflow_routing_steps step
    where step.routing_plan_id = current_plan.id
      and step.sequence_number = next_sequence
      and step.status = 'in_progress';

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
    where step.routing_plan_id = current_plan.id
      and step.sequence_number = next_sequence
      and step.status = 'in_progress'
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
    return;
  end if;

  final_office_role := coalesce(
    submission.final_decision_office_role,
    submission.initial_destination_role
  );
  if final_office_role is not null then
    perform set_config('app.workflow_authorized_transition', 'on', true);
    update public.workflow_submissions
    set status = 'pending_office',
        selected_office_role = final_office_role,
        updated_at = now_at
    where id = target_submission_id;
    perform set_config('app.workflow_authorized_transition', 'off', true);
  else
    perform set_config('app.workflow_authorized_transition', 'on', true);
    update public.workflow_submissions
    set status = 'pending_admin',
        selected_office_role = null,
        updated_at = now_at
    where id = target_submission_id;
    perform set_config('app.workflow_authorized_transition', 'off', true);
  end if;

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id,
    auth.uid(),
    'TOURISM_OFFICER_ASSIGNMENTS_COMPLETED',
    'pending_office',
    case when final_office_role is null then 'pending_admin' else 'pending_office' end,
    'All Tourism Officer-created office assignments are complete',
    now_at
  );

  if final_office_role is not null then
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
    where profile.role = final_office_role
    on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
  end if;
end;
$$;

create or replace function public.finalize_workflow_submission(
  target_submission_id uuid,
  decision_comments text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.current_profile_role();
  submission public.workflow_submissions;
  authorized_role text;
  now_at timestamptz := timezone('utc', now());
begin
  if auth.uid() is null or actor_role not in (
    'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) or not exists (
    select 1
    from auth.users account
    where account.id = auth.uid()
      and account.banned_until is null
  ) then
    raise exception 'An active municipal office member is required to make the final decision';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found
    or submission.status <> 'pending_office'
    or coalesce(submission.final_decision_office_role, submission.initial_destination_role) is distinct from actor_role
    or submission.selected_office_role is distinct from actor_role then
    raise exception 'Only the selected destination office can make this final decision';
  end if;

  select authority.required_profile_role into authorized_role
  from public.workflow_final_decision_authorities authority
  where authority.office_role = coalesce(
      submission.final_decision_office_role,
      submission.initial_destination_role
    )
    and (
      authority.document_type = submission.category
      or authority.document_type is null
    )
  order by (authority.document_type is not null) desc
  limit 1;
  if authorized_role is null then
    raise exception 'Final decision authority is not configured for % and document type "%". Configure a document-specific authority or an office default.',
      coalesce(submission.final_decision_office_role, submission.initial_destination_role),
      coalesce(submission.category, 'unknown');
  end if;
  if actor_role is distinct from authorized_role then
    raise exception 'Your office role is not authorized to make the final decision for this document type';
  end if;
  if exists (
    select 1
    from public.workflow_routing_plans plan
    join public.workflow_routing_steps step on step.routing_plan_id = plan.id
    where plan.submission_id = target_submission_id
      and plan.is_current
      and plan.status = 'finalized'
      and step.status <> 'approved'
  ) then
    raise exception 'All required additional office assignments must be completed before the final decision';
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'completed',
      final_decision_by = auth.uid(),
      final_decided_at = now_at,
      office_comments = nullif(btrim(decision_comments), ''),
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id,
    auth.uid(),
    'OFFICE_FINAL_DECISION',
    'pending_office',
    'completed',
    nullif(btrim(decision_comments), ''),
    now_at
  );
end;
$$;

create or replace function public.request_workflow_submission_changes(
  target_submission_id uuid,
  request_comments text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.current_profile_role();
  submission public.workflow_submissions;
  active_step public.workflow_routing_steps;
  now_at timestamptz := timezone('utc', now());
begin
  if auth.uid() is null or actor_role not in (
    'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'Only municipal office staff can request changes';
  end if;
  if coalesce(length(btrim(request_comments)), 0) = 0 then
    raise exception 'Explain the changes required before returning the submission';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found or submission.status <> 'pending_office' then
    raise exception 'This submission is not awaiting office review';
  end if;

  select step.* into active_step
  from public.workflow_routing_plans plan
  join public.workflow_routing_steps step on step.routing_plan_id = plan.id
  where plan.submission_id = target_submission_id
    and plan.is_current
    and plan.status = 'finalized'
    and step.office_role = actor_role
    and step.status = 'in_progress'
  for update of step;

  if submission.selected_office_role is distinct from actor_role
    and active_step.id is null then
    raise exception 'Your office is not currently assigned to review this submission';
  end if;

  if active_step.id is not null then
    update public.workflow_routing_steps
    set requirements_requested_at = now_at,
        requirements_resubmitted_at = null,
        requirements_comments = btrim(request_comments)
    where id = active_step.id;
  end if;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'returned_for_requirements',
      selected_office_role = actor_role,
      office_comments = btrim(request_comments),
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id, auth.uid(), 'ROUTE_REQUIREMENTS_REQUESTED',
    'pending_office', 'returned_for_requirements', btrim(request_comments), now_at
  );
end;
$$;

drop function if exists public.respond_to_workflow_submission_changes(uuid, text);

create function public.respond_to_workflow_submission_changes(
  target_submission_id uuid,
  sender_comments text,
  revised_file_path text,
  revised_file_url text,
  revised_file_name text,
  revised_file_type text,
  revised_file_size bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.workflow_submissions;
  requester_role text;
  next_version integer;
  now_at timestamptz := timezone('utc', now());
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'user' then
    raise exception 'Only the submitting user can provide the requested information';
  end if;
  if coalesce(length(btrim(sender_comments)), 0) = 0 then
    raise exception 'Enter a response before resubmitting this submission';
  end if;
  if coalesce(length(btrim(revised_file_path)), 0) = 0
    or revised_file_path not like (auth.uid()::text || '/%')
    or coalesce(length(btrim(revised_file_url)), 0) = 0
    or coalesce(length(btrim(revised_file_name)), 0) = 0
    or coalesce(length(btrim(revised_file_type)), 0) = 0
    or revised_file_size is null
    or revised_file_size <= 0 then
    raise exception 'Upload a valid revised document before resubmitting';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
    and user_id = auth.uid()
  for update;
  if not found or submission.status <> 'returned_for_requirements' then
    raise exception 'This submission is not waiting for your response';
  end if;

  requester_role := submission.selected_office_role;
  if requester_role not in (
    'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'
  ) then
    raise exception 'The requesting office could not be determined';
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.workflow_submission_versions
  where submission_id = target_submission_id;

  insert into public.workflow_submission_versions (
    submission_id, version_number, file_name, file_path, file_type, file_size, uploaded_by
  )
  values (
    target_submission_id,
    next_version,
    revised_file_name,
    revised_file_path,
    revised_file_type,
    revised_file_size,
    auth.uid()
  );

  update public.workflow_routing_steps step
  set requirements_resubmitted_at = now_at
  from public.workflow_routing_plans plan
  where plan.submission_id = target_submission_id
    and plan.is_current
    and plan.status = 'finalized'
    and step.routing_plan_id = plan.id
    and step.office_role = requester_role
    and step.status = 'in_progress'
    and step.requirements_requested_at is not null;

  perform set_config('app.workflow_authorized_transition', 'on', true);
  update public.workflow_submissions
  set status = 'pending_office',
      selected_office_role = requester_role,
      sender_response = btrim(sender_comments),
      file_name = revised_file_name,
      file_path = revised_file_path,
      file_url = revised_file_url,
      file_type = revised_file_type,
      file_size = revised_file_size,
      updated_at = now_at
  where id = target_submission_id;
  perform set_config('app.workflow_authorized_transition', 'off', true);

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id, auth.uid(), 'REQUIREMENTS_RESUBMITTED',
    'returned_for_requirements', 'pending_office', btrim(sender_comments), now_at
  );

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, old_status, new_status, comments, created_at
  )
  values (
    target_submission_id,
    auth.uid(),
    'REVISED_DOCUMENT_SUBMITTED',
    'returned_for_requirements',
    'pending_office',
    'Document version ' || next_version || ' uploaded: ' || revised_file_name,
    now_at
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    profile.id,
    target_submission_id,
    'REQUIREMENTS_RESUBMITTED',
    'Submitter responded to requested changes',
    coalesce(submission.tracking_number, 'Pending tracking number') || ' — ' || revised_file_name
  from public.profiles profile
  where profile.role = requester_role
  on conflict (recipient_id, submission_id, event_type, title, message) do nothing;
end;
$$;

revoke all on function public.decide_workflow_route_step(uuid, boolean, text) from public;
revoke all on function public.finalize_workflow_submission(uuid, text) from public;
revoke all on function public.request_workflow_submission_changes(uuid, text) from public;
revoke all on function public.respond_to_workflow_submission_changes(uuid, text, text, text, text, text, bigint)
  from public;
grant execute on function public.decide_workflow_route_step(uuid, boolean, text)
  to authenticated;
grant execute on function public.finalize_workflow_submission(uuid, text)
  to authenticated;
grant execute on function public.request_workflow_submission_changes(uuid, text)
  to authenticated;
grant execute on function public.respond_to_workflow_submission_changes(uuid, text, text, text, text, text, bigint)
  to authenticated;

comment on table public.workflow_final_decision_authorities is
  'Configured municipal office final-decision role by document type; null document_type is the office default.';

comment on column public.workflow_submissions.initial_destination_role is
  'The initial destination selected by the submitter: a municipal office or the Daet Tourism Office.';

comment on column public.workflow_submissions.final_decision_office_role is
  'The municipal office responsible for the final decision; designated by the Tourism Officer when Daet Tourism Office is the initial destination.';

comment on column public.workflow_routing_steps.responsibility is
  'The assigned office responsibility: mandatory approval/clearance, evaluation/verification, or recommendation.';

comment on column public.workflow_routing_steps.assignment_source is
  'Records whether an office assignment was created by the Tourism Officer or predates the revised workflow.';

do $$
declare
  function_definition text;
  original_clause text := '  if actor_role is null then';
  authorized_clause text :=
    '  if current_setting(''app.workflow_authorized_transition'', true) = ''on'' then' || E'\n' ||
    '    return new;' || E'\n' ||
    '  end if;' || E'\n' ||
    original_clause;
begin
  select pg_get_functiondef(
    'public.enforce_workflow_submission_transition()'::regprocedure
  )
  into function_definition;

  if function_definition is null or position(original_clause in function_definition) = 0 then
    raise exception 'Could not safely extend the workflow transition guard';
  end if;

  function_definition := replace(function_definition, original_clause, authorized_clause);
  execute function_definition;
end;
$$;
