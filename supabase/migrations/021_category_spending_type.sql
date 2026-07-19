-- Category-level spending type is required because monthly budgets are stored by category.

alter table public.categories
  add column if not exists spending_type text;

update public.categories as category
set spending_type = coalesce((
  select subcategory.spending_type
  from public.subcategories as subcategory
  where subcategory.category_id = category.id
  group by subcategory.spending_type
  order by count(*) desc, subcategory.spending_type
  limit 1
), 'variable')
where category.spending_type is null;

alter table public.categories
  alter column spending_type set default 'variable';

alter table public.categories
  alter column spending_type set not null;

alter table public.categories
  drop constraint if exists categories_spending_type_check;

alter table public.categories
  add constraint categories_spending_type_check
  check (spending_type in ('fixed', 'variable', 'necessary_variable', 'superfluous'));
