create table if not exists public.workflow_tracking_sequences (
  tracking_year integer primary key,
  last_sequence integer not null default 0,
  constraint workflow_tracking_sequences_year_check
    check (tracking_year between 2000 and 9999),
  constraint workflow_tracking_sequences_sequence_check
    check (last_sequence between 0 and 999999)
);

create or replace function public.generate_workflow_tracking_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_year integer := extract(year from current_date)::integer;
  next_sequence integer;
begin
  insert into public.workflow_tracking_sequences (tracking_year, last_sequence)
  values (current_year, 1)
  on conflict (tracking_year)
  do update
    set last_sequence = public.workflow_tracking_sequences.last_sequence + 1
  returning last_sequence into next_sequence;

  if next_sequence > 999999 then
    raise exception 'Tracking number sequence exhausted for year %', current_year;
  end if;

  return format('DAET-%s-%s', current_year, lpad(next_sequence::text, 6, '0'));
end;
$$;

create or replace function public.set_workflow_submission_tracking_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tracking_number is null or btrim(new.tracking_number) = '' then
    new.tracking_number := public.generate_workflow_tracking_number();
  end if;

  return new;
end;
$$;

drop trigger if exists set_workflow_submission_tracking_number
  on public.workflow_submissions;

create trigger set_workflow_submission_tracking_number
before insert on public.workflow_submissions
for each row
execute function public.set_workflow_submission_tracking_number();
