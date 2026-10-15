-- Ensure workflow notification inserts are delivered through Supabase Realtime.
do $$
begin
  alter publication supabase_realtime add table public.workflow_notifications;
exception
  when duplicate_object then null;
end;
$$;
