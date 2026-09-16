do $$
declare
  target_household uuid := '6e679427-1d65-4fe5-83fb-386eac7bd3ad';
  target_rule uuid := '89bdb21e-09d3-411c-a423-006655db9382';
  target_category uuid;
  target_subcategory uuid;
  old_category uuid;
  old_subcategory uuid;
  fixed_amount numeric(12,2);
begin
  select id into target_category
  from public.categories
  where household_id = target_household
    and lower(trim(name)) = 'finanziamenti'
  limit 1;

  select id into target_subcategory
  from public.subcategories
  where household_id = target_household
    and category_id = target_category
    and regexp_replace(lower(trim(name)), '\s+', ' ', 'g') = 'acquisto 3'
  limit 1;

  select category_id, subcategory_id, amount
  into old_category, old_subcategory, fixed_amount
  from public.recurring_rules
  where id = target_rule
    and household_id = target_household
    and lower(trim(description)) = 'protesi acustiche';

  if target_category is null or target_subcategory is null or fixed_amount is null then
    raise notice 'Fix tester Protesi Acustiche non applicato: dati di destinazione non trovati.';
    return;
  end if;

  update public.recurring_rules
  set category_id = target_category,
      subcategory_id = target_subcategory,
      updated_at = now()
  where id = target_rule
    and household_id = target_household;

  delete from public.budget_targets
  where household_id = target_household
    and category_id = old_category
    and subcategory_id = old_subcategory
    and notes = 'AUTO_SPESE_FISSE';

  update public.budget_targets
  set planned_amount = fixed_amount,
      notes = 'AUTO_SPESE_FISSE',
      updated_at = now()
  where household_id = target_household
    and category_id = target_category
    and subcategory_id = target_subcategory;

  insert into public.budget_targets (
    household_id, year, month, category_id, subcategory_id,
    planned_amount, notes, updated_at
  )
  select
    target_household,
    extract(year from period)::integer,
    extract(month from period)::integer,
    target_category,
    target_subcategory,
    fixed_amount,
    'AUTO_SPESE_FISSE',
    now()
  from generate_series(
    date_trunc('month', current_date),
    date_trunc('month', current_date) + interval '11 months',
    interval '1 month'
  ) period
  on conflict (household_id, year, month, category_id, subcategory_id)
  do update set
    planned_amount = excluded.planned_amount,
    notes = excluded.notes,
    updated_at = now();
end;
$$;
