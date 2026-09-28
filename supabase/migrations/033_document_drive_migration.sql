-- New files use personal Google Drive. Existing internal files remain readable
-- until their owner moves them. No existing files are deleted here.
alter table public.households
  alter column document_storage_provider set default 'google_drive';
update public.households
set document_storage_provider = 'google_drive'
where document_storage_provider <> 'google_drive';

create table if not exists public.document_drive_transition (
  id integer primary key check (id = 1),
  started_at timestamptz not null default now(),
  recommended_by timestamptz not null default (now() + interval '7 days')
);
insert into public.document_drive_transition (id) values (1) on conflict (id) do nothing;
alter table public.document_drive_transition enable row level security;
grant select on public.document_drive_transition to authenticated;
drop policy if exists "Members can view drive transition" on public.document_drive_transition;
create policy "Members can view drive transition"
  on public.document_drive_transition for select to authenticated using (true);

create table if not exists public.release_note_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  release_id text not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, release_id)
);
alter table public.release_note_receipts enable row level security;
grant select, insert, update on public.release_note_receipts to authenticated;
drop policy if exists "Users can read own release notes" on public.release_note_receipts;
create policy "Users can read own release notes" on public.release_note_receipts for select
  using (user_id = auth.uid());
drop policy if exists "Users can acknowledge own release notes" on public.release_note_receipts;
create policy "Users can acknowledge own release notes" on public.release_note_receipts for insert
  with check (user_id = auth.uid());
drop policy if exists "Users can update own release notes" on public.release_note_receipts;
create policy "Users can update own release notes" on public.release_note_receipts for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Editors can upload household document files" on storage.objects;
drop policy if exists "Editors can update household document files" on storage.objects;

create or replace function public.require_google_drive_for_new_document()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.storage_provider is distinct from 'google_drive'
     or new.storage_path not like 'google_drive:%' then
    raise exception 'I nuovi documenti devono essere salvati su Google Drive.';
  end if;
  return new;
end;
$$;

drop trigger if exists require_google_drive_for_new_document on public.documents;
create trigger require_google_drive_for_new_document
  before insert on public.documents
  for each row execute function public.require_google_drive_for_new_document();

drop trigger if exists require_google_drive_for_new_document_page on public.document_pages;
create trigger require_google_drive_for_new_document_page
  before insert on public.document_pages
  for each row execute function public.require_google_drive_for_new_document();

-- Keep old files as a recoverable backup while changing document references
-- atomically to the owner's personal Google Drive.
create table if not exists public.document_drive_migration_backups (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id) on delete set null,
  household_id uuid not null references public.households(id) on delete cascade,
  original_storage_path text not null,
  drive_file_id text not null,
  migrated_by uuid not null references public.profiles(id),
  migrated_at timestamptz not null default now(),
  cleaned_at timestamptz,
  unique (document_id, original_storage_path)
);

alter table public.document_drive_migration_backups enable row level security;
grant select, insert on public.document_drive_migration_backups to authenticated;
drop policy if exists "Members can view document migration backups" on public.document_drive_migration_backups;
create policy "Members can view document migration backups"
  on public.document_drive_migration_backups for select
  using (public.is_household_member(household_id));
drop policy if exists "Uploaders can record document migration backups" on public.document_drive_migration_backups;
create policy "Uploaders can record document migration backups"
  on public.document_drive_migration_backups for insert
  with check (
    migrated_by = auth.uid()
    and public.has_household_role(household_id, array['owner','editor']::member_role[])
    and exists (
      select 1 from public.documents document
      where document.id = document_drive_migration_backups.document_id
        and document.household_id = document_drive_migration_backups.household_id
        and (document.uploaded_by = auth.uid()
          or (document.uploaded_by is null and public.has_household_role(
            household_id, array['owner']::member_role[]
          )))
    )
  );

create or replace function public.complete_internal_document_migration(
  p_document_id uuid,
  p_files jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_document public.documents%rowtype;
  expected_count integer;
  provided_count integer;
begin
  select * into source_document
  from public.documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'Documento non trovato.';
  end if;
  if source_document.storage_provider = 'google_drive'
     or source_document.storage_path like 'google_drive:%' then
    raise exception 'Documento già trasferito.';
  end if;
  if auth.uid() is null or not public.has_household_role(
    source_document.household_id,
    array['owner','editor']::member_role[]
  ) then
    raise exception 'Non sei autorizzato a trasferire questo documento.';
  end if;
  if source_document.uploaded_by is distinct from auth.uid()
     and not (source_document.uploaded_by is null and public.has_household_role(
       source_document.household_id,
       array['owner']::member_role[]
     )) then
    raise exception 'Puoi trasferire soltanto i tuoi documenti.';
  end if;
  if jsonb_typeof(p_files) is distinct from 'array' then
    raise exception 'Elenco file non valido.';
  end if;

  select count(*) into expected_count from (
    select source_document.storage_path as storage_path
    union
    select page.storage_path
    from public.document_pages page
    where page.document_id = p_document_id
  ) expected;

  select count(*) into provided_count from jsonb_to_recordset(p_files)
    as uploaded(old_storage_path text, drive_file_id text, external_url text, file_size_bytes bigint);
  if provided_count <> expected_count
     or exists (
       select 1 from jsonb_to_recordset(p_files)
         as uploaded(old_storage_path text, drive_file_id text, external_url text, file_size_bytes bigint)
       where nullif(uploaded.old_storage_path, '') is null
          or nullif(uploaded.drive_file_id, '') is null
          or uploaded.old_storage_path like 'google_drive:%'
     )
     or exists (
       select 1 from (
         select source_document.storage_path as storage_path
         union
         select page.storage_path from public.document_pages page where page.document_id = p_document_id
       ) expected
       where not exists (
         select 1 from jsonb_to_recordset(p_files)
           as uploaded(old_storage_path text, drive_file_id text, external_url text, file_size_bytes bigint)
         where uploaded.old_storage_path = expected.storage_path
       )
     ) then
    raise exception 'Il trasferimento deve includere ogni file originale una sola volta.';
  end if;

  insert into public.document_drive_migration_backups (
    document_id, household_id, original_storage_path, drive_file_id, migrated_by
  )
  select p_document_id, source_document.household_id,
    uploaded.old_storage_path, uploaded.drive_file_id, auth.uid()
  from jsonb_to_recordset(p_files)
    as uploaded(old_storage_path text, drive_file_id text, external_url text, file_size_bytes bigint);

  update public.document_pages page
  set storage_path = 'google_drive:' || uploaded.drive_file_id,
      storage_provider = 'google_drive',
      external_file_id = uploaded.drive_file_id,
      external_url = uploaded.external_url,
      file_size_bytes = coalesce(uploaded.file_size_bytes, page.file_size_bytes)
  from jsonb_to_recordset(p_files)
    as uploaded(old_storage_path text, drive_file_id text, external_url text, file_size_bytes bigint)
  where page.document_id = p_document_id
    and page.storage_path = uploaded.old_storage_path;

  update public.documents document
  set storage_path = 'google_drive:' || uploaded.drive_file_id,
      storage_provider = 'google_drive',
      external_file_id = uploaded.drive_file_id,
      external_url = uploaded.external_url,
      uploaded_by = coalesce(document.uploaded_by, auth.uid()),
      updated_at = now()
  from jsonb_to_recordset(p_files)
    as uploaded(old_storage_path text, drive_file_id text, external_url text, file_size_bytes bigint)
  where document.id = p_document_id
    and document.storage_path = uploaded.old_storage_path;
end;
$$;

revoke all on function public.complete_internal_document_migration(uuid, jsonb) from public;
grant execute on function public.complete_internal_document_migration(uuid, jsonb) to authenticated;
