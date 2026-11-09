alter table public.profiles
  drop constraint if exists valid_role,
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (
    role in (
      'user',
      'approver',
      'admin',
      'municipal_treasurer',
      'mayor_office',
      'sangguniang_bayan'
    )
  );
