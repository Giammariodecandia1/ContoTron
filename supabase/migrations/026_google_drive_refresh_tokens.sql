-- Refresh token Google Drive: accessibile solo alla Edge Function con service role.
create table if not exists google_drive_oauth_credentials (
  user_id uuid primary key references profiles(id) on delete cascade,
  refresh_token_ciphertext text not null,
  updated_at timestamptz not null default now()
);

alter table google_drive_oauth_credentials enable row level security;
revoke all on table google_drive_oauth_credentials from anon, authenticated;
