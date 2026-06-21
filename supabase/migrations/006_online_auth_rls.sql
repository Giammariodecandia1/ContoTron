-- =========================================================
-- Online production auth, roles and private document storage
-- =========================================================

-- Profiles are created automatically when a Supabase Auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = auth.uid()
  );
$$;

create or replace function public.has_household_role(target_household_id uuid, allowed_roles member_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = auth.uid()
      and hm.role = any(allowed_roles)
  );
$$;

create or replace function public.storage_household_id(object_name text)
returns uuid
language plpgsql
stable
as $$
declare
  first_folder text;
begin
  first_folder := split_part(object_name, '/', 1);
  return first_folder::uuid;
exception when others then
  return null;
end;
$$;

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

-- PROFILES
drop policy if exists "Users can view all profiles" on profiles;
drop policy if exists "Users can view own and household profiles" on profiles;
drop policy if exists "Users can insert own profile" on profiles;
drop policy if exists "Users can update own profile" on profiles;

create policy "Users can view own and household profiles"
on profiles for select
using (
  id = auth.uid()
  or exists (
    select 1
    from household_members me
    join household_members other_member
      on other_member.household_id = me.household_id
    where me.user_id = auth.uid()
      and other_member.user_id = profiles.id
  )
);

create policy "Users can insert own profile"
on profiles for insert
with check (id = auth.uid());

create policy "Users can update own profile"
on profiles for update
using (id = auth.uid())
with check (id = auth.uid());

-- HOUSEHOLDS
drop policy if exists "Members can view household" on households;
drop policy if exists "Authenticated users can create household" on households;
drop policy if exists "Owners can update household" on households;
drop policy if exists "Owners can delete household" on households;

create policy "Members can view household"
on households for select
using (public.is_household_member(id));

create policy "Authenticated users can create household"
on households for insert
with check (created_by = auth.uid());

create policy "Owners can update household"
on households for update
using (public.has_household_role(id, array['owner']::member_role[]))
with check (public.has_household_role(id, array['owner']::member_role[]));

create policy "Owners can delete household"
on households for delete
using (public.has_household_role(id, array['owner']::member_role[]));

-- HOUSEHOLD MEMBERS
drop policy if exists "Members can view other members" on household_members;
drop policy if exists "Users can create own owner membership" on household_members;
drop policy if exists "Owners can manage household members" on household_members;

create policy "Members can view other members"
on household_members for select
using (public.is_household_member(household_id));

create policy "Users can create own owner membership"
on household_members for insert
with check (
  user_id = auth.uid()
  and role = 'owner'
  and exists (
    select 1
    from households h
    where h.id = household_id
      and h.created_by = auth.uid()
  )
);

create policy "Owners can manage household members"
on household_members for all
using (public.has_household_role(household_id, array['owner']::member_role[]))
with check (public.has_household_role(household_id, array['owner']::member_role[]));

-- ACCOUNTS
drop policy if exists "Members can view accounts" on accounts;
drop policy if exists "Members can insert accounts" on accounts;
drop policy if exists "Members can update accounts" on accounts;
drop policy if exists "Members can delete accounts" on accounts;

create policy "Members can view accounts"
on accounts for select
using (public.is_household_member(household_id));

create policy "Editors can insert accounts"
on accounts for insert
with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

create policy "Editors can update accounts"
on accounts for update
using (public.has_household_role(household_id, array['owner','editor']::member_role[]))
with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

create policy "Owners can delete accounts"
on accounts for delete
using (public.has_household_role(household_id, array['owner']::member_role[]));

-- CATEGORIES AND SUBCATEGORIES
drop policy if exists "Members can view categories" on categories;
drop policy if exists "Members can modify categories" on categories;
drop policy if exists "Members can view subcategories" on subcategories;
drop policy if exists "Members can modify subcategories" on subcategories;

create policy "Members can view categories"
on categories for select
using (public.is_household_member(household_id));

create policy "Editors can modify categories"
on categories for all
using (public.has_household_role(household_id, array['owner','editor']::member_role[]))
with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

create policy "Members can view subcategories"
on subcategories for select
using (public.is_household_member(household_id));

create policy "Editors can modify subcategories"
on subcategories for all
using (public.has_household_role(household_id, array['owner','editor']::member_role[]))
with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

-- TRANSACTIONS
drop policy if exists "Members can view transactions" on transactions;
drop policy if exists "Members can insert transactions" on transactions;
drop policy if exists "Members can update transactions" on transactions;
drop policy if exists "Members can delete transactions" on transactions;

create policy "Members can view transactions"
on transactions for select
using (public.is_household_member(household_id));

create policy "Editors can insert transactions"
on transactions for insert
with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

create policy "Editors can update transactions"
on transactions for update
using (public.has_household_role(household_id, array['owner','editor']::member_role[]))
with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

create policy "Editors can delete transactions"
on transactions for delete
using (public.has_household_role(household_id, array['owner','editor']::member_role[]));

-- Shared household data tables
drop policy if exists "Members can view transaction items" on transaction_items;
drop policy if exists "Members can modify transaction items" on transaction_items;
drop policy if exists "Members can view budgets" on budget_targets;
drop policy if exists "Members can modify budgets" on budget_targets;
drop policy if exists "Members can view documents" on documents;
drop policy if exists "Members can modify documents" on documents;
drop policy if exists "Members can view recurring_rules" on recurring_rules;
drop policy if exists "Members can modify recurring_rules" on recurring_rules;
drop policy if exists "Members can view loans" on loans;
drop policy if exists "Members can modify loans" on loans;

create policy "Members can view transaction items" on transaction_items for select using (public.is_household_member(household_id));
create policy "Editors can modify transaction items" on transaction_items for all using (public.has_household_role(household_id, array['owner','editor']::member_role[])) with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

create policy "Members can view budgets" on budget_targets for select using (public.is_household_member(household_id));
create policy "Editors can modify budgets" on budget_targets for all using (public.has_household_role(household_id, array['owner','editor']::member_role[])) with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

create policy "Members can view documents" on documents for select using (public.is_household_member(household_id));
create policy "Editors can modify documents" on documents for all using (public.has_household_role(household_id, array['owner','editor']::member_role[])) with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

create policy "Members can view recurring_rules" on recurring_rules for select using (public.is_household_member(household_id));
create policy "Editors can modify recurring_rules" on recurring_rules for all using (public.has_household_role(household_id, array['owner','editor']::member_role[])) with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

create policy "Members can view loans" on loans for select using (public.is_household_member(household_id));
create policy "Editors can modify loans" on loans for all using (public.has_household_role(household_id, array['owner','editor']::member_role[])) with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

-- OCR, classification and audit
drop policy if exists "Members can view ocr_jobs" on ocr_jobs;
drop policy if exists "Editors can modify ocr_jobs" on ocr_jobs;
drop policy if exists "Members can view classification_rules" on classification_rules;
drop policy if exists "Editors can modify classification_rules" on classification_rules;
drop policy if exists "Members can view audit_log" on audit_log;
drop policy if exists "Editors can insert audit_log" on audit_log;

create policy "Members can view ocr_jobs" on ocr_jobs for select using (public.is_household_member(household_id));
create policy "Editors can modify ocr_jobs" on ocr_jobs for all using (public.has_household_role(household_id, array['owner','editor']::member_role[])) with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

create policy "Members can view classification_rules" on classification_rules for select using (public.is_household_member(household_id));
create policy "Editors can modify classification_rules" on classification_rules for all using (public.has_household_role(household_id, array['owner','editor']::member_role[])) with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

create policy "Members can view audit_log" on audit_log for select using (public.is_household_member(household_id));
create policy "Editors can insert audit_log" on audit_log for insert with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));

-- PRIVATE STORAGE
update storage.buckets
set public = false
where id = 'documents';

drop policy if exists "Document archive public read" on storage.objects;
drop policy if exists "Document archive public insert" on storage.objects;
drop policy if exists "Document archive public update" on storage.objects;
drop policy if exists "Document archive public delete" on storage.objects;
drop policy if exists "Members can read household document files" on storage.objects;
drop policy if exists "Editors can upload household document files" on storage.objects;
drop policy if exists "Editors can update household document files" on storage.objects;
drop policy if exists "Editors can delete household document files" on storage.objects;

create policy "Members can read household document files"
on storage.objects for select
using (
  bucket_id = 'documents'
  and public.is_household_member(public.storage_household_id(name))
);

create policy "Editors can upload household document files"
on storage.objects for insert
with check (
  bucket_id = 'documents'
  and public.has_household_role(public.storage_household_id(name), array['owner','editor']::member_role[])
);

create policy "Editors can update household document files"
on storage.objects for update
using (
  bucket_id = 'documents'
  and public.has_household_role(public.storage_household_id(name), array['owner','editor']::member_role[])
)
with check (
  bucket_id = 'documents'
  and public.has_household_role(public.storage_household_id(name), array['owner','editor']::member_role[])
);

create policy "Editors can delete household document files"
on storage.objects for delete
using (
  bucket_id = 'documents'
  and public.has_household_role(public.storage_household_id(name), array['owner','editor']::member_role[])
);
