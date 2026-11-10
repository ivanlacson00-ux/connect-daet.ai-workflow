alter table public.profiles
  add column if not exists is_active boolean not null default true;

create index if not exists profiles_active_created_at_idx
  on public.profiles (created_at desc)
  where is_active = true;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and is_active = true
$$;

create or replace function public.ensure_current_user_profile()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  actor_id uuid := auth.uid();
  account_email text;
  account_name text;
  profile_role text;
  profile_is_active boolean;
begin
  if actor_id is null then
    raise exception 'An authenticated user is required';
  end if;

  select account.email,
         coalesce(
           nullif(btrim(account.raw_user_meta_data ->> 'full_name'), ''),
           account.email
         )
    into account_email, account_name
  from auth.users as account
  where account.id = actor_id;

  if account_email is null then
    raise exception 'The authenticated account has no email address';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (actor_id, account_email, account_name, 'user')
  on conflict (id) do nothing;

  select profile.role, profile.is_active
    into profile_role, profile_is_active
  from public.profiles as profile
  where profile.id = actor_id;

  if profile_is_active is distinct from true then
    raise exception 'This account has been disabled';
  end if;

  if profile_role is null or profile_role not in (
    'user',
    'approver',
    'admin',
    'municipal_treasurer',
    'mayor_office',
    'sangguniang_bayan'
  ) then
    raise exception 'The account has no valid assigned role';
  end if;

  return profile_role;
end;
$function$;

revoke all on function public.ensure_current_user_profile()
  from public, anon, authenticated;
grant execute on function public.ensure_current_user_profile()
  to authenticated;
