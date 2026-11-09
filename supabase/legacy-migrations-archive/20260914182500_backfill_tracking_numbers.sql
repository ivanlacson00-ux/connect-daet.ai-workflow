begin;

-- Pause concurrent numbering while historical records are assigned numbers.
lock table public.workflow_tracking_sequences in share row exclusive mode;

do $$
declare
  missing_count bigint;
begin
  select count(*)
    into missing_count
  from public.workflow_submissions
  where tracking_number is null or btrim(tracking_number) = '';

  if missing_count = 0 then
    return;
  end if;

  with existing_max as (
    select
      substring(tracking_number from '^DAET-([0-9]{4})-[0-9]{6}$')::integer as tracking_year,
      max(substring(tracking_number from '^DAET-[0-9]{4}-([0-9]{6})$')::integer) as last_sequence
    from public.workflow_submissions
    where tracking_number ~ '^DAET-[0-9]{4}-[0-9]{6}$'
    group by substring(tracking_number from '^DAET-([0-9]{4})-[0-9]{6}$')::integer
  )
  insert into public.workflow_tracking_sequences (tracking_year, last_sequence)
  select tracking_year, last_sequence
  from existing_max
  on conflict (tracking_year)
  do update
    set last_sequence = greatest(
      public.workflow_tracking_sequences.last_sequence,
      excluded.last_sequence
    );

  insert into public.workflow_tracking_sequences (tracking_year, last_sequence)
  select distinct
    coalesce(extract(year from created_at)::integer, extract(year from current_date)::integer),
    0
  from public.workflow_submissions
  where tracking_number is null or btrim(tracking_number) = ''
  on conflict (tracking_year) do nothing;

  with numbered as (
    select
      id,
      coalesce(extract(year from created_at)::integer, extract(year from current_date)::integer) as tracking_year,
      row_number() over (
        partition by coalesce(extract(year from created_at)::integer, extract(year from current_date)::integer)
        order by created_at nulls last, id
      ) as row_number
    from public.workflow_submissions
    where tracking_number is null or btrim(tracking_number) = ''
  ),
  sequence_offsets as (
    select tracking_year, last_sequence
    from public.workflow_tracking_sequences
  ),
  assigned as (
    select
      numbered.id,
      numbered.tracking_year,
      sequence_offsets.last_sequence + numbered.row_number as sequence_number
    from numbered
    join sequence_offsets using (tracking_year)
  )
  update public.workflow_submissions submission
  set tracking_number = format(
    'DAET-%s-%s',
    assigned.tracking_year,
    lpad(assigned.sequence_number::text, 6, '0')
  )
  from assigned
  where submission.id = assigned.id;

  if exists (
    select 1
    from public.workflow_submissions submission
    where submission.tracking_number is null
      or btrim(submission.tracking_number) = ''
  ) then
    raise exception 'Tracking number backfill did not update every submission';
  end if;

  if exists (
    select 1
    from public.workflow_submissions submission
    where submission.tracking_number !~ '^DAET-[0-9]{4}-[0-9]{6}$'
  ) then
    raise exception 'Tracking number backfill found an invalid tracking number';
  end if;

  if exists (
    select 1
    from public.workflow_submissions
    group by tracking_number
    having count(*) > 1
  ) then
    raise exception 'Tracking number backfill produced duplicate tracking numbers';
  end if;

  update public.workflow_tracking_sequences sequence_row
  set last_sequence = greatest(
    sequence_row.last_sequence,
    coalesce((
      select max(substring(submission.tracking_number from '^DAET-[0-9]{4}-([0-9]{6})$')::integer)
      from public.workflow_submissions submission
      where submission.tracking_number ~ (
        '^DAET-' || sequence_row.tracking_year::text || '-[0-9]{6}$'
      )
    ), 0)
  );
end;
$$;

alter table public.workflow_submissions
  alter column tracking_number set not null;

commit;
