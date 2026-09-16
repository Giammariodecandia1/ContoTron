alter table public.transactions
  add column if not exists split_months integer not null default 1;

alter table public.transactions
  drop constraint if exists transactions_split_months_check;

alter table public.transactions
  add constraint transactions_split_months_check
  check (split_months between 1 and 120);

comment on column public.transactions.split_months is
  'Number of consecutive monthly installments used only by Split; accounting keeps the full transaction amount on its original date.';

create or replace function public.create_transaction_with_items(
  p_transaction jsonb,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_transaction public.transactions;
  transaction_actor uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'At least one transaction item is required';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) item
    where trim(coalesce(item ->> 'description', '')) = ''
       or coalesce((item ->> 'amount')::numeric, 0) <= 0
  ) then
    raise exception 'Every transaction item requires a description and a positive amount';
  end if;

  transaction_actor := coalesce(
    (nullif(p_transaction ->> 'inserted_by', ''))::uuid,
    auth.uid()
  );

  insert into public.transactions (
    household_id, account_id, destination_account_id, document_id,
    recurring_rule_id, type, status, source, payment_method,
    cash_impact_date, frequency, transaction_date, description, merchant,
    amount, category_id, subcategory_id, is_shared, split_months, inserted_by, notes
  ) values (
    (p_transaction ->> 'household_id')::uuid,
    (nullif(p_transaction ->> 'account_id', ''))::uuid,
    (nullif(p_transaction ->> 'destination_account_id', ''))::uuid,
    (nullif(p_transaction ->> 'document_id', ''))::uuid,
    (nullif(p_transaction ->> 'recurring_rule_id', ''))::uuid,
    coalesce((p_transaction ->> 'type')::public.transaction_type, 'expense'::public.transaction_type),
    coalesce((p_transaction ->> 'status')::public.transaction_status, 'confirmed'::public.transaction_status),
    coalesce((p_transaction ->> 'source')::public.transaction_source, 'manual'::public.transaction_source),
    coalesce(nullif(p_transaction ->> 'payment_method', ''), 'standard'),
    coalesce((nullif(p_transaction ->> 'cash_impact_date', ''))::date, (p_transaction ->> 'transaction_date')::date),
    coalesce(nullif(p_transaction ->> 'frequency', ''), 'other'),
    (p_transaction ->> 'transaction_date')::date,
    p_transaction ->> 'description',
    nullif(p_transaction ->> 'merchant', ''),
    (p_transaction ->> 'amount')::numeric,
    (nullif(p_transaction ->> 'category_id', ''))::uuid,
    (nullif(p_transaction ->> 'subcategory_id', ''))::uuid,
    coalesce((p_transaction ->> 'is_shared')::boolean, true),
    greatest(1, least(120, coalesce((p_transaction ->> 'split_months')::integer, 1))),
    transaction_actor,
    nullif(p_transaction ->> 'notes', '')
  ) returning * into saved_transaction;

  insert into public.transaction_items (
    household_id, transaction_id, description, amount,
    category_id, subcategory_id, is_confirmed
  )
  select
    saved_transaction.household_id,
    saved_transaction.id,
    trim(item ->> 'description'),
    (item ->> 'amount')::numeric,
    (nullif(item ->> 'category_id', ''))::uuid,
    (nullif(item ->> 'subcategory_id', ''))::uuid,
    coalesce((item ->> 'is_confirmed')::boolean, true)
  from jsonb_array_elements(p_items) item;

  return to_jsonb(saved_transaction);
end;
$$;

revoke all on function public.create_transaction_with_items(jsonb, jsonb) from public;
grant execute on function public.create_transaction_with_items(jsonb, jsonb) to authenticated;
