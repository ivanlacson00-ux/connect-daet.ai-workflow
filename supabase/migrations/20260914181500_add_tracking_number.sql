-- Add the human-readable identifier used for document tracking.
-- Existing rows remain nullable until the backfill step assigns numbers.
alter table public.workflow_submissions
  add column if not exists tracking_number text;

create unique index if not exists workflow_submissions_tracking_number_key
  on public.workflow_submissions (tracking_number)
  where tracking_number is not null;
