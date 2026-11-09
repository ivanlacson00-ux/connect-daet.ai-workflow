-- Add administrator-controlled archive metadata without changing workflow status.
alter table public.workflow_submissions
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null,
  add column if not exists retention_until timestamptz;

create index if not exists workflow_submissions_archived_retention_idx
  on public.workflow_submissions (archived_at, retention_until);

create or replace function public.set_workflow_submission_archive(
  target_submission_id uuid,
  should_archive boolean,
  retention_date timestamptz default null
)
returns public.workflow_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  result public.workflow_submissions;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();

  if actor_role <> 'admin' then
    raise exception 'Only an administrator can change archive status';
  end if;

  update public.workflow_submissions
  set archived_at = case when should_archive then coalesce(archived_at, timezone('utc', now())) else null end,
      archived_by = case when should_archive then auth.uid() else null end,
      retention_until = case when should_archive then retention_date else null end
  where id = target_submission_id
  returning * into result;

  if result.id is null then
    raise exception 'Workflow submission does not exist';
  end if;

  insert into public.workflow_audit_logs (
    submission_id, action_by, action_type, comments
  )
  values (
    result.id,
    auth.uid(),
    case when should_archive then 'ARCHIVED' else 'UNARCHIVED' end,
    case when should_archive
      then 'Retention until ' || coalesce(retention_date::text, 'not specified')
      else 'Archive access restored'
    end
  );

  return result;
end;
$$;

grant execute on function public.set_workflow_submission_archive(uuid, boolean, timestamptz)
  to authenticated;

drop policy if exists "Users and staff can view authorized submissions"
  on public.workflow_submissions;

create policy "Users and staff can view authorized submissions"
  on public.workflow_submissions
  for select
  to authenticated
  using (
    public.is_workflow_admin()
    or (not coalesce(archived_at is not null, false)
      and (user_id = auth.uid() or public.is_workflow_staff()))
  );
