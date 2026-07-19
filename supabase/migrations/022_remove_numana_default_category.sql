-- Remove the old household-specific template category only when it is unused.

delete from public.categories as category
where lower(trim(category.name)) in ('abitazione numana', 'casa numana')
  and not exists (
    select 1 from public.subcategories as subcategory
    where subcategory.category_id = category.id
  )
  and not exists (
    select 1 from public.transactions as transaction
    where transaction.category_id = category.id
  )
  and not exists (
    select 1 from public.transaction_items as item
    where item.category_id = category.id
  )
  and not exists (
    select 1 from public.budget_targets as target
    where target.category_id = category.id
  )
  and not exists (
    select 1 from public.recurring_rules as recurring_rule
    where recurring_rule.category_id = category.id
  )
  and not exists (
    select 1 from public.loans as loan
    where loan.category_id = category.id
  )
  and not exists (
    select 1 from public.classification_rules as classification_rule
    where classification_rule.category_id = category.id
  )
  and not exists (
    select 1 from public.product_classification_rules as product_rule
    where product_rule.category_id = category.id
  );
