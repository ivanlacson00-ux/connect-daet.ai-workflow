drop policy if exists "Users can delete their own workflow notifications"
  on public.workflow_notifications;

create policy "Users can delete their own workflow notifications"
  on public.workflow_notifications
  for delete
  to authenticated
  using (recipient_id = auth.uid());

grant delete on public.workflow_notifications to authenticated;
