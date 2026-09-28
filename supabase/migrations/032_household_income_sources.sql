-- Recurring income rules and explicitly confirmed income occurrences.
-- Existing monthly_income_targets remain untouched and usable as a fallback.

create table if not exists public.income_sources (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  beneficiary_user_id uuid not null references public.profiles(id),
  account_id uuid references public.accounts(id) on delete set null,
  amount numeric(12,2) not null check (amount >= 0),
  payday integer not null check (payday between 1 and 31),
  cadence text not null default 'monthly' check (cadence in ('monthly','bimonthly','quarterly','semiannual','yearly')),
  effective_from date not null default current_date,
  effective_to date,
  thirteenth_amount numeric(12,2) not null default 0 check (thirteenth_amount >= 0),
  thirteenth_month integer check (thirteenth_month between 1 and 12),
  fourteenth_amount numeric(12,2) not null default 0 check (fourteenth_amount >= 0),
  fourteenth_month integer check (fourteenth_month between 1 and 12),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint income_source_validity check (effective_to is null or effective_to >= effective_from),
  constraint thirteenth_configuration check ((thirteenth_amount = 0 and thirteenth_month is null) or (thirteenth_amount > 0 and thirteenth_month is not null)),
  constraint fourteenth_configuration check ((fourteenth_amount = 0 and fourteenth_month is null) or (fourteenth_amount > 0 and fourteenth_month is not null))
);

create index if not exists idx_income_sources_household_dates
  on public.income_sources (household_id, effective_from, effective_to);

alter table public.income_sources enable row level security;
drop policy if exists "Members can view income sources" on public.income_sources;
drop policy if exists "Editors can manage income sources" on public.income_sources;
create policy "Members can view income sources" on public.income_sources for select
  using (public.is_household_member(household_id));
create policy "Editors can manage income sources" on public.income_sources for all
  using (public.has_household_role(household_id, array['owner','editor']::member_role[]))
  with check (
    public.has_household_role(household_id, array['owner','editor']::member_role[])
    and exists (select 1 from public.household_members hm where hm.household_id = income_sources.household_id and hm.user_id = income_sources.beneficiary_user_id)
    and (account_id is null or exists (select 1 from public.accounts a where a.id = income_sources.account_id and a.household_id = income_sources.household_id))
  );

alter table public.transactions
  add column if not exists income_source_id uuid references public.income_sources(id) on delete set null,
  add column if not exists income_beneficiary_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists income_occurrence_kind text check (income_occurrence_kind in ('regular','thirteenth','fourteenth'));

create index if not exists idx_transactions_income_source
  on public.transactions (income_source_id, transaction_date) where type = 'income';

create unique index if not exists idx_transactions_unique_income_occurrence
  on public.transactions (income_source_id, transaction_date, income_occurrence_kind)
  where type = 'income' and income_source_id is not null and status <> 'deleted';
