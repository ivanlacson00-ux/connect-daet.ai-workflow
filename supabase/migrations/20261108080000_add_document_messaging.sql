create table if not exists public.workflow_messages (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.workflow_submissions(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  sender_name text not null,
  sender_role text not null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists workflow_messages_submission_created_idx
  on public.workflow_messages (submission_id, created_at desc, id desc);

create table if not exists public.workflow_message_attachments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.workflow_submissions(id) on delete cascade,
  message_id uuid not null references public.workflow_messages(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  file_name text not null,
  file_path text not null unique,
  file_type text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists workflow_message_attachments_message_idx
  on public.workflow_message_attachments (message_id);

create table if not exists public.workflow_message_reads (
  submission_id uuid not null references public.workflow_submissions(id) on delete cascade,
  message_id uuid not null references public.workflow_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default timezone('utc', now()),
  primary key (message_id, user_id)
);

create index if not exists workflow_message_reads_submission_idx
  on public.workflow_message_reads (submission_id, message_id);

create or replace function public.can_access_workflow_messaging(target_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_submissions submission
    where submission.id = target_submission_id
      and (
        submission.user_id = auth.uid()
        or public.is_workflow_staff()
        or submission.selected_office_role = public.current_profile_role()
        or public.is_submission_assigned_to_current_office(submission.id)
      )
  )
$$;

revoke all on function public.can_access_workflow_messaging(uuid) from public;
grant execute on function public.can_access_workflow_messaging(uuid) to authenticated;

create or replace function public.can_access_workflow_message_file(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_message_attachments attachment
    where attachment.file_path = object_name
      and public.can_access_workflow_messaging(attachment.submission_id)
  )
$$;

revoke all on function public.can_access_workflow_message_file(text) from public;
grant execute on function public.can_access_workflow_message_file(text) to authenticated;

create or replace function public.workflow_message_file_is_linked(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_message_attachments attachment
    where attachment.file_path = object_name
  )
$$;

revoke all on function public.workflow_message_file_is_linked(text) from public;
grant execute on function public.workflow_message_file_is_linked(text) to authenticated;

create or replace function public.set_workflow_message_sender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sender_profile public.profiles;
begin
  if new.sender_id <> auth.uid() then
    raise exception 'Message sender must match the authenticated user';
  end if;

  select *
    into sender_profile
  from public.profiles
  where id = new.sender_id;

  new.sender_name := coalesce(nullif(btrim(sender_profile.full_name), ''), 'Workflow user');
  new.sender_role := coalesce(sender_profile.role, 'user');
  return new;
end;
$$;

drop trigger if exists set_workflow_message_sender
  on public.workflow_messages;
create trigger set_workflow_message_sender
before insert on public.workflow_messages
for each row
execute function public.set_workflow_message_sender();

revoke all on function public.set_workflow_message_sender() from public, anon, authenticated;

alter table public.workflow_messages enable row level security;
alter table public.workflow_message_attachments enable row level security;
alter table public.workflow_message_reads enable row level security;

revoke all on table public.workflow_messages from anon, authenticated;
revoke all on table public.workflow_message_attachments from anon, authenticated;
revoke all on table public.workflow_message_reads from anon, authenticated;

grant select on table public.workflow_messages to authenticated;
grant insert (id, submission_id, sender_id, body)
  on table public.workflow_messages to authenticated;
grant select on table public.workflow_message_attachments to authenticated;
grant insert (
  submission_id,
  message_id,
  uploaded_by,
  file_name,
  file_path,
  file_type,
  file_size
) on table public.workflow_message_attachments to authenticated;
grant select on table public.workflow_message_reads to authenticated;
grant insert (submission_id, message_id, user_id)
  on table public.workflow_message_reads to authenticated;

drop policy if exists "Participants can view document messages"
  on public.workflow_messages;
create policy "Participants can view document messages"
  on public.workflow_messages
  for select
  to authenticated
  using (public.can_access_workflow_messaging(submission_id));

drop policy if exists "Participants can send document messages"
  on public.workflow_messages;
create policy "Participants can send document messages"
  on public.workflow_messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.can_access_workflow_messaging(submission_id)
  );

drop policy if exists "Participants can view message attachments"
  on public.workflow_message_attachments;
create policy "Participants can view message attachments"
  on public.workflow_message_attachments
  for select
  to authenticated
  using (public.can_access_workflow_messaging(submission_id));

drop policy if exists "Message senders can add attachments"
  on public.workflow_message_attachments;
create policy "Message senders can add attachments"
  on public.workflow_message_attachments
  for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and public.can_access_workflow_messaging(submission_id)
    and exists (
      select 1
      from public.workflow_messages message
      where message.id = message_id
        and message.submission_id = workflow_message_attachments.submission_id
        and message.sender_id = auth.uid()
    )
    and file_path like (
      submission_id::text || '/' || auth.uid()::text || '/' || message_id::text || '/%'
    )
  );

drop policy if exists "Participants can view message read receipts"
  on public.workflow_message_reads;
create policy "Participants can view message read receipts"
  on public.workflow_message_reads
  for select
  to authenticated
  using (public.can_access_workflow_messaging(submission_id));

drop policy if exists "Participants can mark messages as read"
  on public.workflow_message_reads;
create policy "Participants can mark messages as read"
  on public.workflow_message_reads
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.can_access_workflow_messaging(submission_id)
    and exists (
      select 1
      from public.workflow_messages message
      where message.id = message_id
        and message.submission_id = workflow_message_reads.submission_id
        and message.sender_id <> auth.uid()
    )
  );

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'workflow_message_attachments',
  'workflow_message_attachments',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'application/zip'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Participants can read message files" on storage.objects;
create policy "Participants can read message files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'workflow_message_attachments'
    and public.can_access_workflow_message_file(name)
  );

drop policy if exists "Participants can upload message files" on storage.objects;
create policy "Participants can upload message files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'workflow_message_attachments'
    and exists (
      select 1
      from public.workflow_submissions submission
      where name like (
        submission.id::text || '/' || auth.uid()::text || '/%'
      )
        and public.can_access_workflow_messaging(submission.id)
    )
  );

drop policy if exists "Participants can remove unlinked message files" on storage.objects;
create policy "Participants can remove unlinked message files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'workflow_message_attachments'
    and split_part(name, '/', 2) = auth.uid()::text
    and not public.workflow_message_file_is_linked(name)
  );

create or replace function public.notify_workflow_message_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.workflow_submissions;
begin
  select *
    into submission
  from public.workflow_submissions
  where id = new.submission_id;

  insert into public.workflow_notifications (
    recipient_id,
    submission_id,
    event_type,
    title,
    message
  )
  select
    participant.id,
    new.submission_id,
    'DOCUMENT_MESSAGE:' || new.id::text,
    'New message on ' || coalesce(submission.tracking_number, 'document'),
    new.sender_name || ' sent a message about "' || submission.file_name
      || '". Sign in to Docuflow to view and reply.'
  from public.profiles participant
  where participant.id <> new.sender_id
    and (
      participant.id = submission.user_id
      or participant.role in ('approver', 'admin')
      or participant.role = submission.selected_office_role
      or exists (
        select 1
        from public.workflow_routing_plans plan
        join public.workflow_routing_steps step
          on step.routing_plan_id = plan.id
        where plan.submission_id = submission.id
          and plan.status in ('finalized', 'superseded')
          and step.status <> 'skipped'
          and step.office_role = participant.role
      )
    )
  on conflict (recipient_id, submission_id, event_type, title, message)
  do nothing;

  return new;
end;
$$;

drop trigger if exists notify_workflow_message_participants
  on public.workflow_messages;
create trigger notify_workflow_message_participants
after insert on public.workflow_messages
for each row
execute function public.notify_workflow_message_participants();

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'workflow_messages'
    ) then
      alter publication supabase_realtime add table public.workflow_messages;
    end if;
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'workflow_message_attachments'
    ) then
      alter publication supabase_realtime add table public.workflow_message_attachments;
    end if;
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'workflow_message_reads'
    ) then
      alter publication supabase_realtime add table public.workflow_message_reads;
    end if;
  end if;
end;
$$;
