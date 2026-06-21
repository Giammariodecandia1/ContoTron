-- =========================================================
-- HELPER FUNCTION FOR RLS
-- =========================================================

create or replace function is_household_member(target_household_id uuid)
returns boolean
language sql
security definer
as $$
  select exists (
    select 1
    from household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = auth.uid()
  );
$$;

-- Enable RLS on all tables
alter table profiles enable row level security;
alter table households enable row level security;
alter table household_members enable row level security;
alter table accounts enable row level security;
alter table categories enable row level security;
alter table subcategories enable row level security;
alter table documents enable row level security;
alter table ocr_jobs enable row level security;
alter table transactions enable row level security;
alter table transaction_items enable row level security;
alter table budget_targets enable row level security;
alter table recurring_rules enable row level security;
alter table loans enable row level security;
alter table classification_rules enable row level security;
alter table audit_log enable row level security;

-- =========================================================
-- POLICIES
-- =========================================================

-- PROFILES
create policy "Users can view all profiles"
on profiles for select
using (true);

create policy "Users can update own profile"
on profiles for update
using (auth.uid() = id);

-- HOUSEHOLDS
create policy "Members can view household"
on households for select
using (is_household_member(id));

-- HOUSEHOLD_MEMBERS
create policy "Members can view other members"
on household_members for select
using (is_household_member(household_id));

-- ACCOUNTS
create policy "Members can view accounts"
on accounts for select
using (is_household_member(household_id));
create policy "Members can insert accounts"
on accounts for insert
with check (is_household_member(household_id));
create policy "Members can update accounts"
on accounts for update
using (is_household_member(household_id));

-- CATEGORIES
create policy "Members can view categories"
on categories for select
using (is_household_member(household_id));
create policy "Members can modify categories"
on categories for all
using (is_household_member(household_id));

-- SUBCATEGORIES
create policy "Members can view subcategories"
on subcategories for select
using (is_household_member(household_id));
create policy "Members can modify subcategories"
on subcategories for all
using (is_household_member(household_id));

-- TRANSACTIONS
create policy "Members can view transactions"
on transactions for select
using (is_household_member(household_id));
create policy "Members can insert transactions"
on transactions for insert
with check (is_household_member(household_id));
create policy "Members can update transactions"
on transactions for update
using (is_household_member(household_id));
create policy "Members can delete transactions"
on transactions for delete
using (is_household_member(household_id));

-- TRANSACTION ITEMS
create policy "Members can view transaction items"
on transaction_items for select
using (is_household_member(household_id));
create policy "Members can modify transaction items"
on transaction_items for all
using (is_household_member(household_id));

-- BUDGETS
create policy "Members can view budgets"
on budget_targets for select
using (is_household_member(household_id));
create policy "Members can modify budgets"
on budget_targets for all
using (is_household_member(household_id));

-- DOCUMENTS
create policy "Members can view documents"
on documents for select
using (is_household_member(household_id));
create policy "Members can modify documents"
on documents for all
using (is_household_member(household_id));

-- (Other tables follow the exact same pattern for MVP)
create policy "Members can view recurring_rules" on recurring_rules for select using (is_household_member(household_id));
create policy "Members can modify recurring_rules" on recurring_rules for all using (is_household_member(household_id));

create policy "Members can view loans" on loans for select using (is_household_member(household_id));
create policy "Members can modify loans" on loans for all using (is_household_member(household_id));
