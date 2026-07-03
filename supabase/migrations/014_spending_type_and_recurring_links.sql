-- Add family-budget analysis metadata.
-- Spending type belongs to subcategories so every transaction inherits it automatically.

alter table public.subcategories
  add column if not exists spending_type text not null default 'variable';

alter table public.subcategories
  drop constraint if exists subcategories_spending_type_check;

alter table public.subcategories
  add constraint subcategories_spending_type_check
  check (spending_type in ('fixed', 'variable', 'necessary_variable', 'superfluous'));

alter table public.transactions
  add column if not exists recurring_rule_id uuid references public.recurring_rules(id) on delete set null;

create index if not exists idx_transactions_recurring_rule
on public.transactions (recurring_rule_id);
