create sequence if not exists public.workflow_interoffice_reference_seq;

create table if not exists public.workflow_interoffice_requests (
  id uuid primary key default gen_random_uuid(),
  reference_number text not null unique,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  transaction_type text not null check (char_length(btrim(transaction_type)) between 1 and 100),
  description text not null check (char_length(btrim(description)) between 1 and 5000),
  requesting_office text not null check (
    requesting_office in ('municipal_treasurer', 'sangguniang_bayan', 'mayor_office')
  ),
  current_office text not null check (
    current_office in ('municipal_treasurer', 'sangguniang_bayan', 'mayor_office')
  ),
  final_approval_office text not null check (
    final_approval_office in ('municipal_treasurer', 'sangguniang_bayan', 'mayor_office')
  ),
  created_by uuid not null references public.profiles(id) on delete restrict,
  related_submission_id uuid references public.workflow_submissions(id) on delete set null,
  status text not null default 'pending' check (status in (
    'pending',
    'returned_for_revision',
    'approved',
    'rejected',
    'completed'
  )),
  office_status text not null default 'received' check (office_status in (
    'pending',
    'received',
    'under_review',
    'assessment_in_progress',
    'awaiting_supporting_document',
    'for_forwarding',
    'forwarded',
    'returned_for_revision',
    'approved',
    'rejected',
    'completed'
  )),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_reminded_at timestamptz,
  completed_at timestamptz,
  check (requesting_office <> final_approval_office)
);

create index if not exists workflow_interoffice_requests_created_by_idx
  on public.workflow_interoffice_requests (created_by, created_at desc);
create index if not exists workflow_interoffice_requests_current_office_status_idx
  on public.workflow_interoffice_requests (current_office, office_status, updated_at desc);
create index if not exists workflow_interoffice_requests_related_submission_idx
  on public.workflow_interoffice_requests (related_submission_id)
  where related_submission_id is not null;

create table if not exists public.workflow_interoffice_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.workflow_interoffice_requests(id) on delete cascade,
  sequence_number integer not null check (sequence_number > 0),
  office_role text not null check (
    office_role in ('municipal_treasurer', 'sangguniang_bayan', 'mayor_office')
  ),
  status text not null default 'pending' check (status in (
    'pending',
    'received',
    'under_review',
    'assessment_in_progress',
    'awaiting_supporting_document',
    'for_forwarding',
    'forwarded',
    'returned_for_revision',
    'approved',
    'rejected',
    'completed'
  )),
  assessment_required_before_forward boolean not null default false,
  required_document_type text check (
    required_document_type is null
    or required_document_type in (
      'assessment_report',
      'supporting_document',
      'financial_assessment',
      'technical_review',
      'other'
    )
  ),
  is_final_approver boolean not null default false,
  assigned_at timestamptz,
  started_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  remarks text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (request_id, sequence_number),
  unique (request_id, office_role),
  check (assessment_required_before_forward = (required_document_type is not null))
);

create index if not exists workflow_interoffice_steps_office_status_idx
  on public.workflow_interoffice_steps (office_role, status, assigned_at desc);
create index if not exists workflow_interoffice_steps_request_sequence_idx
  on public.workflow_interoffice_steps (request_id, sequence_number);

create table if not exists public.workflow_interoffice_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.workflow_interoffice_requests(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  sender_office text not null check (
    sender_office in ('municipal_treasurer', 'sangguniang_bayan', 'mayor_office')
  ),
  sender_name text not null,
  recipient_office text not null check (
    recipient_office in ('municipal_treasurer', 'sangguniang_bayan', 'mayor_office')
  ),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default timezone('utc', now()),
  check (sender_office <> recipient_office)
);

create index if not exists workflow_interoffice_messages_request_created_idx
  on public.workflow_interoffice_messages (request_id, created_at, id);

create table if not exists public.workflow_interoffice_activity (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.workflow_interoffice_requests(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  actor_office text,
  action_type text not null check (action_type in (
    'request_created',
    'review_started',
    'assessment_uploaded',
    'document_uploaded',
    'awaiting_supporting_document',
    'message_sent',
    'pending_reminder',
    'forwarded',
    'returned_for_revision',
    'approved',
    'rejected',
    'completed'
  )),
  target_office text,
  from_status text,
  to_status text,
  remarks text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists workflow_interoffice_activity_request_created_idx
  on public.workflow_interoffice_activity (request_id, created_at, id);

create or replace function public.set_interoffice_activity_actor_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.actor_id is not null then
    select coalesce(nullif(btrim(full_name), ''), email, 'Office user')
      into new.actor_name
    from public.profiles
    where id = new.actor_id;
  end if;
  return new;
end;
$$;

revoke all on function public.set_interoffice_activity_actor_name() from public, anon, authenticated;
drop trigger if exists set_interoffice_activity_actor_name
  on public.workflow_interoffice_activity;
create trigger set_interoffice_activity_actor_name
before insert on public.workflow_interoffice_activity
for each row execute function public.set_interoffice_activity_actor_name();

create table if not exists public.workflow_interoffice_documents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.workflow_interoffice_requests(id) on delete cascade,
  step_id uuid references public.workflow_interoffice_steps(id) on delete restrict,
  message_id uuid references public.workflow_interoffice_messages(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  uploader_name text not null,
  uploading_office text not null check (
    uploading_office in ('municipal_treasurer', 'sangguniang_bayan', 'mayor_office')
  ),
  document_type text not null check (document_type in (
    'assessment_report',
    'supporting_document',
    'financial_assessment',
    'technical_review',
    'other',
    'message_attachment'
  )),
  document_group_id uuid not null default gen_random_uuid(),
  version_number integer not null default 1 check (version_number > 0),
  supersedes_document_id uuid references public.workflow_interoffice_documents(id) on delete restrict,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 240),
  file_path text not null unique,
  file_type text not null check (file_type in (
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  )),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  created_at timestamptz not null default timezone('utc', now()),
  unique (document_group_id, version_number),
  check (
    (message_id is null and step_id is not null and document_type <> 'message_attachment')
    or (message_id is not null and step_id is null and document_type = 'message_attachment')
  ),
  check (
    (version_number = 1 and supersedes_document_id is null)
    or (version_number > 1 and supersedes_document_id is not null)
  ),
  check (
    (file_type = 'application/pdf' and lower(file_name) like '%.pdf')
    or (file_type = 'application/msword' and lower(file_name) like '%.doc')
    or (
      file_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      and lower(file_name) like '%.docx'
    )
    or (file_type = 'image/jpeg' and lower(file_name) like '%.jpg')
    or (file_type = 'image/jpeg' and lower(file_name) like '%.jpeg')
    or (file_type = 'image/png' and lower(file_name) like '%.png')
  )
);

create index if not exists workflow_interoffice_documents_request_created_idx
  on public.workflow_interoffice_documents (request_id, created_at desc);
create index if not exists workflow_interoffice_documents_group_version_idx
  on public.workflow_interoffice_documents (document_group_id, version_number desc);
create index if not exists workflow_interoffice_documents_step_type_idx
  on public.workflow_interoffice_documents (step_id, document_type, version_number desc)
  where message_id is null;

alter table public.workflow_interoffice_requests enable row level security;
alter table public.workflow_interoffice_steps enable row level security;
alter table public.workflow_interoffice_messages enable row level security;
alter table public.workflow_interoffice_documents enable row level security;

revoke all on public.workflow_interoffice_requests from anon, authenticated;
revoke all on public.workflow_interoffice_steps from anon, authenticated;
revoke all on public.workflow_interoffice_messages from anon, authenticated;
revoke all on public.workflow_interoffice_documents from anon, authenticated;
grant select on public.workflow_interoffice_requests to authenticated;
grant select on public.workflow_interoffice_steps to authenticated;
grant select on public.workflow_interoffice_messages to authenticated;
grant insert (request_id, sender_id, recipient_office, body)
  on public.workflow_interoffice_messages to authenticated;
grant select on public.workflow_interoffice_documents to authenticated;
grant insert (
  request_id, step_id, message_id, uploaded_by, uploading_office,
  document_type, document_group_id, file_name, file_path, file_type, file_size
) on public.workflow_interoffice_documents to authenticated;

create or replace function public.can_access_interoffice_request(target_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_interoffice_requests request
    where request.id = target_request_id
      and (
        request.requesting_office = public.current_profile_role()
        or request.created_by = auth.uid()
        or exists (
          select 1
          from public.workflow_interoffice_steps step
          where step.request_id = request.id
            and step.office_role = public.current_profile_role()
        )
      )
  )
$$;

drop policy if exists "Users and staff can view authorized submissions"
  on public.workflow_submissions;
create policy "Users and staff can view authorized submissions"
  on public.workflow_submissions
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_workflow_staff()
    or selected_office_role = public.current_profile_role()
    or (
      public.current_profile_role() = 'mayor_office'
      and status = 'pending_mayor'
    )
    or public.is_submission_assigned_to_current_office(id)
    or exists (
      select 1
      from public.workflow_interoffice_requests request
      where request.related_submission_id = workflow_submissions.id
        and public.can_access_interoffice_request(request.id)
    )
  );

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
          or exists (
            select 1
            from public.workflow_interoffice_requests request
            where request.related_submission_id = submission.id
              and public.can_access_interoffice_request(request.id)
          )
        )
    )
  );

drop policy if exists "Authorized users can view submission attachments"
  on public.workflow_submission_attachments;
create policy "Authorized users can view submission attachments"
  on public.workflow_submission_attachments
  for select to authenticated
  using (
    exists (
      select 1
      from public.workflow_submissions submission
      where submission.id = workflow_submission_attachments.submission_id
        and (
          submission.user_id = auth.uid()
          or public.is_workflow_staff()
          or submission.selected_office_role = public.current_profile_role()
          or (
            public.current_profile_role() = 'mayor_office'
            and submission.status = 'pending_mayor'
          )
          or public.is_submission_assigned_to_current_office(submission.id)
          or exists (
            select 1
            from public.workflow_interoffice_requests request
            where request.related_submission_id = submission.id
              and public.can_access_interoffice_request(request.id)
          )
        )
    )
  );

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
        or exists (
          select 1
          from public.workflow_interoffice_requests request
          where request.related_submission_id = submission.id
            and public.can_access_interoffice_request(request.id)
        )
      )
  )
$$;

create or replace function public.can_upload_interoffice_request_file(
  target_request_id uuid,
  object_name text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_interoffice_requests request
    where request.id = target_request_id
      and public.can_access_interoffice_request(request.id)
      and object_name like (target_request_id::text || '/' || auth.uid()::text || '/%')
  )
$$;

revoke all on function public.can_access_interoffice_request(uuid) from public;
revoke all on function public.can_upload_interoffice_request_file(uuid, text) from public;
grant execute on function public.can_access_interoffice_request(uuid) to authenticated;
grant execute on function public.can_upload_interoffice_request_file(uuid, text) to authenticated;

drop policy if exists "Participants can view interoffice requests"
  on public.workflow_interoffice_requests;
create policy "Participants can view interoffice requests"
  on public.workflow_interoffice_requests
  for select to authenticated
  using (public.can_access_interoffice_request(id));

drop policy if exists "Participants can view interoffice request steps"
  on public.workflow_interoffice_steps;
create policy "Participants can view interoffice request steps"
  on public.workflow_interoffice_steps
  for select to authenticated
  using (public.can_access_interoffice_request(request_id));

drop policy if exists "Participants can view interoffice request messages"
  on public.workflow_interoffice_messages;
create policy "Participants can view interoffice request messages"
  on public.workflow_interoffice_messages
  for select to authenticated
  using (public.can_access_interoffice_request(request_id));

drop policy if exists "Participants can send interoffice request messages"
  on public.workflow_interoffice_messages;
create policy "Participants can send interoffice request messages"
  on public.workflow_interoffice_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.can_access_interoffice_request(request_id)
  );

drop policy if exists "Participants can view interoffice request documents"
  on public.workflow_interoffice_documents;
create policy "Participants can view interoffice request documents"
  on public.workflow_interoffice_documents
  for select to authenticated
  using (public.can_access_interoffice_request(request_id));

drop policy if exists "Current office can upload interoffice request documents"
  on public.workflow_interoffice_documents;
create policy "Current office can upload interoffice request documents"
  on public.workflow_interoffice_documents
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and uploading_office = public.current_profile_role()
    and public.can_access_interoffice_request(request_id)
  );

create or replace function public.validate_interoffice_document_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_request public.workflow_interoffice_requests;
  target_step public.workflow_interoffice_steps;
  target_message public.workflow_interoffice_messages;
  latest_document public.workflow_interoffice_documents;
begin
  if new.uploaded_by is distinct from auth.uid()
    or new.uploading_office is distinct from public.current_profile_role() then
    raise exception 'Document uploader must match the authenticated office user';
  end if;
  select coalesce(nullif(btrim(full_name), ''), email, 'Office user')
    into new.uploader_name
  from public.profiles
  where id = auth.uid();

  select * into target_request
  from public.workflow_interoffice_requests
  where id = new.request_id
  for update;
  if new.message_id is not null then
    select * into target_message
    from public.workflow_interoffice_messages
    where id = new.message_id;
    if not found
      or not public.can_access_interoffice_request(new.request_id)
      or target_message.request_id <> new.request_id
      or target_message.sender_id <> auth.uid() then
      raise exception 'Message attachment must belong to a message sent by this user';
    end if;
  else
    if not found or target_request.current_office <> new.uploading_office
      or target_request.status in ('approved', 'rejected', 'completed') then
      raise exception 'Only the current office can upload request documents while it is open';
    end if;
    select * into target_step
    from public.workflow_interoffice_steps
    where id = new.step_id and request_id = new.request_id;
    if not found or target_step.office_role <> new.uploading_office
      or target_request.current_office <> target_step.office_role then
      raise exception 'Assessment document must belong to the current office step';
    end if;
  end if;

  if new.file_path not like (
    new.request_id::text || '/' || auth.uid()::text || '/%'
  ) then
    raise exception 'Document storage path does not match the request and uploader';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.document_group_id::text, 0));
  select * into latest_document
  from public.workflow_interoffice_documents
  where document_group_id = new.document_group_id
  order by version_number desc
  limit 1
  for update;

  if not found then
    new.version_number := 1;
    new.supersedes_document_id := null;
  else
    if latest_document.request_id <> new.request_id
      or latest_document.step_id is distinct from new.step_id
      or latest_document.message_id is not null
      or latest_document.document_type <> new.document_type then
      raise exception 'Document versions must remain in the same request, step, and document type';
    end if;
    new.version_number := latest_document.version_number + 1;
    new.supersedes_document_id := latest_document.id;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_interoffice_document_insert() from public, anon, authenticated;
drop trigger if exists validate_interoffice_document_insert
  on public.workflow_interoffice_documents;
create trigger validate_interoffice_document_insert
before insert on public.workflow_interoffice_documents
for each row execute function public.validate_interoffice_document_insert();

create or replace function public.set_interoffice_message_sender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_office text := public.current_profile_role();
  actor_name text;
  request public.workflow_interoffice_requests;
begin
  if new.sender_id is distinct from auth.uid() then
    raise exception 'Message sender must match the authenticated user';
  end if;
  select * into request
  from public.workflow_interoffice_requests
  where id = new.request_id;
  if not found or not public.can_access_interoffice_request(request.id)
    or new.recipient_office = actor_office then
    raise exception 'Message recipient must be another office participating in this request';
  end if;
  if new.recipient_office <> request.requesting_office and not exists (
    select 1 from public.workflow_interoffice_steps step
    where step.request_id = request.id
      and step.office_role = new.recipient_office
  ) then
    raise exception 'Message recipient is not participating in this request';
  end if;
  select coalesce(nullif(btrim(full_name), ''), email)
    into actor_name
  from public.profiles
  where id = auth.uid();
  new.sender_office := actor_office;
  new.sender_name := coalesce(actor_name, 'Office user');
  return new;
end;
$$;

revoke all on function public.set_interoffice_message_sender() from public, anon, authenticated;
drop trigger if exists set_interoffice_message_sender
  on public.workflow_interoffice_messages;
create trigger set_interoffice_message_sender
before insert on public.workflow_interoffice_messages
for each row execute function public.set_interoffice_message_sender();

create or replace function public.create_interoffice_request(
  request_title text,
  request_transaction_type text,
  request_description text,
  target_office_roles text[],
  required_document_types text[] default array[]::text[],
  requested_submission_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_office text := public.current_profile_role();
  request_id uuid := gen_random_uuid();
  reference_value text;
  first_office text;
  final_office text;
  step_role text;
  required_type text;
  step_number integer := 0;
  reference_sequence bigint;
begin
  if actor_id is null or coalesce(actor_office, '') not in (
    'municipal_treasurer', 'sangguniang_bayan', 'mayor_office'
  ) then
    raise exception 'Only authorized municipal office users can create inter-office requests';
  end if;
  if char_length(btrim(coalesce(request_title, ''))) not between 1 and 200
    or char_length(btrim(coalesce(request_transaction_type, ''))) not between 1 and 100
    or char_length(btrim(coalesce(request_description, ''))) not between 1 and 5000 then
    raise exception 'Enter a valid title, transaction type, and request description';
  end if;
  if coalesce(cardinality(target_office_roles), 0) not between 1 and 3
    or array_ndims(target_office_roles) <> 1
    or array_lower(target_office_roles, 1) <> 1
    or required_document_types is null
    or array_ndims(required_document_types) <> 1
    or array_lower(required_document_types, 1) <> 1
    or cardinality(required_document_types) <> cardinality(target_office_roles) then
    raise exception 'Choose one to three route offices and a document requirement for each';
  end if;
  if exists (
    select 1
    from unnest(target_office_roles) as roles(value)
    where value is null
      or value not in ('municipal_treasurer', 'sangguniang_bayan', 'mayor_office')
  ) or cardinality(array(select distinct unnest(target_office_roles)))
       <> cardinality(target_office_roles) then
    raise exception 'The office route must contain distinct municipal offices';
  end if;
  if exists (
    select 1
    from unnest(target_office_roles) with ordinality as roles(value, route_position)
    where value = actor_office and route_position <> 1
  ) or not exists (
    select 1
    from unnest(target_office_roles) as roles(value)
    where value <> actor_office
  ) then
    raise exception 'The requesting office may only be the first step, and at least one other office must receive the request';
  end if;
  if exists (
    select 1
    from unnest(required_document_types) as required(value)
    where value is not null and value not in (
      'assessment_report', 'supporting_document', 'financial_assessment',
      'technical_review', 'other'
    )
  ) then
    raise exception 'The configured supporting document type is not allowed';
  end if;
  if required_document_types[cardinality(target_office_roles)] is not null then
    raise exception 'The final approval office does not require a report before forwarding';
  end if;
  if requested_submission_id is not null and not exists (
    select 1
    from public.workflow_submissions submission
    where submission.id = requested_submission_id
      and (
        submission.selected_office_role = actor_office
        or public.is_submission_assigned_to_current_office(submission.id)
        or exists (
          select 1
          from public.workflow_routing_plans plan
          join public.workflow_routing_steps step on step.routing_plan_id = plan.id
          where plan.submission_id = submission.id
            and plan.is_current
            and step.office_role = actor_office
        )
      )
  ) then
    raise exception 'The linked citizen request is not accessible to your office';
  end if;

  first_office := target_office_roles[1];
  final_office := target_office_roles[cardinality(target_office_roles)];
  reference_sequence := nextval('public.workflow_interoffice_reference_seq');
  reference_value := 'IO-' || to_char(timezone('utc', now()), 'YYYY') || '-'
    || case
      when char_length(reference_sequence::text) < 7
        then lpad(reference_sequence::text, 7, '0')
      else reference_sequence::text
    end;

  insert into public.workflow_interoffice_requests (
    id, reference_number, title, transaction_type, description,
    requesting_office, current_office, final_approval_office, office_status,
    created_by, related_submission_id, status
  )
  values (
    request_id, reference_value, btrim(request_title), btrim(request_transaction_type),
    btrim(request_description), actor_office, first_office, final_office, 'received',
    actor_id, requested_submission_id, 'pending'
  );

  foreach step_role in array target_office_roles loop
    step_number := step_number + 1;
    required_type := required_document_types[step_number];
    insert into public.workflow_interoffice_steps (
      request_id, sequence_number, office_role, status,
      assessment_required_before_forward, required_document_type,
      is_final_approver, assigned_at
    )
    values (
      request_id, step_number, step_role,
      case when step_number = 1 then 'received' else 'pending' end,
      required_type is not null, required_type,
      step_number = cardinality(target_office_roles),
      case when step_number = 1 then timezone('utc', now()) else null end
    );
  end loop;

  insert into public.workflow_interoffice_activity (
    request_id, actor_id, actor_office, action_type,
    target_office, from_status, to_status, remarks
  )
  values (
    request_id, actor_id, actor_office, 'request_created',
    first_office, null, 'received', 'Request sent to the first receiving office.'
  );

  return request_id;
end;
$$;

alter table public.workflow_interoffice_activity enable row level security;
revoke all on public.workflow_interoffice_activity from anon, authenticated;
grant select on public.workflow_interoffice_activity to authenticated;
drop policy if exists "Participants can view interoffice request activity"
  on public.workflow_interoffice_activity;
create policy "Participants can view interoffice request activity"
  on public.workflow_interoffice_activity
  for select to authenticated
  using (public.can_access_interoffice_request(request_id));

revoke all on function public.create_interoffice_request(
  text, text, text, text[], text[], uuid
) from public, anon;
grant execute on function public.create_interoffice_request(
  text, text, text, text[], text[], uuid
) to authenticated;

create or replace function public.record_interoffice_activity(
  target_request_id uuid,
  action_name text,
  target_office_role text,
  previous_status text,
  next_status text,
  activity_remarks text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workflow_interoffice_activity (
    request_id, actor_id, actor_office, action_type,
    target_office, from_status, to_status, remarks
  )
  values (
    target_request_id, auth.uid(), public.current_profile_role(), action_name,
    target_office_role, previous_status, next_status,
    nullif(btrim(activity_remarks), '')
  );
end;
$$;

revoke all on function public.record_interoffice_activity(
  uuid, text, text, text, text, text
) from public, anon, authenticated;

create or replace function public.start_interoffice_review(target_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request public.workflow_interoffice_requests;
  step public.workflow_interoffice_steps;
  next_status text;
begin
  select * into request
  from public.workflow_interoffice_requests
  where id = target_request_id
  for update;
  if not found or request.current_office is distinct from public.current_profile_role()
    or request.office_status not in (
      'received', 'returned_for_revision', 'for_forwarding'
    ) then
    raise exception 'This request is not awaiting review by your office';
  end if;
  select * into step
  from public.workflow_interoffice_steps
  where request_id = request.id and office_role = request.current_office
  for update;
  if not found then raise exception 'The current office step is missing'; end if;

  next_status := case
    when step.assessment_required_before_forward and not exists (
      select 1
      from public.workflow_interoffice_documents document
      where document.request_id = request.id
        and document.step_id = step.id
        and document.message_id is null
        and document.document_type = step.required_document_type
        and not exists (
          select 1 from public.workflow_interoffice_documents newer
          where newer.document_group_id = document.document_group_id
            and newer.version_number > document.version_number
        )
    ) then 'assessment_in_progress'
    when step.assessment_required_before_forward then 'for_forwarding'
    else 'under_review'
  end;
  update public.workflow_interoffice_steps
  set status = next_status,
      started_at = coalesce(started_at, timezone('utc', now()))
  where id = step.id;
  update public.workflow_interoffice_requests
  set status = 'pending',
      office_status = next_status,
      updated_at = timezone('utc', now())
  where id = request.id;
  perform public.record_interoffice_activity(
    request.id, 'review_started', null, request.office_status, next_status,
    'Receiving office started reviewing the request.'
  );
  return next_status;
end;
$$;

create or replace function public.forward_interoffice_request(
  target_request_id uuid,
  forwarding_remarks text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request public.workflow_interoffice_requests;
  current_step public.workflow_interoffice_steps;
  next_step public.workflow_interoffice_steps;
begin
  select * into request
  from public.workflow_interoffice_requests
  where id = target_request_id
  for update;
  if not found or request.current_office is distinct from public.current_profile_role()
    or request.office_status not in (
      'under_review', 'assessment_in_progress', 'awaiting_supporting_document',
      'for_forwarding', 'returned_for_revision'
    ) then
    raise exception 'This request is not ready to be forwarded by your office';
  end if;
  select * into current_step
  from public.workflow_interoffice_steps
  where request_id = request.id and office_role = request.current_office
  for update;
  if not found or current_step.is_final_approver then
    raise exception 'The final approval office cannot forward this request';
  end if;

  if current_step.assessment_required_before_forward and not exists (
    select 1
    from public.workflow_interoffice_documents document
    where document.request_id = request.id
      and document.step_id = current_step.id
      and document.message_id is null
      and document.document_type = current_step.required_document_type
      and not exists (
        select 1 from public.workflow_interoffice_documents newer
        where newer.document_group_id = document.document_group_id
          and newer.version_number > document.version_number
      )
  ) then
    update public.workflow_interoffice_steps
    set status = 'awaiting_supporting_document'
    where id = current_step.id;
    update public.workflow_interoffice_requests
    set office_status = 'awaiting_supporting_document', updated_at = timezone('utc', now())
    where id = request.id;
    perform public.record_interoffice_activity(
      request.id, 'awaiting_supporting_document', null, request.office_status,
      'awaiting_supporting_document',
      'Forwarding is blocked until the required ' || current_step.required_document_type || ' is uploaded.'
    );
    return 'awaiting_supporting_document';
  end if;

  select * into next_step
  from public.workflow_interoffice_steps
  where request_id = request.id
    and sequence_number > current_step.sequence_number
  order by sequence_number
  limit 1
  for update;
  if not found then raise exception 'No next receiving office is configured'; end if;

  update public.workflow_interoffice_steps
  set status = 'forwarded',
      decided_at = timezone('utc', now()),
      decided_by = auth.uid(),
      remarks = nullif(btrim(forwarding_remarks), '')
  where id = current_step.id;
  update public.workflow_interoffice_steps
  set status = 'received',
      assigned_at = timezone('utc', now()),
      started_at = null,
      decided_at = null,
      decided_by = null
  where id = next_step.id;
  update public.workflow_interoffice_requests
  set current_office = next_step.office_role,
      status = 'pending',
      office_status = 'received',
      updated_at = timezone('utc', now())
  where id = request.id;
  perform public.record_interoffice_activity(
    request.id, 'forwarded', next_step.office_role, request.office_status, 'forwarded',
    forwarding_remarks
  );
  return 'forwarded';
end;
$$;

create or replace function public.return_interoffice_request(
  target_request_id uuid,
  target_office_role text,
  return_remarks text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request public.workflow_interoffice_requests;
  current_step public.workflow_interoffice_steps;
  target_step public.workflow_interoffice_steps;
begin
  select * into request
  from public.workflow_interoffice_requests
  where id = target_request_id
  for update;
  if not found or request.current_office is distinct from public.current_profile_role()
    or request.office_status not in (
      'under_review', 'assessment_in_progress', 'awaiting_supporting_document',
      'for_forwarding'
    ) or char_length(btrim(coalesce(return_remarks, ''))) not between 1 and 2000 then
    raise exception 'A valid open request and return explanation are required';
  end if;
  select * into current_step
  from public.workflow_interoffice_steps
  where request_id = request.id and office_role = request.current_office
  for update;
  select * into target_step
  from public.workflow_interoffice_steps
  where request_id = request.id
    and office_role = target_office_role
    and sequence_number < current_step.sequence_number
  for update;
  if not found then
    raise exception 'Requests can only be returned to an earlier office in the route';
  end if;

  update public.workflow_interoffice_steps
  set status = 'returned_for_revision',
      decided_at = timezone('utc', now()),
      decided_by = auth.uid(),
      remarks = btrim(return_remarks)
  where id = current_step.id;
  update public.workflow_interoffice_steps
  set status = 'returned_for_revision',
      assigned_at = timezone('utc', now()),
      started_at = null,
      decided_at = null,
      decided_by = null
  where id = target_step.id;
  update public.workflow_interoffice_requests
  set current_office = target_step.office_role,
      status = 'returned_for_revision',
      office_status = 'returned_for_revision',
      updated_at = timezone('utc', now())
  where id = request.id;
  perform public.record_interoffice_activity(
    request.id, 'returned_for_revision', target_step.office_role,
    request.office_status, 'returned_for_revision', return_remarks
  );
  return 'returned_for_revision';
end;
$$;

create or replace function public.decide_interoffice_request(
  target_request_id uuid,
  decision text,
  decision_remarks text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request public.workflow_interoffice_requests;
  step public.workflow_interoffice_steps;
  next_status text;
begin
  if coalesce(decision, '') not in ('approve', 'reject')
    or char_length(btrim(coalesce(decision_remarks, ''))) not between 1 and 2000 then
    raise exception 'Choose approve or reject and provide decision remarks';
  end if;
  select * into request
  from public.workflow_interoffice_requests
  where id = target_request_id
  for update;
  if not found or request.current_office is distinct from public.current_profile_role()
    or request.office_status not in (
      'under_review', 'assessment_in_progress', 'awaiting_supporting_document',
      'for_forwarding', 'returned_for_revision'
    ) then
    raise exception 'This request is not awaiting a decision by your office';
  end if;
  select * into step
  from public.workflow_interoffice_steps
  where request_id = request.id and office_role = request.current_office
  for update;
  if not found or (decision = 'approve' and not step.is_final_approver) then
    raise exception 'Only the configured final approval office can approve the request';
  end if;

  next_status := case when decision = 'approve' then 'completed' else 'rejected' end;
  update public.workflow_interoffice_steps
  set status = case when decision = 'approve' then 'approved' else 'rejected' end,
      decided_at = timezone('utc', now()),
      decided_by = auth.uid(),
      remarks = btrim(decision_remarks)
  where id = step.id;
  update public.workflow_interoffice_requests
  set status = next_status,
      office_status = case when decision = 'approve' then 'approved' else 'rejected' end,
      updated_at = timezone('utc', now()),
      completed_at = case when decision = 'approve' then timezone('utc', now()) else null end
  where id = request.id;
  perform public.record_interoffice_activity(
    request.id,
    case when decision = 'approve' then 'approved' else 'rejected' end,
    null, request.office_status, next_status, decision_remarks
  );
  return next_status;
end;
$$;

revoke all on function public.start_interoffice_review(uuid) from public, anon;
revoke all on function public.forward_interoffice_request(uuid, text) from public, anon;
revoke all on function public.return_interoffice_request(uuid, text, text) from public, anon;
revoke all on function public.decide_interoffice_request(uuid, text, text) from public, anon;
grant execute on function public.start_interoffice_review(uuid) to authenticated;
grant execute on function public.forward_interoffice_request(uuid, text) to authenticated;
grant execute on function public.return_interoffice_request(uuid, text, text) to authenticated;
grant execute on function public.decide_interoffice_request(uuid, text, text) to authenticated;

alter table public.workflow_notifications
  alter column submission_id drop not null,
  add column if not exists interoffice_request_id uuid
    references public.workflow_interoffice_requests(id) on delete cascade;
alter table public.workflow_notifications
  drop constraint if exists workflow_notifications_one_subject_check;
alter table public.workflow_notifications
  add constraint workflow_notifications_one_subject_check
  check (num_nonnulls(submission_id, interoffice_request_id) >= 1);
create index if not exists workflow_notifications_interoffice_request_idx
  on public.workflow_notifications (interoffice_request_id, created_at desc)
  where interoffice_request_id is not null;

create or replace function public.notify_interoffice_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  request public.workflow_interoffice_requests;
  activity_title text;
  activity_message text;
begin
  select * into request
  from public.workflow_interoffice_requests
  where id = new.request_id;

  activity_title := case new.action_type
    when 'request_created' then 'New inter-office request'
    when 'review_started' then 'Inter-office request under review'
    when 'assessment_uploaded' then 'Assessment report uploaded'
    when 'document_uploaded' then 'Supporting document uploaded'
    when 'awaiting_supporting_document' then 'Supporting document required before forwarding'
    when 'message_sent' then 'New inter-office message'
    when 'pending_reminder' then 'Inter-office request awaiting action'
    when 'forwarded' then 'Inter-office request forwarded'
    when 'returned_for_revision' then 'Inter-office request returned'
    when 'approved' then 'Inter-office request approved'
    when 'rejected' then 'Inter-office request rejected'
    when 'completed' then 'Inter-office request completed'
    else 'Inter-office request updated'
  end;
  activity_message := request.reference_number || ' — ' || request.title
    || case when new.remarks is not null then ': ' || new.remarks else '' end;

  insert into public.workflow_notifications (
    recipient_id, submission_id, interoffice_request_id, event_type, title, message
  )
  select distinct recipient.id, request.related_submission_id,
    request.id, new.action_type || ':' || new.id::text, activity_title,
    activity_message
  from public.profiles recipient
  where recipient.is_active
    and (new.actor_id is null or recipient.id <> new.actor_id)
    and (
      recipient.id = request.created_by
      or recipient.role = request.requesting_office
      or recipient.role = new.target_office
      or (
        new.action_type in ('message_sent', 'document_uploaded', 'assessment_uploaded')
        and exists (
          select 1 from public.workflow_interoffice_steps participant
          where participant.request_id = request.id
            and participant.office_role = recipient.role
        )
      )
      or (
        new.action_type in ('approved', 'rejected', 'completed')
        and request.related_submission_id is not null
        and recipient.id = (
          select submission.user_id
          from public.workflow_submissions submission
          where submission.id = request.related_submission_id
        )
      )
    );

  return new;
end;
$$;

revoke all on function public.notify_interoffice_activity() from public, anon, authenticated;
drop trigger if exists notify_interoffice_activity
  on public.workflow_interoffice_activity;
create trigger notify_interoffice_activity
after insert on public.workflow_interoffice_activity
for each row execute function public.notify_interoffice_activity();

create or replace function public.send_interoffice_pending_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_request public.workflow_interoffice_requests;
  reminder_count integer := 0;
  last_activity_at timestamptz;
begin
  for pending_request in
    select request.*
    from public.workflow_interoffice_requests request
    where request.status not in ('approved', 'rejected', 'completed')
      and (
        request.last_reminded_at is null
        or request.last_reminded_at <= timezone('utc', now()) - interval '24 hours'
      )
      and coalesce(
        (
          select max(activity.created_at)
          from public.workflow_interoffice_activity activity
          where activity.request_id = request.id
        ),
        request.updated_at
      ) <= timezone('utc', now()) - interval '24 hours'
    order by request.updated_at
    for update skip locked
  loop
    select coalesce(max(activity.created_at), pending_request.updated_at)
      into last_activity_at
    from public.workflow_interoffice_activity activity
    where activity.request_id = pending_request.id;

    update public.workflow_interoffice_requests
    set last_reminded_at = timezone('utc', now())
    where id = pending_request.id;

    insert into public.workflow_interoffice_activity (
      request_id, actor_id, actor_office, action_type, target_office,
      from_status, to_status, remarks
    )
    values (
      pending_request.id, null, null, 'pending_reminder',
      pending_request.current_office,
      pending_request.office_status, pending_request.office_status,
      'No activity since ' || to_char(last_activity_at, 'YYYY-MM-DD HH24:MI UTC')
    );
    reminder_count := reminder_count + 1;
  end loop;
  return reminder_count;
end;
$$;

revoke all on function public.send_interoffice_pending_reminders() from public, anon, authenticated;

create or replace function public.record_interoffice_document_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  request public.workflow_interoffice_requests;
  next_office text;
  action_name text;
  next_office_status text;
begin
  select * into request
  from public.workflow_interoffice_requests
  where id = new.request_id;
  select step.office_role into next_office
  from public.workflow_interoffice_steps current_step
  join public.workflow_interoffice_steps step
    on step.request_id = current_step.request_id
   and step.sequence_number = current_step.sequence_number + 1
  where current_step.id = new.step_id;
  action_name := case
    when new.document_type in ('assessment_report', 'financial_assessment', 'technical_review')
      then 'assessment_uploaded'
    else 'document_uploaded'
  end;
  next_office_status := request.office_status;
  if new.message_id is null and exists (
    select 1
    from public.workflow_interoffice_steps step
    where step.id = new.step_id
      and step.assessment_required_before_forward
      and step.required_document_type = new.document_type
  ) then
    next_office_status := 'for_forwarding';
    update public.workflow_interoffice_steps
    set status = 'for_forwarding'
    where id = new.step_id;
    update public.workflow_interoffice_requests
    set office_status = 'for_forwarding',
        updated_at = timezone('utc', now())
    where id = new.request_id;
  end if;
  insert into public.workflow_interoffice_activity (
    request_id, actor_id, actor_office, action_type, target_office,
    from_status, to_status, remarks
  )
  values (
    new.request_id, new.uploaded_by, new.uploading_office, action_name,
    coalesce(next_office, request.requesting_office),
    request.office_status, next_office_status,
    new.document_type || ' uploaded: ' || new.file_name
      || ' (version ' || new.version_number::text || ')'
  );
  return new;
end;
$$;

revoke all on function public.record_interoffice_document_activity() from public, anon, authenticated;
drop trigger if exists record_interoffice_document_activity
  on public.workflow_interoffice_documents;
create trigger record_interoffice_document_activity
after insert on public.workflow_interoffice_documents
for each row execute function public.record_interoffice_document_activity();

create or replace function public.record_interoffice_message_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  request public.workflow_interoffice_requests;
begin
  select * into request from public.workflow_interoffice_requests where id = new.request_id;
  insert into public.workflow_interoffice_activity (
    request_id, actor_id, actor_office, action_type, target_office,
    from_status, to_status, remarks
  )
  values (
    new.request_id, new.sender_id, new.sender_office, 'message_sent',
    new.recipient_office, request.office_status, request.office_status,
    'New message from ' || new.sender_name
  );
  return new;
end;
$$;

revoke all on function public.record_interoffice_message_activity() from public, anon, authenticated;
drop trigger if exists record_interoffice_message_activity
  on public.workflow_interoffice_messages;
create trigger record_interoffice_message_activity
after insert on public.workflow_interoffice_messages
for each row execute function public.record_interoffice_message_activity();

create or replace function public.queue_workflow_notification_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
  where profile.id = new.recipient_id;
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
      when 'admin' then '/workflow/admin/submissions/' || new.submission_id::text
      when 'approver' then '/workflow/approver/file_management/' || new.submission_id::text
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
$$;

drop trigger if exists queue_workflow_notification_email
  on public.workflow_notifications;
create trigger queue_workflow_notification_email
after insert on public.workflow_notifications
for each row execute function public.queue_workflow_notification_email();

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'workflow_interoffice_files',
  'workflow_interoffice_files',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_access_interoffice_file(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when split_part(object_name, '/', 1) ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.can_access_interoffice_request(split_part(object_name, '/', 1)::uuid)
    else false
  end
$$;

revoke all on function public.can_access_interoffice_file(text) from public;
grant execute on function public.can_access_interoffice_file(text) to authenticated;

drop policy if exists "Authorized offices can read interoffice files" on storage.objects;
create policy "Authorized offices can read interoffice files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'workflow_interoffice_files'
    and public.can_access_interoffice_file(name)
  );

drop policy if exists "Current offices can upload interoffice files" on storage.objects;
create policy "Current offices can upload interoffice files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'workflow_interoffice_files'
    and split_part(name, '/', 1) ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.can_upload_interoffice_request_file(
      split_part(name, '/', 1)::uuid,
      name
    )
  );

drop policy if exists "Uploader can remove unlinked interoffice files" on storage.objects;
create policy "Uploader can remove unlinked interoffice files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'workflow_interoffice_files'
    and split_part(name, '/', 2) = auth.uid()::text
    and not exists (
      select 1
      from public.workflow_interoffice_documents document
      where document.file_path = name
    )
  );

do $publication$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'workflow_interoffice_requests'
    ) then
      alter publication supabase_realtime add table public.workflow_interoffice_requests;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'workflow_interoffice_messages'
    ) then
      alter publication supabase_realtime add table public.workflow_interoffice_messages;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'workflow_interoffice_documents'
    ) then
      alter publication supabase_realtime add table public.workflow_interoffice_documents;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'workflow_interoffice_activity'
    ) then
      alter publication supabase_realtime add table public.workflow_interoffice_activity;
    end if;
  end if;
end;
$publication$;

create extension if not exists pg_cron with schema pg_catalog;

do $schedule_reminders$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'interoffice-pending-reminders';

  perform cron.schedule(
    'interoffice-pending-reminders',
    '0 * * * *',
    'select public.send_interoffice_pending_reminders();'
  );
end;
$schedule_reminders$;
