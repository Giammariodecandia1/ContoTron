-- A manual monthly forecast may override generated income without changing sources.
alter table public.monthly_income_targets
  add column if not exists source_override boolean not null default false;

-- Keep mistaken sources recoverable and preserve their linked transactions.
alter table public.income_sources
  add column if not exists voided_at timestamptz;
