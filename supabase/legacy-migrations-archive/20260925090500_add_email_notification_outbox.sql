-- Queue workflow notifications for server-side email delivery.
create table if not exists public.workflow_email_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references public.workflow_notifications(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  recipient_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text
);

create index if not exists workflow_email_outbox_pending_idx
  on public.workflow_email_outbox (created_at)
  where sent_at is null;

alter table public.workflow_email_outbox enable row level security;

create or replace function public.queue_workflow_notification_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient_email text;
begin
  select email into recipient_email
  from public.profiles
  where id = new.recipient_id;

  if recipient_email is null then
    return new;
  end if;

  insert into public.workflow_email_outbox (
    notification_id,
    recipient_id,
    recipient_email,
    subject,
    body
  )
  values (
    new.id,
    new.recipient_id,
    recipient_email,
    'CONNECT-Daet: ' || new.title,
    new.message
  )
  on conflict (notification_id) do nothing;

  return new;
end;
$$;

drop trigger if exists queue_workflow_notification_email
  on public.workflow_notifications;

create trigger queue_workflow_notification_email
after insert on public.workflow_notifications
for each row
execute function public.queue_workflow_notification_email();
