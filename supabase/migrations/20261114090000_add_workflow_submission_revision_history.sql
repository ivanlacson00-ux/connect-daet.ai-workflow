begin;

alter table public.workflow_submissions
  add column if not exists current_revision_id uuid,
  add column if not exists reopen_count integer not null default 0,
  add column if not exists closure_reason text,
  add column if not exists closed_at timestamptz,
  add column if not exists change_request_repair_needed boolean not null default false;

alter table public.workflow_submissions
  drop constraint if exists workflow_submissions_reopen_count_check,
  drop constraint if exists workflow_submissions_closure_reason_check;

alter table public.workflow_submissions
  add constraint workflow_submissions_reopen_count_check
    check (reopen_count in (0, 1)),
  add constraint workflow_submissions_closure_reason_check
    check (closure_reason is null or closure_reason in ('changes_requested', 'closed_by_submitter'));

alter table public.workflow_audit_logs
  add column if not exists revision_id uuid,
  add column if not exists payload jsonb;

create table if not exists public.workflow_submission_revisions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.workflow_submissions(id) on delete cascade,
  revision_no integer not null check (revision_no > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  submitter_message text check (
    submitter_message is null or length(submitter_message) <= 4000
  ),
  form_snapshot jsonb check (
    form_snapshot is null or pg_column_size(form_snapshot) <= 65536
  ),
  backfill_quality text not null default 'complete'
    check (backfill_quality in ('complete', 'partial')),
  unique (submission_id, revision_no),
  unique (submission_id, id)
);

create index if not exists workflow_submission_revisions_submission_idx
  on public.workflow_submission_revisions (submission_id, revision_no);

create table if not exists public.workflow_revision_files (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.workflow_submission_revisions(id) on delete cascade,
  logical_file_id uuid not null,
  file_role text not null check (file_role in ('primary', 'supporting')),
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  storage_path text not null check (length(btrim(storage_path)) between 1 and 2048),
  file_type text,
  file_size bigint not null check (file_size >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-fA-F]{64}$'),
  change_kind text not null check (
    change_kind in ('added', 'replaced', 'carried', 'removed')
  ),
  prior_revision_file_id uuid references public.workflow_revision_files(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  check (
    (change_kind = 'added' and prior_revision_file_id is null)
    or (change_kind <> 'added' and prior_revision_file_id is not null)
  ),
  unique (revision_id, logical_file_id)
);

create unique index if not exists workflow_revision_files_one_primary_per_revision_idx
  on public.workflow_revision_files (revision_id)
  where file_role = 'primary';

create index if not exists workflow_revision_files_storage_path_idx
  on public.workflow_revision_files (storage_path);

create table if not exists public.workflow_change_requests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.workflow_submissions(id) on delete cascade,
  requested_by_office text not null check (
    requested_by_office in (
      'tourism_officer',
      'municipal_treasurer',
      'mayor_office',
      'sangguniang_bayan',
      'approver'
    )
  ),
  requested_by_user uuid references public.profiles(id) on delete set null,
  message text not null check (length(btrim(message)) between 1 and 10000),
  against_revision_id uuid not null,
  status text not null default 'open'
    check (status in ('open', 'fulfilled', 'abandoned')),
  fulfilled_by_revision_id uuid,
  source_audit_event_id uuid unique references public.workflow_audit_logs(id) on delete set null,
  backfill_quality text not null default 'complete'
    check (backfill_quality in ('complete', 'partial')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (
    (status = 'fulfilled' and fulfilled_by_revision_id is not null)
    or (status in ('open', 'abandoned') and fulfilled_by_revision_id is null)
  ),
  constraint workflow_change_requests_against_revision_fkey
    foreign key (submission_id, against_revision_id)
    references public.workflow_submission_revisions(submission_id, id)
    on delete cascade,
  constraint workflow_change_requests_fulfilled_revision_fkey
    foreign key (submission_id, fulfilled_by_revision_id)
    references public.workflow_submission_revisions(submission_id, id)
    on delete cascade
);

create unique index if not exists workflow_change_requests_one_open_per_submission_idx
  on public.workflow_change_requests (submission_id)
  where status = 'open';

create index if not exists workflow_change_requests_submission_created_idx
  on public.workflow_change_requests (submission_id, created_at);

with version_rows as (
  select
    version.*,
    row_number() over (
      partition by version.submission_id
      order by version.version_number, version.created_at, version.id
    ) as revision_no
  from public.workflow_submission_versions version
)
insert into public.workflow_submission_revisions (
  id, submission_id, revision_no, created_by, created_at, form_snapshot, backfill_quality
)
select
  md5(version_rows.submission_id::text || ':revision:' || version_rows.revision_no::text)::uuid,
  version_rows.submission_id,
  version_rows.revision_no,
  version_rows.uploaded_by,
  version_rows.created_at,
  null,
  'partial'
from version_rows
on conflict (submission_id, revision_no) do nothing;

insert into public.workflow_submission_revisions (
  id, submission_id, revision_no, created_by, created_at, form_snapshot, backfill_quality
)
select
  md5(submission.id::text || ':revision:1')::uuid,
  submission.id,
  1,
  submission.user_id,
  submission.created_at,
  null,
  'partial'
from public.workflow_submissions submission
where not exists (
  select 1
  from public.workflow_submission_revisions revision
  where revision.submission_id = submission.id
)
on conflict (submission_id, revision_no) do nothing;

with latest_versions as (
  select distinct on (version.submission_id)
    version.submission_id,
    version.file_path
  from public.workflow_submission_versions version
  order by version.submission_id, version.version_number desc, version.created_at desc, version.id desc
),
untracked_current_files as (
  select
    submission.id as submission_id,
    submission.user_id,
    submission.created_at,
    submission.file_name,
    submission.file_path,
    submission.file_type,
    submission.file_size,
    coalesce(max(revision.revision_no), 0) + 1 as revision_no
  from public.workflow_submissions submission
  join latest_versions latest on latest.submission_id = submission.id
  join public.workflow_submission_revisions revision
    on revision.submission_id = submission.id
  where submission.file_path is not null
    and submission.file_path is distinct from latest.file_path
  group by
    submission.id,
    submission.user_id,
    submission.created_at,
    submission.file_name,
    submission.file_path,
    submission.file_type,
    submission.file_size
)
insert into public.workflow_submission_revisions (
  id, submission_id, revision_no, created_by, created_at, form_snapshot, backfill_quality
)
select
  md5(untracked_current_files.submission_id::text || ':revision:' || untracked_current_files.revision_no::text)::uuid,
  untracked_current_files.submission_id,
  untracked_current_files.revision_no,
  untracked_current_files.user_id,
  untracked_current_files.created_at,
  null,
  'partial'
from untracked_current_files
on conflict (submission_id, revision_no) do nothing;

with version_rows as (
  select
    version.*,
    row_number() over (
      partition by version.submission_id
      order by version.version_number, version.created_at, version.id
    ) as revision_no
  from public.workflow_submission_versions version
)
insert into public.workflow_revision_files (
  id, revision_id, logical_file_id, file_role, file_name, storage_path,
  file_type, file_size, change_kind, prior_revision_file_id, uploaded_by, created_at
)
select
  md5(version_rows.submission_id::text || ':revision-file:primary:' || version_rows.revision_no::text)::uuid,
  md5(version_rows.submission_id::text || ':revision:' || version_rows.revision_no::text)::uuid,
  md5(version_rows.submission_id::text || ':logical-primary')::uuid,
  'primary',
  version_rows.file_name,
  version_rows.file_path,
  version_rows.file_type,
  version_rows.file_size,
  case when version_rows.revision_no = 1 then 'added' else 'replaced' end,
  case
    when version_rows.revision_no > 1 then
      md5(version_rows.submission_id::text || ':revision-file:primary:' || (version_rows.revision_no - 1)::text)::uuid
    else null
  end,
  version_rows.uploaded_by,
  version_rows.created_at
from version_rows
on conflict (revision_id, logical_file_id) do nothing;

insert into public.workflow_revision_files (
  id, revision_id, logical_file_id, file_role, file_name, storage_path,
  file_type, file_size, change_kind, uploaded_by, created_at
)
select
  md5(submission.id::text || ':revision-file:primary:1')::uuid,
  md5(submission.id::text || ':revision:1')::uuid,
  md5(submission.id::text || ':logical-primary')::uuid,
  'primary',
  submission.file_name,
  submission.file_path,
  submission.file_type,
  coalesce(submission.file_size, 0),
  'added',
  submission.user_id,
  submission.created_at
from public.workflow_submissions submission
where submission.file_name is not null
  and submission.file_path is not null
  and not exists (
    select 1
    from public.workflow_submission_versions version
    where version.submission_id = submission.id
  )
on conflict (revision_id, logical_file_id) do nothing;

with latest_versions as (
  select distinct on (version.submission_id)
    version.submission_id,
    version.file_path
  from public.workflow_submission_versions version
  order by version.submission_id, version.version_number desc, version.created_at desc, version.id desc
),
untracked_current_files as (
  select
    submission.id as submission_id,
    submission.user_id,
    submission.created_at,
    submission.file_name,
    submission.file_path,
    submission.file_type,
    submission.file_size,
    coalesce(max(revision.revision_no), 0) + 1 as revision_no
  from public.workflow_submissions submission
  join latest_versions latest on latest.submission_id = submission.id
  join public.workflow_submission_revisions revision
    on revision.submission_id = submission.id
  where submission.file_path is not null
    and submission.file_path is distinct from latest.file_path
  group by
    submission.id,
    submission.user_id,
    submission.created_at,
    submission.file_name,
    submission.file_path,
    submission.file_type,
    submission.file_size
)
insert into public.workflow_revision_files (
  id, revision_id, logical_file_id, file_role, file_name, storage_path,
  file_type, file_size, change_kind, prior_revision_file_id, uploaded_by, created_at
)
select
  md5(untracked_current_files.submission_id::text || ':revision-file:primary:' || untracked_current_files.revision_no::text)::uuid,
  md5(untracked_current_files.submission_id::text || ':revision:' || untracked_current_files.revision_no::text)::uuid,
  md5(untracked_current_files.submission_id::text || ':logical-primary')::uuid,
  'primary',
  coalesce(
    nullif(btrim(untracked_current_files.file_name), ''),
    regexp_replace(untracked_current_files.file_path, '^.*/', '')
  ),
  untracked_current_files.file_path,
  untracked_current_files.file_type,
  coalesce(untracked_current_files.file_size, 0),
  'replaced',
  md5(untracked_current_files.submission_id::text || ':revision-file:primary:' || (untracked_current_files.revision_no - 1)::text)::uuid,
  untracked_current_files.user_id,
  untracked_current_files.created_at
from untracked_current_files
on conflict (revision_id, logical_file_id) do nothing;

with latest_revisions as (
  select distinct on (revision.submission_id)
    revision.submission_id,
    revision.id,
    revision.revision_no
  from public.workflow_submission_revisions revision
  order by revision.submission_id, revision.revision_no desc
)
insert into public.workflow_revision_files (
  id, revision_id, logical_file_id, file_role, file_name, storage_path,
  file_type, file_size, change_kind, uploaded_by, created_at
)
select
  md5(attachment.id::text || ':revision-file')::uuid,
  revision.id,
  attachment.id,
  'supporting',
  attachment.file_name,
  attachment.file_path,
  attachment.file_type,
  attachment.file_size,
  'added',
  attachment.uploaded_by,
  attachment.created_at
from public.workflow_submission_attachments attachment
join latest_revisions revision on revision.submission_id = attachment.submission_id
on conflict (revision_id, logical_file_id) do nothing;

with latest_revisions as (
  select distinct on (revision.submission_id)
    revision.submission_id,
    revision.id
  from public.workflow_submission_revisions revision
  order by revision.submission_id, revision.revision_no desc
)
update public.workflow_submissions submission
set current_revision_id = revision.id
from latest_revisions revision
where revision.submission_id = submission.id;

update public.workflow_submissions submission
set reopen_count = case
  when exists (
    select 1
    from public.workflow_audit_logs log
    where log.submission_id = submission.id
      and log.action_type in (
        'SUBMISSION_REOPENED',
        'CHANGES_RESPONDED',
        'REQUIREMENTS_RESUBMITTED'
      )
  ) or exists (
    select 1
    from public.workflow_submission_versions version
    where version.submission_id = submission.id
      and version.version_number > 1
  ) then 1
  else 0
end;

with latest_request_event as (
  select distinct on (submission.id)
    submission.id as submission_id,
    submission.selected_office_role,
    submission.initial_destination_role,
    submission.current_revision_id,
    log.id as audit_event_id,
    log.action_by,
    nullif(btrim(log.comments), '') as message,
    log.created_at
  from public.workflow_submissions submission
  join public.workflow_audit_logs log
    on log.submission_id = submission.id
   and log.action_type in ('CHANGES_REQUESTED', 'ROUTE_REQUIREMENTS_REQUESTED')
  where submission.status in ('changes_requested', 'returned_for_requirements')
  order by submission.id, log.created_at desc, log.id desc
),
valid_request_events as (
  select
    event.*,
    coalesce(event.selected_office_role, event.initial_destination_role) as requested_by_office
  from latest_request_event event
  where event.message is not null
    and length(event.message) <= 10000
    and event.current_revision_id is not null
    and coalesce(event.selected_office_role, event.initial_destination_role) in (
      'tourism_officer',
      'municipal_treasurer',
      'mayor_office',
      'sangguniang_bayan',
      'approver'
    )
)
insert into public.workflow_change_requests (
  id, submission_id, requested_by_office, requested_by_user, message,
  against_revision_id, status, source_audit_event_id, backfill_quality, created_at, updated_at
)
select
  md5(event.submission_id::text || ':change-request:' || event.audit_event_id::text)::uuid,
  event.submission_id,
  event.requested_by_office,
  event.action_by,
  event.message,
  event.current_revision_id,
  'open',
  event.audit_event_id,
  'partial',
  event.created_at,
  event.created_at
from valid_request_events event
on conflict (source_audit_event_id) do nothing;

update public.workflow_submissions submission
set closure_reason = 'changes_requested',
    closed_at = coalesce(
      (
        select request.created_at
        from public.workflow_change_requests request
        where request.submission_id = submission.id
          and request.status = 'open'
        order by request.created_at desc
        limit 1
      ),
      submission.closed_at
    ),
    change_request_repair_needed = not exists (
      select 1
      from public.workflow_change_requests request
      where request.submission_id = submission.id
        and request.status = 'open'
    )
where submission.status in ('changes_requested', 'returned_for_requirements');

create or replace function public.is_active_workflow_account()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles profile
    join auth.users account on account.id = profile.id
    where profile.id = auth.uid()
      and profile.is_active
      and (account.banned_until is null or account.banned_until <= timezone('utc', now()))
  )
$$;

revoke all on function public.is_active_workflow_account() from public, anon;
grant execute on function public.is_active_workflow_account() to authenticated;

create or replace function public.guard_workflow_revision_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.workflow_authorized_revision_transition', true) is distinct from 'on'
    and (
      (
        tg_op = 'INSERT'
        and (
          new.current_revision_id is not null
          or new.reopen_count <> 0
          or new.closure_reason is not null
          or new.closed_at is not null
          or new.change_request_repair_needed
        )
      )
      or (
        tg_op = 'UPDATE'
        and (
          new.current_revision_id is distinct from old.current_revision_id
          or new.reopen_count is distinct from old.reopen_count
          or new.closure_reason is distinct from old.closure_reason
          or new.closed_at is distinct from old.closed_at
          or new.change_request_repair_needed is distinct from old.change_request_repair_needed
        )
      )
    ) then
    raise exception 'Revision metadata can only be changed by an authorized workflow transition';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_workflow_revision_metadata
  on public.workflow_submissions;
create trigger guard_workflow_revision_metadata
before insert or update on public.workflow_submissions
for each row
execute function public.guard_workflow_revision_metadata();

alter table public.workflow_submissions
  drop constraint if exists workflow_submissions_current_revision_id_fkey;

alter table public.workflow_submissions
  add constraint workflow_submissions_current_revision_id_fkey
  foreign key (current_revision_id)
  references public.workflow_submission_revisions(id)
  on delete set null;

alter table public.workflow_audit_logs
  drop constraint if exists workflow_audit_logs_revision_id_fkey;

alter table public.workflow_audit_logs
  add constraint workflow_audit_logs_revision_id_fkey
  foreign key (revision_id)
  references public.workflow_submission_revisions(id)
  on delete set null;

create index if not exists workflow_audit_logs_revision_id_idx
  on public.workflow_audit_logs (revision_id)
  where revision_id is not null;

alter table public.workflow_submission_revisions enable row level security;
alter table public.workflow_revision_files enable row level security;
alter table public.workflow_change_requests enable row level security;

revoke all on public.workflow_submission_revisions from anon, authenticated;
revoke all on public.workflow_revision_files from anon, authenticated;
revoke all on public.workflow_change_requests from anon, authenticated;
grant select on public.workflow_submission_revisions to authenticated;
grant select on public.workflow_revision_files to authenticated;
grant select on public.workflow_change_requests to authenticated;

drop policy if exists "Authorized users can view submission revisions"
  on public.workflow_submission_revisions;
create policy "Authorized users can view submission revisions"
  on public.workflow_submission_revisions
  for select to authenticated
  using (
    public.is_active_workflow_account()
    and exists (
      select 1
      from public.workflow_submissions submission
      where submission.id = workflow_submission_revisions.submission_id
        and (
          submission.user_id = auth.uid()
          or public.is_workflow_admin()
          or public.is_submission_assigned_to_current_office(submission.id)
        )
    )
  );

drop policy if exists "Authorized users can view revision files"
  on public.workflow_revision_files;
create policy "Authorized users can view revision files"
  on public.workflow_revision_files
  for select to authenticated
  using (
    public.is_active_workflow_account()
    and exists (
      select 1
      from public.workflow_submission_revisions revision
      join public.workflow_submissions submission
        on submission.id = revision.submission_id
      where revision.id = workflow_revision_files.revision_id
        and (
          submission.user_id = auth.uid()
          or public.is_workflow_admin()
          or public.is_submission_assigned_to_current_office(submission.id)
        )
    )
  );

drop policy if exists "Authorized users can view change requests"
  on public.workflow_change_requests;
create policy "Authorized users can view change requests"
  on public.workflow_change_requests
  for select to authenticated
  using (
    public.is_active_workflow_account()
    and exists (
      select 1
      from public.workflow_submissions submission
      where submission.id = workflow_change_requests.submission_id
        and (
          submission.user_id = auth.uid()
          or public.is_workflow_admin()
          or public.is_submission_assigned_to_current_office(submission.id)
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
      or exists (
        select 1
        from public.workflow_revision_files revision_file
        join public.workflow_submission_revisions revision
          on revision.id = revision_file.revision_id
        where revision.submission_id = submission.id
          and revision_file.storage_path = object_name
      )
    )
      and (
        submission.user_id = auth.uid()
        or public.is_workflow_admin()
        or public.is_submission_assigned_to_current_office(submission.id)
      )
      and public.is_active_workflow_account()
  )
$$;

drop policy if exists "Workflow users can read uploaded files" on storage.objects;
create policy "Workflow users can read uploaded files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'workflow_uploads'
    and public.is_active_workflow_account()
    and (
      name like (auth.uid()::text || '/%')
      or public.is_workflow_admin()
      or public.is_workflow_file_accessible(name)
    )
  );

create or replace function public.get_workflow_submission_detail(target_submission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  submission public.workflow_submissions;
  detail jsonb;
begin
  if not public.is_active_workflow_account() then
    raise exception 'An active account profile is required';
  end if;

  select *
    into submission
  from public.workflow_submissions target
  where target.id = target_submission_id;

  if not found
    or not (
      submission.user_id = auth.uid()
      or public.is_workflow_admin()
      or public.is_submission_assigned_to_current_office(submission.id)
    ) then
    raise exception 'Submission not found or not available to this account';
  end if;

  select jsonb_build_object(
    'submission', jsonb_build_object(
      'id', submission.id,
      'tracking_number', submission.tracking_number,
      'file_name', submission.file_name,
      'file_path', submission.file_path,
      'file_type', submission.file_type,
      'file_size', submission.file_size,
      'status', submission.status,
      'category', submission.category,
      'other_document_type', submission.other_document_type,
      'description', submission.description,
      'purpose', submission.purpose,
      'requested_action', submission.requested_action,
      'intended_recipient', submission.intended_recipient,
      'initial_destination_role', submission.initial_destination_role,
      'selected_office_role', submission.selected_office_role,
      'current_revision_id', submission.current_revision_id,
      'reopen_count', submission.reopen_count,
      'closure_reason', submission.closure_reason,
      'closed_at', submission.closed_at,
      'change_request_repair_needed', submission.change_request_repair_needed,
      'received_at', submission.received_at,
      'completed_at', submission.completed_at,
      'created_at', submission.created_at,
      'closed_by', submission.closed_by,
      'closure_note', submission.closure_note,
      'closure_file_path', submission.closure_file_path,
      'closure_file_name', submission.closure_file_name,
      'closure_file_type', submission.closure_file_type,
      'closure_file_size', submission.closure_file_size,
      'final_decision_office_role', submission.final_decision_office_role,
      'final_decided_at', submission.final_decided_at,
      'approved_at', submission.approved_at,
      'rejected_at', submission.rejected_at
    ),
    'sender', (
      select jsonb_build_object(
        'full_name', profile.full_name,
        'email', profile.email,
        'role', profile.role
      )
      from public.profiles profile
      where profile.id = submission.user_id
    ),
    'current_route', (
      select jsonb_build_object(
        'id', plan.id,
        'status', plan.status,
        'is_current', plan.is_current,
        'version', plan.version,
        'steps', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', step.id,
              'sequence_number', step.sequence_number,
              'office_role', step.office_role,
              'status', step.status,
              'responsibility', step.responsibility,
              'assignment_source', step.assignment_source,
              'assigned_at', step.assigned_at,
              'started_at', step.started_at,
              'decided_at', step.decided_at,
              'completed_at', step.completed_at,
              'outcome', step.outcome
            )
            order by step.sequence_number
          )
          from public.workflow_routing_steps step
          where step.routing_plan_id = plan.id
        ), '[]'::jsonb)
      )
      from public.workflow_routing_plans plan
      where plan.submission_id = submission.id
        and plan.is_current
      order by plan.version desc
      limit 1
    ),
    'supporting_files', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', attachment.id,
          'file_name', attachment.file_name,
          'file_path', attachment.file_path,
          'file_type', attachment.file_type,
          'file_size', attachment.file_size,
          'created_at', attachment.created_at
        )
        order by attachment.created_at, attachment.id
      )
      from public.workflow_submission_attachments attachment
      where attachment.submission_id = submission.id
    ), '[]'::jsonb),
    'revisions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', revision.id,
          'revision_no', revision.revision_no,
          'created_at', revision.created_at,
          'submitter_message', revision.submitter_message,
          'form_snapshot', revision.form_snapshot,
          'backfill_quality', revision.backfill_quality,
          'files', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', revision_file.id,
                'logical_file_id', revision_file.logical_file_id,
                'file_role', revision_file.file_role,
                'file_name', revision_file.file_name,
                'storage_path', revision_file.storage_path,
                'file_type', revision_file.file_type,
                'file_size', revision_file.file_size,
                'change_kind', revision_file.change_kind,
                'prior_revision_file_id', revision_file.prior_revision_file_id,
                'created_at', revision_file.created_at
              )
              order by revision_file.file_role, revision_file.created_at, revision_file.id
            )
            from public.workflow_revision_files revision_file
            where revision_file.revision_id = revision.id
          ), '[]'::jsonb)
        )
        order by revision.revision_no
      )
      from public.workflow_submission_revisions revision
      where revision.submission_id = submission.id
    ), '[]'::jsonb),
    'change_requests', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', request.id,
          'requested_by_office', request.requested_by_office,
          'message', request.message,
          'against_revision_id', request.against_revision_id,
          'status', request.status,
          'fulfilled_by_revision_id', request.fulfilled_by_revision_id,
          'source_audit_event_id', request.source_audit_event_id,
          'backfill_quality', request.backfill_quality,
          'created_at', request.created_at,
          'updated_at', request.updated_at
        )
        order by request.created_at, request.id
      )
      from public.workflow_change_requests request
      where request.submission_id = submission.id
    ), '[]'::jsonb),
    'audit_events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', log.id,
          'action_type', log.action_type,
          'old_status', log.old_status,
          'new_status', log.new_status,
          'comments', log.comments,
          'created_at', log.created_at
        )
        order by log.created_at, log.id
      )
      from public.workflow_audit_logs log
      where log.submission_id = submission.id
        and log.action_type in (
          'CHANGES_REQUESTED',
          'CHANGES_RESPONDED',
          'SUBMISSION_REOPENED',
          'ROUTE_REQUIREMENTS_REQUESTED',
          'REQUIREMENTS_RESUBMITTED'
        )
    ), '[]'::jsonb)
  )
  into detail;

  return detail;
end;
$$;

revoke all on function public.get_workflow_submission_detail(uuid) from public, anon;
grant execute on function public.get_workflow_submission_detail(uuid) to authenticated;

create or replace function public.admin_delete_workflow_submission(
  target_submission_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.workflow_submissions;
  upload_paths text[] := array[]::text[];
  message_paths text[] := array[]::text[];
  legacy_paths text[];
begin
  if auth.uid() is null or not public.is_workflow_admin() then
    raise exception 'Only an administrator can permanently delete a submission';
  end if;

  select * into submission
  from public.workflow_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'Submission not found';
  end if;

  select coalesce(array_agg(distinct file_path), array[]::text[])
  into upload_paths
  from (
    select submission.file_path as file_path
    union all
    select submission.closure_file_path
    union all
    select attachment.file_path
    from public.workflow_submission_attachments attachment
    where attachment.submission_id = target_submission_id
    union all
    select version.file_path
    from public.workflow_submission_versions version
    where version.submission_id = target_submission_id
    union all
    select revision_file.storage_path
    from public.workflow_revision_files revision_file
    join public.workflow_submission_revisions revision
      on revision.id = revision_file.revision_id
    where revision.submission_id = target_submission_id
  ) files
  where file_path is not null and btrim(file_path) <> '';

  select coalesce(array_agg(distinct attachment.file_path), array[]::text[])
  into message_paths
  from public.workflow_message_attachments attachment
  where attachment.submission_id = target_submission_id;

  if to_regclass('public.document_versions') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'document_versions'
        and column_name = 'file_path'
    ) then
    execute $query$
      select coalesce(array_agg(distinct file_path), array[]::text[])
      from public.document_versions
      where submission_id = $1 and file_path is not null and btrim(file_path) <> ''
    $query$
      into legacy_paths
      using target_submission_id;
    upload_paths := upload_paths || coalesce(legacy_paths, array[]::text[]);
  end if;

  if to_regclass('public.approval_steps') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'approval_steps'
        and column_name = 'evidence_file_path'
    ) then
    execute $query$
      select coalesce(array_agg(distinct evidence_file_path), array[]::text[])
      from public.approval_steps
      where submission_id = $1
        and evidence_file_path is not null
        and btrim(evidence_file_path) <> ''
    $query$
      into legacy_paths
      using target_submission_id;
    upload_paths := upload_paths || coalesce(legacy_paths, array[]::text[]);
  end if;

  if to_regclass('public.workflow_email_outbox') is not null then
    execute
      'delete from public.workflow_email_outbox ' ||
      'where notification_id in (' ||
      '  select id from public.workflow_notifications where submission_id = $1' ||
      ')'
      using target_submission_id;
  end if;

  if to_regclass('public.approval_steps') is not null then
    execute 'delete from public.approval_steps where submission_id = $1'
      using target_submission_id;
  end if;
  if to_regclass('public.document_messages') is not null then
    execute 'delete from public.document_messages where submission_id = $1'
      using target_submission_id;
  end if;
  if to_regclass('public.document_versions') is not null then
    execute 'delete from public.document_versions where submission_id = $1'
      using target_submission_id;
  end if;
  if to_regclass('public.points_ledger') is not null then
    execute 'delete from public.points_ledger where submission_id = $1'
      using target_submission_id;
  end if;

  delete from public.workflow_audit_logs
  where submission_id = target_submission_id;
  delete from public.workflow_notifications
  where submission_id = target_submission_id;
  delete from public.workflow_submissions
  where id = target_submission_id;

  return jsonb_build_object(
    'workflow_uploads', to_jsonb(upload_paths),
    'workflow_message_attachments', to_jsonb(message_paths)
  );
end;
$$;

revoke all on function public.admin_delete_workflow_submission(uuid)
  from public, anon;
grant execute on function public.admin_delete_workflow_submission(uuid)
  to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'workflow_submission_revisions'
    ) then
      alter publication supabase_realtime add table public.workflow_submission_revisions;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'workflow_revision_files'
    ) then
      alter publication supabase_realtime add table public.workflow_revision_files;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'workflow_change_requests'
    ) then
      alter publication supabase_realtime add table public.workflow_change_requests;
    end if;
  end if;
end;
$$;

commit;
