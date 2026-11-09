create table if not exists public.workflow_document_retrievals (
  submission_id uuid primary key
    references public.workflow_submissions(id) on delete cascade,
  qr_token uuid not null unique default gen_random_uuid(),
  office_role text not null check (
    office_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan')
  ),
  status text not null default 'active'
    check (status in ('active', 'released', 'revoked')),
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 year'),
  department_section text,
  room text,
  cabinet text,
  shelf text,
  drawer text,
  folder_box text,
  received_at timestamptz,
  location_updated_at timestamptz,
  location_updated_by uuid references public.profiles(id) on delete set null,
  released_at timestamptz,
  released_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (
    (status = 'released' and released_at is not null)
    or (status <> 'released' and released_at is null and released_by is null)
  )
);

create table if not exists public.workflow_document_retrieval_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null
    references public.workflow_submissions(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text not null,
  action_type text not null check (
    action_type in ('QR_GENERATED', 'QR_SCANNED', 'LOCATION_UPDATED', 'DOCUMENT_RELEASED')
  ),
  identity_verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists workflow_document_retrieval_events_submission_idx
  on public.workflow_document_retrieval_events (submission_id, created_at desc);

alter table public.workflow_document_retrievals enable row level security;
alter table public.workflow_document_retrieval_events enable row level security;

revoke all on table public.workflow_document_retrievals from anon, authenticated;
revoke all on table public.workflow_document_retrieval_events from anon, authenticated;

create or replace function public.get_workflow_retrieval_qr(target_submission_id uuid)
returns table (retrieval_token uuid, expires_at timestamptz, retrieval_status text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
    or coalesce(public.current_profile_role(), '') <> 'user'
    or not exists (
      select 1
      from public.workflow_submissions submission
      where submission.id = target_submission_id
        and submission.user_id = auth.uid()
        and submission.status in ('completed', 'approved')
    ) then
    raise exception 'An eligible request belonging to the signed-in user is required';
  end if;

  return query
  select retrieval.qr_token, retrieval.expires_at, retrieval.status
  from public.workflow_document_retrievals retrieval
  where retrieval.submission_id = target_submission_id
    and (
      retrieval.status = 'released'
      or (retrieval.status = 'active' and retrieval.expires_at > now())
    );
end;
$$;

create or replace function public.create_workflow_retrieval_qr(target_submission_id uuid)
returns table (retrieval_token uuid, expires_at timestamptz, retrieval_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_office_role text;
  retrieval public.workflow_document_retrievals;
  token_created boolean := false;
  inserted_rows integer;
begin
  if auth.uid() is null
    or coalesce(public.current_profile_role(), '') <> 'user'
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
      target_submission_id, auth.uid(), 'user', 'QR_GENERATED'
    );
  end if;

  return query
  select retrieval.qr_token, retrieval.expires_at, retrieval.status;
end;
$$;

create or replace function public.get_workflow_retrieval_by_token(scanned_token uuid)
returns table (
  submission_id uuid,
  request_reference text,
  document_title text,
  requester_full_name text,
  document_type text,
  processing_status text,
  office_role text,
  retrieval_status text,
  department_section text,
  room text,
  cabinet text,
  shelf text,
  drawer text,
  folder_box text,
  received_at timestamptz,
  assigned_officer_name text,
  latest_update timestamptz,
  released_at timestamptz,
  releasing_officer_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  target_retrieval public.workflow_document_retrievals;
begin
  actor_role := public.current_profile_role();
  if auth.uid() is null
    or actor_role is null
    or actor_role not in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then
    raise exception 'Only authorized municipal officers can scan document retrieval QR codes';
  end if;

  select *
  into target_retrieval
  from public.workflow_document_retrievals retrieval
  where retrieval.qr_token = scanned_token
    and retrieval.status in ('active', 'released')
    and retrieval.expires_at > now();

  if not found then
    raise exception 'This QR code is invalid, expired, or no longer active';
  end if;

  if target_retrieval.office_role <> actor_role then
    raise exception 'This request is assigned to a different municipal office';
  end if;

  insert into public.workflow_document_retrieval_events (
    submission_id, actor_id, actor_role, action_type
  )
  values (
    target_retrieval.submission_id, auth.uid(), actor_role, 'QR_SCANNED'
  );

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, comments
  )
  values (
    target_retrieval.submission_id,
    auth.uid(),
    'RETRIEVAL_QR_SCANNED',
    'Retrieval QR code scanned by the assigned municipal office.'
  );

  return query
  select
    submission.id,
    submission.tracking_number,
    submission.file_name,
    coalesce(nullif(btrim(requester.full_name), ''), 'Unknown requester'),
    submission.category,
    case
      when target_retrieval.status = 'released' then 'Released'
      else submission.status
    end,
    target_retrieval.office_role,
    target_retrieval.status,
    target_retrieval.department_section,
    target_retrieval.room,
    target_retrieval.cabinet,
    target_retrieval.shelf,
    target_retrieval.drawer,
    target_retrieval.folder_box,
    target_retrieval.received_at,
    coalesce(
      nullif(btrim(location_officer.full_name), ''),
      nullif(btrim(assigned_officer.full_name), '')
    ),
    greatest(
      submission.updated_at,
      coalesce(target_retrieval.location_updated_at, target_retrieval.generated_at),
      target_retrieval.updated_at
    ),
    target_retrieval.released_at,
    nullif(btrim(releasing_officer.full_name), '')
  from public.workflow_submissions submission
  join public.profiles requester on requester.id = submission.user_id
  left join public.profiles location_officer
    on location_officer.id = target_retrieval.location_updated_by
  left join lateral (
    select profile.full_name
    from public.workflow_routing_plans plan
    join public.workflow_routing_steps step on step.routing_plan_id = plan.id
    left join public.profiles profile on profile.id = step.decided_by
    where plan.submission_id = submission.id
      and plan.is_current
      and plan.status = 'finalized'
      and step.office_role = target_retrieval.office_role
      and step.status = 'approved'
    order by step.sequence_number desc
    limit 1
  ) assigned_officer on true
  left join public.profiles releasing_officer
    on releasing_officer.id = target_retrieval.released_by
  where submission.id = target_retrieval.submission_id;
end;
$$;

create or replace function public.update_workflow_document_location(
  target_submission_id uuid,
  location_department_section text,
  location_room text,
  location_cabinet text,
  location_shelf text,
  location_drawer text,
  location_folder_box text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  retrieval public.workflow_document_retrievals;
begin
  actor_role := public.current_profile_role();
  if auth.uid() is null
    or actor_role is null
    or actor_role not in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then
    raise exception 'Only authorized municipal officers can update document storage locations';
  end if;

  if exists (
    select 1
    from unnest(array[
      location_department_section, location_room, location_cabinet,
      location_shelf, location_drawer, location_folder_box
    ]) as locations(value)
    where length(coalesce(value, '')) > 200
  ) then
    raise exception 'Each storage location field must be 200 characters or fewer';
  end if;

  select *
  into retrieval
  from public.workflow_document_retrievals
  where submission_id = target_submission_id
  for update;

  if not found
    or retrieval.office_role <> actor_role
    or retrieval.status <> 'active'
    or retrieval.expires_at <= now() then
    raise exception 'An active retrieval record assigned to your office is required';
  end if;

  update public.workflow_document_retrievals
  set department_section = nullif(btrim(location_department_section), ''),
      room = nullif(btrim(location_room), ''),
      cabinet = nullif(btrim(location_cabinet), ''),
      shelf = nullif(btrim(location_shelf), ''),
      drawer = nullif(btrim(location_drawer), ''),
      folder_box = nullif(btrim(location_folder_box), ''),
      received_at = coalesce(received_at, now()),
      location_updated_at = now(),
      location_updated_by = auth.uid(),
      updated_at = now()
  where submission_id = target_submission_id;

  insert into public.workflow_document_retrieval_events (
    submission_id, actor_id, actor_role, action_type
  )
  values (
    target_submission_id, auth.uid(), actor_role, 'LOCATION_UPDATED'
  );

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, comments
  )
  values (
    target_submission_id,
    auth.uid(),
    'RETRIEVAL_LOCATION_UPDATED',
    'Physical document storage location updated by the assigned municipal office.'
  );
end;
$$;

create or replace function public.release_workflow_document(
  target_submission_id uuid,
  requester_identity_verified boolean
)
returns table (released_at timestamptz, releasing_officer_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  retrieval public.workflow_document_retrievals;
  requester_id uuid;
  released_time timestamptz := now();
begin
  actor_role := public.current_profile_role();
  if auth.uid() is null
    or actor_role is null
    or actor_role not in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan') then
    raise exception 'Only authorized municipal officers can release documents';
  end if;
  if requester_identity_verified is distinct from true then
    raise exception 'Verify the requester’s identity and authorization before releasing the document';
  end if;

  select *
  into retrieval
  from public.workflow_document_retrievals
  where submission_id = target_submission_id
  for update;

  if not found
    or retrieval.office_role <> actor_role
    or retrieval.status <> 'active'
    or retrieval.expires_at <= released_time then
    raise exception 'An active retrieval record assigned to your office is required';
  end if;

  select submission.user_id
  into requester_id
  from public.workflow_submissions submission
  where submission.id = target_submission_id
    and submission.status in ('completed', 'approved');
  if requester_id is null then
    raise exception 'Only an approved and completed request can be released';
  end if;

  update public.workflow_document_retrievals
  set status = 'released',
      released_at = released_time,
      released_by = auth.uid(),
      updated_at = released_time
  where submission_id = target_submission_id;

  insert into public.workflow_document_retrieval_events (
    submission_id, actor_id, actor_role, action_type, identity_verified
  )
  values (
    target_submission_id, auth.uid(), actor_role, 'DOCUMENT_RELEASED', true
  );

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, comments
  )
  values (
    target_submission_id,
    auth.uid(),
    'DOCUMENT_RELEASED',
    'Approved document handed over after in-person identity and authorization verification.'
  );

  insert into public.workflow_notifications (
    recipient_id, submission_id, event_type, title, message
  )
  select
    requester_id,
    target_submission_id,
    'DOCUMENT_RELEASED',
    'Your document has been released',
    coalesce(submission.tracking_number, 'Request')
      || ' — ' || submission.file_name
      || ' was released by ' || coalesce(nullif(btrim(officer.full_name), ''), 'an authorized municipal officer')
      || ' on ' || to_char(released_time at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') || '.'
  from public.workflow_submissions submission
  left join public.profiles officer on officer.id = auth.uid()
  where submission.id = target_submission_id;

  return query
  select released_time, nullif(btrim(profile.full_name), '')
  from public.profiles profile
  where profile.id = auth.uid();
end;
$$;

revoke all on function public.get_workflow_retrieval_qr(uuid) from public, anon, authenticated;
revoke all on function public.create_workflow_retrieval_qr(uuid) from public, anon, authenticated;
revoke all on function public.get_workflow_retrieval_by_token(uuid) from public, anon, authenticated;
revoke all on function public.update_workflow_document_location(uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.release_workflow_document(uuid, boolean) from public, anon, authenticated;

grant execute on function public.get_workflow_retrieval_qr(uuid) to authenticated;
grant execute on function public.create_workflow_retrieval_qr(uuid) to authenticated;
grant execute on function public.get_workflow_retrieval_by_token(uuid) to authenticated;
grant execute on function public.update_workflow_document_location(uuid, text, text, text, text, text, text)
  to authenticated;
grant execute on function public.release_workflow_document(uuid, boolean) to authenticated;
