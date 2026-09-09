-- Transaction-like options for subscriptions. Existing rules retain the
-- previous behaviour through safe defaults; no historical transaction changes.
alter table public.recurring_rules
  add column if not exists payment_method text not null default 'standard';

alter table public.recurring_rules
  drop constraint if exists recurring_rules_payment_method_check;

alter table public.recurring_rules
  add constraint recurring_rules_payment_method_check
  check (payment_method in ('standard', 'credit_card'));

alter table public.recurring_rules
  add column if not exists is_shared boolean not null default true;

-- Two browsers opening Contotron at the same instant cannot create the same
-- scheduled charge twice. PostgreSQL allows multiple null recurring_rule_id
-- values, so manual transactions are unaffected.
create unique index if not exists transactions_one_recurring_due_date
  on public.transactions (recurring_rule_id, transaction_date);
