-- Complete the family-budget analysis model with transaction periodicity,
-- food characteristics and household-specific product learning.

alter table public.transactions
  add column if not exists frequency text not null default 'other';

alter table public.transactions
  drop constraint if exists transactions_frequency_check;

alter table public.transactions
  add constraint transactions_frequency_check
  check (frequency in (
    'monthly',
    'bimonthly',
    'quarterly',
    'four_monthly',
    'semiannual',
    'yearly',
    'other'
  ));

alter table public.subcategories
  add column if not exists food_characteristic text;

alter table public.subcategories
  drop constraint if exists subcategories_food_characteristic_check;

alter table public.subcategories
  add constraint subcategories_food_characteristic_check
  check (
    food_characteristic is null
    or food_characteristic in ('necessary', 'necessary_indulgence', 'nonessential_misc')
  );

create table if not exists public.product_classification_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  match_text text not null,
  display_name text not null,
  category_id uuid references public.categories(id) on delete set null,
  subcategory_id uuid references public.subcategories(id) on delete set null,
  use_count integer not null default 1,
  last_used_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, match_text)
);

create index if not exists idx_product_classification_rules_household
on public.product_classification_rules (household_id, use_count desc);

alter table public.product_classification_rules enable row level security;

drop policy if exists "Members can view product classification rules"
on public.product_classification_rules;

drop policy if exists "Editors can modify product classification rules"
on public.product_classification_rules;

create policy "Members can view product classification rules"
on public.product_classification_rules for select
using (public.is_household_member(household_id));

create policy "Editors can modify product classification rules"
on public.product_classification_rules for all
using (public.has_household_role(household_id, array['owner','editor']::member_role[]))
with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));
