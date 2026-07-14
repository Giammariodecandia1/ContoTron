-- Extra metadata for fixed expenses and financing schedules.

alter table public.recurring_rules
  add column if not exists reason_code text;

alter table public.recurring_rules
  add column if not exists duration_months integer;

alter table public.recurring_rules
  drop constraint if exists recurring_rules_duration_months_check;

alter table public.recurring_rules
  add constraint recurring_rules_duration_months_check
  check (duration_months is null or duration_months > 0);
