create table if not exists public.workflow_routing_plans (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.workflow_submissions(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null check (status in ('proposed', 'finalized', 'superseded', 'withdrawn')),
  is_current boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  finalized_by uuid references public.profiles(id) on delete set null,
  finalized_at timestamptz,
  unique (submission_id, version),
  check (
    (status in ('proposed', 'finalized') and is_current)
    or (status in ('superseded', 'withdrawn') and not is_current)
  ),
  check (
    (status = 'finalized' and finalized_at is not null)
    or (status <> 'finalized' and finalized_at is null)
  ),
  check (status = 'finalized' or finalized_by is null)
);

create unique index if not exists workflow_routing_plans_one_current_per_submission_idx
  on public.workflow_routing_plans (submission_id)
  where is_current;

create table if not exists public.workflow_routing_steps (
  id uuid primary key default gen_random_uuid(),
  routing_plan_id uuid not null references public.workflow_routing_plans(id) on delete cascade,
  sequence_number integer not null check (sequence_number > 0),
  office_role text not null check (
    office_role in ('municipal_treasurer', 'mayor_office', 'sangguniang_bayan')
  ),
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'approved', 'rejected', 'skipped')),
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz,
  started_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  comments text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (routing_plan_id, sequence_number),
  unique (routing_plan_id, office_role),
  check (
    (status in ('approved', 'rejected', 'skipped') and decided_at is not null)
    or (status in ('pending', 'in_progress') and decided_at is null)
  ),
  check (
    (status in ('in_progress', 'approved', 'rejected') and started_at is not null)
    or status in ('pending', 'skipped')
  )
);

create index if not exists workflow_routing_plans_submission_version_idx
  on public.workflow_routing_plans (submission_id, version desc);

create index if not exists workflow_routing_steps_role_status_idx
  on public.workflow_routing_steps (office_role, status, assigned_at);

alter table public.workflow_routing_plans enable row level security;
alter table public.workflow_routing_steps enable row level security;

revoke all on table public.workflow_routing_plans from anon, authenticated;
revoke all on table public.workflow_routing_steps from anon, authenticated;
grant select on table public.workflow_routing_plans to authenticated;
grant select on table public.workflow_routing_steps to authenticated;

create or replace function public.can_view_workflow_routing_plan(target_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_routing_plans plan
    join public.workflow_submissions submission
      on submission.id = plan.submission_id
    where plan.id = target_plan_id
      and (
        submission.user_id = auth.uid()
        or public.is_workflow_staff()
        or exists (
          select 1
          from public.workflow_routing_steps step
          where step.routing_plan_id = plan.id
            and step.office_role = public.current_profile_role()
        )
      )
  )
$$;

revoke all on function public.can_view_workflow_routing_plan(uuid) from public;
grant execute on function public.can_view_workflow_routing_plan(uuid) to authenticated;

drop policy if exists "Authorized users can view workflow routing plans"
  on public.workflow_routing_plans;
create policy "Authorized users can view workflow routing plans"
  on public.workflow_routing_plans
  for select
  to authenticated
  using (public.can_view_workflow_routing_plan(id));

drop policy if exists "Authorized users can view workflow routing steps"
  on public.workflow_routing_steps;
create policy "Authorized users can view workflow routing steps"
  on public.workflow_routing_steps
  for select
  to authenticated
  using (public.can_view_workflow_routing_plan(routing_plan_id));

comment on table public.workflow_routing_plans is
  'Versioned route configurations; structural changes should create a new plan version. When all route steps are approved, a route without a mayor_office step may complete without Mayor review.';

comment on table public.workflow_routing_steps is
  'Ordered municipal office assignments and their processing decisions for a routing plan. mayor_office is an optional office step.';
