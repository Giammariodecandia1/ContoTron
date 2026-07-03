-- Payment timing for family budget cash-flow analysis.

alter table public.transactions
  add column if not exists payment_method text not null default 'standard';

alter table public.transactions
  drop constraint if exists transactions_payment_method_check;

alter table public.transactions
  add constraint transactions_payment_method_check
  check (payment_method in ('standard', 'credit_card'));

alter table public.transactions
  add column if not exists cash_impact_date date;

update public.transactions
set cash_impact_date = transaction_date
where cash_impact_date is null;

create index if not exists idx_transactions_cash_impact_date
on public.transactions (household_id, cash_impact_date);
