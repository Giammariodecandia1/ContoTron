-- Each household member connects their own Google Drive account.
-- OAuth tokens remain in the user's Supabase session and are never stored here.

create table if not exists member_google_drive_connections (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending_connection'
    check (status in ('ready', 'pending_connection', 'connection_error')),
  folder_id text,
  folder_name text,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists idx_member_google_drive_connections_user
  on member_google_drive_connections (user_id, household_id);

alter table member_google_drive_connections enable row level security;

drop policy if exists "Members manage own Google Drive connection"
  on member_google_drive_connections;

create policy "Members manage own Google Drive connection"
  on member_google_drive_connections for all
  using (
    user_id = auth.uid()
    and public.is_household_member(household_id)
  )
  with check (
    user_id = auth.uid()
    and public.is_household_member(household_id)
  );

-- Preserve existing working connections for the member who created them.
insert into member_google_drive_connections (
  household_id,
  user_id,
  status,
  folder_id,
  folder_name,
  connected_at,
  updated_at
)
select
  id,
  document_storage_connected_by,
  document_storage_status,
  google_drive_folder_id,
  google_drive_folder_name,
  document_storage_connected_at,
  now()
from households
where document_storage_provider = 'google_drive'
  and document_storage_connected_by is not null
  and google_drive_folder_id is not null
on conflict (household_id, user_id) do nothing;
