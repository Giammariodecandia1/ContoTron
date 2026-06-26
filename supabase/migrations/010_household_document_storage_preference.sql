-- Document storage formula selected by each household.
-- Supabase remains the default so existing families keep working unchanged.

alter table households
  add column if not exists document_storage_provider text not null default 'supabase',
  add column if not exists document_storage_status text not null default 'ready',
  add column if not exists document_storage_config jsonb not null default '{}'::jsonb,
  add column if not exists document_storage_connected_by uuid references profiles(id),
  add column if not exists document_storage_connected_at timestamptz,
  add column if not exists google_drive_folder_id text,
  add column if not exists google_drive_folder_name text;

alter table households
  drop constraint if exists households_document_storage_provider_check,
  add constraint households_document_storage_provider_check
    check (document_storage_provider in ('supabase', 'google_drive'));

alter table households
  drop constraint if exists households_document_storage_status_check,
  add constraint households_document_storage_status_check
    check (document_storage_status in ('ready', 'pending_connection', 'connection_error'));

alter table documents
  add column if not exists storage_provider text not null default 'supabase',
  add column if not exists external_file_id text,
  add column if not exists external_url text;

alter table documents
  drop constraint if exists documents_storage_provider_check,
  add constraint documents_storage_provider_check
    check (storage_provider in ('supabase', 'google_drive'));

update households
set
  document_storage_provider = coalesce(document_storage_provider, 'supabase'),
  document_storage_status = coalesce(document_storage_status, 'ready'),
  document_storage_config = coalesce(document_storage_config, '{}'::jsonb)
where document_storage_provider is null
  or document_storage_status is null
  or document_storage_config is null;
