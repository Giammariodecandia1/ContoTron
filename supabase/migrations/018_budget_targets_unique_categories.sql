-- A category budget has exactly one value for each household, year and month.
-- PostgreSQL treats NULL values as distinct in a regular UNIQUE constraint,
-- so category-only targets need a dedicated partial unique index.

with ranked_category_targets as (
  select
    id,
    row_number() over (
      partition by household_id, year, month, category_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as row_position
  from public.budget_targets
  where subcategory_id is null
)
delete from public.budget_targets target
using ranked_category_targets ranked
where target.id = ranked.id
  and ranked.row_position > 1;

create unique index if not exists budget_targets_one_category_value_per_month
  on public.budget_targets (household_id, year, month, category_id)
  where subcategory_id is null;
