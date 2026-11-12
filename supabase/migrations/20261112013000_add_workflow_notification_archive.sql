create table if not exists public.workflow_notification_archives (
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_id uuid not null references public.workflow_notifications(id) on delete cascade,
  archived_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, notification_id)
);

create index if not exists workflow_notification_archives_user_archived_idx
  on public.workflow_notification_archives (user_id, archived_at desc);

insert into public.workflow_notification_archives (user_id, notification_id, archived_at)
select user_id, notification_id, dismissed_at
from public.workflow_notification_dismissals
on conflict (user_id, notification_id) do nothing;

alter table public.workflow_notification_archives enable row level security;

drop policy if exists "Users can view their notification archives"
  on public.workflow_notification_archives;
create policy "Users can view their notification archives"
  on public.workflow_notification_archives
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.workflow_notification_archives from public, anon, authenticated;
grant select on public.workflow_notification_archives to authenticated;

create or replace function public.archive_workflow_notification(target_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in before archiving notifications';
  end if;

  if not exists (
    select 1
    from public.workflow_notifications notification
    where notification.id = target_notification_id
      and notification.recipient_id = auth.uid()
  ) then
    raise exception 'Notification not found';
  end if;

  insert into public.workflow_notification_archives (user_id, notification_id)
  select auth.uid(), notification.id
  from public.workflow_notifications notification
  where notification.id = target_notification_id
    and notification.recipient_id = auth.uid()
  on conflict (user_id, notification_id) do nothing;

  update public.workflow_notifications
  set read_at = coalesce(read_at, timezone('utc', now()))
  where id = target_notification_id
    and recipient_id = auth.uid();
end;
$$;

revoke all on function public.archive_workflow_notification(uuid) from public, anon;
grant execute on function public.archive_workflow_notification(uuid) to authenticated;

create or replace function public.archive_all_workflow_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in before archiving notifications';
  end if;

  insert into public.workflow_notification_archives (user_id, notification_id)
  select auth.uid(), notification.id
  from public.workflow_notifications notification
  where notification.recipient_id = auth.uid()
  on conflict (user_id, notification_id) do nothing;

  update public.workflow_notifications
  set read_at = coalesce(read_at, timezone('utc', now()))
  where recipient_id = auth.uid();
end;
$$;

revoke all on function public.archive_all_workflow_notifications() from public, anon;
grant execute on function public.archive_all_workflow_notifications() to authenticated;

create or replace function public.delete_archived_workflow_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in before deleting archived notifications';
  end if;

  delete from public.workflow_notifications notification
  where notification.recipient_id = auth.uid()
    and exists (
      select 1
      from public.workflow_notification_archives archive
      where archive.user_id = auth.uid()
        and archive.notification_id = notification.id
    );
end;
$$;

revoke all on function public.delete_archived_workflow_notifications() from public, anon;
grant execute on function public.delete_archived_workflow_notifications() to authenticated;

drop policy if exists "Users can delete their own workflow notifications"
  on public.workflow_notifications;
drop policy if exists "Users can delete archived workflow notifications"
  on public.workflow_notifications;
create policy "Users can delete archived workflow notifications"
  on public.workflow_notifications
  for delete
  to authenticated
  using (
    recipient_id = auth.uid()
    and exists (
      select 1
      from public.workflow_notification_archives archive
      where archive.user_id = auth.uid()
        and archive.notification_id = id
    )
  );

create or replace function public.has_unread_workflow_notifications()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_notifications notification
    where notification.recipient_id = auth.uid()
      and notification.read_at is null
      and not exists (
        select 1
        from public.workflow_notification_archives archive
        where archive.user_id = auth.uid()
          and archive.notification_id = notification.id
      )
      and not exists (
        select 1
        from public.workflow_notification_dismissals dismissal
        where dismissal.user_id = auth.uid()
          and dismissal.notification_id = notification.id
      )
  );
$$;

revoke all on function public.has_unread_workflow_notifications() from public, anon;
grant execute on function public.has_unread_workflow_notifications() to authenticated;

notify pgrst, 'reload schema';
