alter table public.profiles
  add column if not exists first_name text,
  add column if not exists middle_name text,
  add column if not exists last_name text,
  add column if not exists phone_number text,
  add column if not exists age smallint,
  add column if not exists sex text,
  add column if not exists address text;

alter table public.profiles
  drop constraint if exists profiles_age_range_check,
  drop constraint if exists profiles_sex_allowed_check;

alter table public.profiles
  add constraint profiles_age_range_check
    check (age is null or age between 1 and 120),
  add constraint profiles_sex_allowed_check
    check (sex is null or sex in ('female', 'male', 'other', 'prefer_not_to_say'));
