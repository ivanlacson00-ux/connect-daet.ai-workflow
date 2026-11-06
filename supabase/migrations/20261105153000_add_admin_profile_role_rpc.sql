create or replace function public.admin_update_profile_role(
  target_user_id uuid,
  new_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
    or public.current_profile_role() is distinct from 'admin' then
    raise exception 'Only administrators can change profile roles';
  end if;

  if new_role is null or new_role not in (
    'user',
    'approver',
    'admin',
    'municipal_treasurer',
    'mayor_office',
    'sangguniang_bayan'
  ) then
    raise exception 'Invalid profile role: %', new_role;
  end if;

  update public.profiles
  set role = new_role
  where id = target_user_id;

  if not found then
    raise exception 'Profile not found';
  end if;
end;
$$;

revoke all on function public.admin_update_profile_role(uuid, text) from public;
grant execute on function public.admin_update_profile_role(uuid, text) to authenticated;
