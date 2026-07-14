-- Multipage receipts and documents. Existing single-file documents remain valid.

create table if not exists document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  original_filename text not null,
  storage_path text not null,
  storage_provider text not null default 'supabase' check (storage_provider in ('supabase', 'google_drive')),
  external_file_id text,
  external_url text,
  mime_type text,
  file_size_bytes bigint,
  created_at timestamptz default now(),
  unique (document_id, page_number)
);

create index if not exists idx_document_pages_document
  on document_pages (document_id, page_number);

create index if not exists idx_document_pages_household
  on document_pages (household_id);

alter table document_pages enable row level security;

drop policy if exists "Members can view document pages" on document_pages;
drop policy if exists "Editors can modify document pages" on document_pages;

create policy "Members can view document pages"
  on document_pages for select
  using (public.is_household_member(household_id));

create policy "Editors can modify document pages"
  on document_pages for all
  using (public.has_household_role(household_id, array['owner','editor']::member_role[]))
  with check (public.has_household_role(household_id, array['owner','editor']::member_role[]));
