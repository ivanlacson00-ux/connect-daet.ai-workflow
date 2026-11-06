do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workflow_submissions'
  ) then
    alter publication supabase_realtime
      add table public.workflow_submissions;
  end if;
end;
$$;
