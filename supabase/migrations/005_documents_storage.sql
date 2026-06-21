-- Storage bucket for archived receipts, bills, invoices, and statements.
-- MVP note: auth is currently disabled in the app, so these policies are permissive.
-- Tighten them when Supabase Auth/RLS is re-enabled.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  true,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'application/pdf'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Document archive public read" on storage.objects;
drop policy if exists "Document archive public insert" on storage.objects;
drop policy if exists "Document archive public update" on storage.objects;
drop policy if exists "Document archive public delete" on storage.objects;

create policy "Document archive public read"
on storage.objects for select
using (bucket_id = 'documents');

create policy "Document archive public insert"
on storage.objects for insert
with check (bucket_id = 'documents');

create policy "Document archive public update"
on storage.objects for update
using (bucket_id = 'documents')
with check (bucket_id = 'documents');

create policy "Document archive public delete"
on storage.objects for delete
using (bucket_id = 'documents');
