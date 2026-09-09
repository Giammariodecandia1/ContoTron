-- Attribute transactions to another household member only when the current
-- user is the household owner. Also attach a later receipt and its analysed
-- rows atomically, without changing the original amount or transaction date.

create or replace function public.enforce_transaction_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Service-role/background work is not altered by this user-facing guard.
  if auth.uid() is null then
    return new;
  end if;

  new.inserted_by := coalesce(new.inserted_by, auth.uid());

  if not exists (
    select 1
    from public.household_members member
    where member.household_id = new.household_id
      and member.user_id = new.inserted_by
  ) then
    raise exception 'The selected transaction author is not a household member';
  end if;

  if new.inserted_by <> auth.uid()
     and not public.has_household_role(new.household_id, array['owner']::public.member_role[]) then
    raise exception 'Only the household owner can add a transaction for another member';
  end if;

  return new;
end;
$$;

drop trigger if exists transactions_enforce_actor on public.transactions;
create trigger transactions_enforce_actor
before insert or update of inserted_by, household_id on public.transactions
for each row execute function public.enforce_transaction_actor();

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
    amount, category_id, subcategory_id, is_shared, inserted_by, notes
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

create or replace function public.attach_receipt_analysis(
  p_transaction_id uuid,
  p_document_id uuid,
  p_merchant text default null,
  p_detected_category_id uuid default null,
  p_detected_subcategory_id uuid default null,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.transactions;
  saved_transaction public.transactions;
  item_count integer;
  category_count integer;
  categorized_count integer;
  common_category_id uuid;
  subcategory_count integer;
  subcategorized_count integer;
  common_subcategory_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Transaction items must be a JSON array';
  end if;

  select * into target
  from public.transactions
  where id = p_transaction_id
  for update;

  if target.id is null then raise exception 'Transaction not found'; end if;
  if not public.has_household_role(target.household_id, array['owner','editor']::public.member_role[]) then
    raise exception 'Insufficient household permissions';
  end if;
  if target.document_id is not null then raise exception 'Transaction already has a receipt'; end if;
  if not exists (
    select 1 from public.documents document
    where document.id = p_document_id and document.household_id = target.household_id
  ) then
    raise exception 'Receipt document does not belong to this household';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
    where trim(coalesce(item ->> 'description', '')) = ''
       or coalesce((item ->> 'amount')::numeric, 0) <= 0
  ) then
    raise exception 'Every receipt item requires a description and a positive amount';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
    where nullif(item ->> 'category_id', '') is not null
      and not exists (
        select 1 from public.categories category
        where category.id = (item ->> 'category_id')::uuid
          and category.household_id = target.household_id
      )
  ) then raise exception 'Invalid receipt category'; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
    where nullif(item ->> 'subcategory_id', '') is not null
      and not exists (
        select 1 from public.subcategories subcategory
        where subcategory.id = (item ->> 'subcategory_id')::uuid
          and subcategory.household_id = target.household_id
      )
  ) then raise exception 'Invalid receipt subcategory'; end if;

  item_count := jsonb_array_length(coalesce(p_items, '[]'::jsonb));

  if item_count > 0 then
    delete from public.transaction_items where transaction_id = target.id;
    insert into public.transaction_items (
      household_id, transaction_id, description, amount,
      category_id, subcategory_id, is_confirmed
    )
    select
      target.household_id, target.id, trim(item ->> 'description'),
      (item ->> 'amount')::numeric,
      (nullif(item ->> 'category_id', ''))::uuid,
      (nullif(item ->> 'subcategory_id', ''))::uuid,
      coalesce((item ->> 'is_confirmed')::boolean, true)
    from jsonb_array_elements(p_items) item;

    select count(distinct nullif(item ->> 'category_id', '')),
           count(nullif(item ->> 'category_id', '')),
           (min(nullif(item ->> 'category_id', '')))::uuid,
           count(distinct nullif(item ->> 'subcategory_id', '')),
           count(nullif(item ->> 'subcategory_id', '')),
           (min(nullif(item ->> 'subcategory_id', '')))::uuid
      into category_count, categorized_count, common_category_id,
           subcategory_count, subcategorized_count, common_subcategory_id
    from jsonb_array_elements(p_items) item;
  end if;

  update public.transactions
  set document_id = p_document_id,
      source = 'receipt_ocr'::public.transaction_source,
      merchant = coalesce(nullif(trim(p_merchant), ''), merchant),
      category_id = case
        when item_count > 0 then case when category_count = 1 and categorized_count = item_count then common_category_id else null end
        else coalesce(p_detected_category_id, category_id)
      end,
      subcategory_id = case
        when item_count > 0 then case
          when category_count = 1 and categorized_count = item_count
            and subcategory_count = 1 and subcategorized_count = item_count
          then common_subcategory_id
          else null
        end
        else coalesce(p_detected_subcategory_id, subcategory_id)
      end,
      updated_at = now()
  where id = target.id and document_id is null
  returning * into saved_transaction;

  if saved_transaction.id is null then
    raise exception 'Transaction was updated elsewhere';
  end if;

  return to_jsonb(saved_transaction);
end;
$$;

revoke all on function public.attach_receipt_analysis(uuid, uuid, text, uuid, uuid, jsonb) from public;
grant execute on function public.attach_receipt_analysis(uuid, uuid, text, uuid, uuid, jsonb) to authenticated;
