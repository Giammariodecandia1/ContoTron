-- Household invite codes and single-household membership.
-- Each account can belong to only one household at a time.

alter table public.households
  add column if not exists invite_code text;

update public.households
set invite_code = upper(substr(replace(id::text, '-', ''), 1, 10))
where invite_code is null
  or trim(invite_code) = '';

alter table public.households
  alter column invite_code set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  alter column invite_code set not null;

create unique index if not exists households_invite_code_unique
  on public.households (lower(invite_code));

with ranked_members as (
  select
    id,
    row_number() over (
      partition by user_id
      order by created_at desc, id desc
    ) as position
  from public.household_members
)
delete from public.household_members hm
using ranked_members ranked
where hm.id = ranked.id
  and ranked.position > 1;

create unique index if not exists household_members_one_household_per_user
  on public.household_members (user_id);

create or replace function public.add_household_member_by_email(
  target_household_id uuid,
  member_email text,
  member_role_value member_role default 'editor'
)
returns table (
  member_id uuid,
  user_id uuid,
  display_name text,
  email text,
  role member_role
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_profile profiles%rowtype;
  saved_member household_members%rowtype;
begin
  if not public.has_household_role(target_household_id, array['owner']::member_role[]) then
    raise exception 'Solo un proprietario puo aggiungere membri al nucleo.';
  end if;

  if member_role_value not in ('editor', 'viewer') then
    raise exception 'Ruolo non consentito per un nuovo membro.';
  end if;

  select p.*
  into target_profile
  from public.profiles p
  where lower(p.email) = lower(trim(member_email))
  limit 1;

  if target_profile.id is null then
    raise exception 'Account non trovato. La persona deve prima registrarsi a Contotron con questa email.';
  end if;

  delete from public.household_members
  where user_id = target_profile.id
    and household_id <> target_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (target_household_id, target_profile.id, member_role_value)
  on conflict (household_id, user_id)
  do update set role = case
    when public.household_members.role = 'owner' then public.household_members.role
    else excluded.role
  end
  returning * into saved_member;

  return query
    select
      saved_member.id,
      target_profile.id,
      target_profile.display_name,
      target_profile.email,
      saved_member.role;
end;
$$;

revoke all on function public.add_household_member_by_email(uuid, text, member_role) from public;
grant execute on function public.add_household_member_by_email(uuid, text, member_role) to authenticated;

create or replace function public.join_household_by_invite_code(join_code text)
returns table (
  household_id uuid,
  household_name text,
  role member_role
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text;
  target_household public.households%rowtype;
  saved_member public.household_members%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Devi effettuare il login per entrare in un nucleo.';
  end if;

  normalized_code := upper(regexp_replace(trim(coalesce(join_code, '')), '[^A-Za-z0-9]', '', 'g'));

  if normalized_code = '' then
    raise exception 'Inserisci un codice invito valido.';
  end if;

  select h.*
  into target_household
  from public.households h
  where upper(regexp_replace(h.invite_code, '[^A-Za-z0-9]', '', 'g')) = normalized_code
  limit 1;

  if target_household.id is null then
    raise exception 'Codice invito non trovato.';
  end if;

  delete from public.household_members
  where user_id = auth.uid()
    and household_id <> target_household.id;

  insert into public.household_members (household_id, user_id, role)
  values (target_household.id, auth.uid(), 'editor')
  on conflict (household_id, user_id)
  do update set role = public.household_members.role
  returning * into saved_member;

  return query
    select
      target_household.id,
      target_household.name,
      saved_member.role;
end;
$$;

revoke all on function public.join_household_by_invite_code(text) from public;
grant execute on function public.join_household_by_invite_code(text) to authenticated;
