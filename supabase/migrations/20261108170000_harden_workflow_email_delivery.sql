alter table public.workflow_email_outbox
  add column if not exists status text not null default 'queued',
  add column if not exists accepted_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists claimed_by uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists provider_message_id text,
  add column if not exists provider_event_data jsonb,
  add column if not exists last_provider_event_at timestamptz,
  add column if not exists is_retryable boolean not null default true,
  add column if not exists last_updated_at timestamptz not null default timezone('utc', now());

update public.workflow_email_outbox
set status = case when sent_at is null then 'queued' else 'accepted' end,
    accepted_at = coalesce(accepted_at, sent_at),
    next_attempt_at = coalesce(next_attempt_at, created_at),
    last_updated_at = coalesce(last_updated_at, created_at);

alter table public.workflow_email_outbox
  alter column next_attempt_at set default timezone('utc', now()),
  alter column next_attempt_at set not null;

alter table public.workflow_email_outbox
  drop constraint if exists workflow_email_outbox_status_check;
alter table public.workflow_email_outbox
  add constraint workflow_email_outbox_status_check
  check (status in (
    'queued',
    'processing',
    'accepted',
    'delivered',
    'bounced',
    'failed',
    'complained'
  ));

create unique index if not exists workflow_email_outbox_provider_message_id_idx
  on public.workflow_email_outbox (provider_message_id)
  where provider_message_id is not null;

drop index if exists public.workflow_email_outbox_pending_idx;
create index if not exists workflow_email_outbox_eligible_idx
  on public.workflow_email_outbox (next_attempt_at, created_at)
  where status = 'queued';
create index if not exists workflow_email_outbox_expired_lease_idx
  on public.workflow_email_outbox (lease_expires_at)
  where status = 'processing';
create index if not exists workflow_email_outbox_status_created_idx
  on public.workflow_email_outbox (status, created_at desc);

create table if not exists public.workflow_email_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.workflow_email_outbox(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  outcome text not null check (
    outcome in ('accepted', 'retry_scheduled', 'failed', 'lease_expired')
  ),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists workflow_email_attempts_outbox_created_idx
  on public.workflow_email_attempts (outbox_id, created_at desc);

create table if not exists public.workflow_email_provider_events (
  event_id text primary key,
  event_type text not null,
  provider_message_id text not null,
  occurred_at timestamptz not null,
  event_data jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default timezone('utc', now())
);

create index if not exists workflow_email_provider_events_message_idx
  on public.workflow_email_provider_events (provider_message_id, occurred_at desc);

alter table public.workflow_email_attempts enable row level security;
alter table public.workflow_email_provider_events enable row level security;

revoke all on table public.workflow_email_attempts from anon, authenticated;
revoke all on table public.workflow_email_provider_events from anon, authenticated;
grant select on table public.workflow_email_attempts to authenticated;
grant select on table public.workflow_email_provider_events to authenticated;

drop policy if exists "Workflow administrators can inspect email attempts"
  on public.workflow_email_attempts;
create policy "Workflow administrators can inspect email attempts"
  on public.workflow_email_attempts
  for select
  to authenticated
  using (public.is_workflow_admin());

drop policy if exists "Workflow administrators can inspect provider email events"
  on public.workflow_email_provider_events;
create policy "Workflow administrators can inspect provider email events"
  on public.workflow_email_provider_events
  for select
  to authenticated
  using (public.is_workflow_admin());

grant select on table public.workflow_email_outbox to authenticated;
drop policy if exists "Workflow administrators can inspect the email outbox"
  on public.workflow_email_outbox;
create policy "Workflow administrators can inspect the email outbox"
  on public.workflow_email_outbox
  for select
  to authenticated
  using (public.is_workflow_admin());

create or replace function public.claim_workflow_email_jobs(
  worker_id uuid,
  requested_batch_size integer default 20
)
returns setof public.workflow_email_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  now_at timestamptz := timezone('utc', now());
begin
  if worker_id is null then
    raise exception 'An email worker identifier is required';
  end if;

  with expired_jobs as (
    select id, attempts, last_error
    from public.workflow_email_outbox
    where status = 'processing'
      and lease_expires_at <= now_at
      and attempts > 0
    for update skip locked
  )
  insert into public.workflow_email_attempts (
    outbox_id,
    attempt_number,
    outcome,
    error_message
  )
  select
    id,
    attempts,
    'lease_expired',
    coalesce(last_error, 'Processing lease expired before the result was recorded')
  from expired_jobs;

  update public.workflow_email_outbox
  set status = 'failed',
      failed_at = now_at,
      is_retryable = true,
      last_error = coalesce(last_error, 'Processing lease expired after maximum attempts'),
      claimed_by = null,
      lease_expires_at = null,
      last_updated_at = now_at
  where status = 'processing'
    and lease_expires_at <= now_at
    and attempts >= 6;

  return query
  with candidates as (
    select outbox.id
    from public.workflow_email_outbox outbox
    where outbox.attempts < 6
      and (
        (
          outbox.status = 'queued'
          and outbox.next_attempt_at <= now_at
        )
        or (
          outbox.status = 'processing'
          and outbox.lease_expires_at <= now_at
        )
      )
    order by outbox.next_attempt_at, outbox.created_at, outbox.id
    limit greatest(1, least(coalesce(requested_batch_size, 20), 50))
    for update skip locked
  )
  update public.workflow_email_outbox outbox
  set status = 'processing',
      attempts = outbox.attempts + 1,
      claimed_by = worker_id,
      lease_expires_at = now_at + interval '10 minutes',
      last_updated_at = now_at
  from candidates
  where outbox.id = candidates.id
  returning outbox.*;
end;
$$;

revoke all on function public.claim_workflow_email_jobs(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_workflow_email_jobs(uuid, integer)
  to service_role;

create or replace function public.retry_workflow_email_job(target_email_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_workflow_admin() then
    raise exception 'Only workflow administrators can retry email jobs';
  end if;

  update public.workflow_email_outbox
  set status = 'queued',
      attempts = 0,
      failed_at = null,
      next_attempt_at = timezone('utc', now()),
      claimed_by = null,
      lease_expires_at = null,
      last_error = null,
      is_retryable = true,
      last_updated_at = timezone('utc', now())
  where id = target_email_id
    and status = 'failed'
    and is_retryable;

  return found;
end;
$$;

revoke all on function public.retry_workflow_email_job(uuid) from public, anon;
grant execute on function public.retry_workflow_email_job(uuid) to authenticated;

create or replace function public.record_workflow_email_provider_event(
  p_provider_event_id text,
  p_provider_event_type text,
  p_provider_message_id text,
  p_event_occurred_at timestamptz,
  p_provider_event_data jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_status text;
  detail text;
  matched_outbox_id uuid;
begin
  next_status := case p_provider_event_type
    when 'email.delivered' then 'delivered'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.failed' then 'failed'
    when 'email.suppressed' then 'failed'
    else null
  end;

  if next_status is null then
    raise exception 'Unsupported email provider event type: %', p_provider_event_type;
  end if;
  if nullif(btrim(p_provider_event_id), '') is null
    or nullif(btrim(p_provider_message_id), '') is null
    or p_event_occurred_at is null then
    raise exception 'Email provider event is missing required identifiers or timestamp';
  end if;

  insert into public.workflow_email_provider_events (
    event_id,
    event_type,
    provider_message_id,
    occurred_at,
    event_data
  )
  values (
    p_provider_event_id,
    p_provider_event_type,
    p_provider_message_id,
    p_event_occurred_at,
    coalesce(p_provider_event_data, '{}'::jsonb)
  )
  on conflict (event_id) do nothing;

  if not found then
    return false;
  end if;

  detail := coalesce(
    p_provider_event_data #>> '{bounce,message}',
    p_provider_event_data #>> '{failed,reason}',
    p_provider_event_data #>> '{suppressed,message}'
  );

  update public.workflow_email_outbox
  set status = next_status,
      delivered_at = case
        when next_status = 'delivered' then coalesce(delivered_at, p_event_occurred_at)
        else delivered_at
      end,
      failed_at = case
        when next_status in ('failed', 'bounced', 'complained')
          then coalesce(failed_at, p_event_occurred_at)
        else failed_at
      end,
      is_retryable = false,
      last_error = case
        when next_status in ('failed', 'bounced', 'complained')
          then coalesce(detail, provider_event_type)
        when next_status = 'delivered' then null
        else last_error
      end,
      provider_event_data = coalesce(workflow_email_outbox.provider_event_data, '{}'::jsonb)
        || jsonb_build_object(
          'type', p_provider_event_type,
          'occurred_at', p_event_occurred_at,
          'details', coalesce(detail, '')
        ),
      last_provider_event_at = p_event_occurred_at,
      claimed_by = null,
      lease_expires_at = null,
      last_updated_at = timezone('utc', now())
  where workflow_email_outbox.provider_message_id = p_provider_message_id
    and (
      last_provider_event_at is null
      or p_event_occurred_at >= last_provider_event_at
    )
  returning id into matched_outbox_id;

  if matched_outbox_id is null then
    if not exists (
      select 1
      from public.workflow_email_outbox
      where workflow_email_outbox.provider_message_id = p_provider_message_id
    ) then
      raise exception 'No email outbox record found for provider message %',
        p_provider_message_id;
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.record_workflow_email_provider_event(
  text, text, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.record_workflow_email_provider_event(
  text, text, text, timestamptz, jsonb
) to service_role;
