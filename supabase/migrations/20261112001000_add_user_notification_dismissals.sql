create table if not exists public.workflow_notification_dismissals (
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_id uuid not null references public.workflow_notifications(id) on delete cascade,
  dismissed_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, notification_id)
);

alter table public.workflow_notification_dismissals enable row level security;

drop policy if exists "Users can view their notification dismissals"
  on public.workflow_notification_dismissals;
create policy "Users can view their notification dismissals"
  on public.workflow_notification_dismissals
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can add their notification dismissals"
  on public.workflow_notification_dismissals;
create policy "Users can add their notification dismissals"
  on public.workflow_notification_dismissals
  for insert
  to authenticated
  with check (user_id = auth.uid());

revoke all on public.workflow_notification_dismissals from public, anon, authenticated;
grant select, insert on public.workflow_notification_dismissals to authenticated;

drop policy if exists "System admins can view all workflow notifications"
  on public.workflow_notifications;
create policy "System admins can view all workflow notifications"
  on public.workflow_notifications
  for select
  to authenticated
  using (public.is_workflow_admin());

create or replace function public.dismiss_all_workflow_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.workflow_mvp_active_role();
begin
  insert into public.workflow_notification_dismissals (user_id, notification_id)
  select auth.uid(), notification.id
  from public.workflow_notifications notification
  where notification.recipient_id = auth.uid()
    or actor_role = 'system_admin'
  on conflict (user_id, notification_id) do nothing;
end;
$$;

revoke all on function public.dismiss_all_workflow_notifications() from public, anon;
grant execute on function public.dismiss_all_workflow_notifications() to authenticated;

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
        from public.workflow_notification_dismissals dismissal
        where dismissal.user_id = auth.uid()
          and dismissal.notification_id = notification.id
      )
  );
$$;

revoke all on function public.has_unread_workflow_notifications() from public, anon;
grant execute on function public.has_unread_workflow_notifications() to authenticated;
