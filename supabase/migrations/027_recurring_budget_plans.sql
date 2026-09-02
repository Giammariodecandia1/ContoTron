-- Optional household-specific weekly budget plans.
-- They prefill new monthly budgets without changing other households or
-- overwriting values that a member has edited manually.

create table if not exists public.recurring_budget_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  name text not null,
  weeks_per_month numeric(5,2) not null default 4.75 check (weeks_per_month > 0),
  monthly_target numeric(12,2) check (monthly_target is null or monthly_target >= 0),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, category_id),
  unique (id, household_id, category_id)
);

create table if not exists public.recurring_budget_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  household_id uuid not null references public.households(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  subcategory_id uuid not null references public.subcategories(id) on delete cascade,
  weekly_amount numeric(12,2) not null default 0 check (weekly_amount >= 0),
  monthly_amount numeric(12,2) not null default 0 check (monthly_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, subcategory_id),
  foreign key (plan_id, household_id, category_id)
    references public.recurring_budget_plans(id, household_id, category_id)
    on delete cascade
);

create index if not exists idx_recurring_budget_plans_household
  on public.recurring_budget_plans (household_id, is_active);

create index if not exists idx_recurring_budget_plan_items_plan
  on public.recurring_budget_plan_items (plan_id);

alter table public.recurring_budget_plans enable row level security;
alter table public.recurring_budget_plan_items enable row level security;

drop policy if exists "Members can view recurring budget plans" on public.recurring_budget_plans;
drop policy if exists "Editors can modify recurring budget plans" on public.recurring_budget_plans;
drop policy if exists "Members can view recurring budget plan items" on public.recurring_budget_plan_items;
drop policy if exists "Editors can modify recurring budget plan items" on public.recurring_budget_plan_items;

create policy "Members can view recurring budget plans"
on public.recurring_budget_plans for select
using (public.is_household_member(household_id));

create policy "Editors can modify recurring budget plans"
on public.recurring_budget_plans for all
using (public.has_household_role(household_id, array['owner','editor']::member_role[]))
with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

create policy "Members can view recurring budget plan items"
on public.recurring_budget_plan_items for select
using (public.is_household_member(household_id));

create policy "Editors can modify recurring budget plan items"
on public.recurring_budget_plan_items for all
using (public.has_household_role(household_id, array['owner','editor']::member_role[]))
with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));
