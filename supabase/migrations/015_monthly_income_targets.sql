-- Monthly planned income used by the annual family-budget dashboard.

create table if not exists public.monthly_income_targets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  planned_income numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (household_id, year, month)
);

alter table public.monthly_income_targets enable row level security;

drop policy if exists "Members can view monthly_income_targets" on public.monthly_income_targets;
drop policy if exists "Editors can modify monthly_income_targets" on public.monthly_income_targets;

create policy "Members can view monthly_income_targets"
on public.monthly_income_targets for select
using (public.is_household_member(household_id));

create policy "Editors can modify monthly_income_targets"
on public.monthly_income_targets for all
using (public.has_household_role(household_id, array['owner','editor']::member_role[]))
with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

create index if not exists idx_monthly_income_targets_household_year
on public.monthly_income_targets (household_id, year);
