-- Allow household owners to add an already registered user by email without
-- exposing arbitrary profile search to the client.
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
    raise exception 'Solo un proprietario puo aggiungere membri al nucleo familiare.';
  end if;

  if member_role_value not in ('editor', 'viewer') then
    raise exception 'Ruolo non consentito per un nuovo membro.';
  end if;

  select p.*
  into target_profile
  from profiles p
  where lower(p.email) = lower(trim(member_email))
  limit 1;

  if target_profile.id is null then
    raise exception 'Account non trovato. La persona deve prima registrarsi a Contotron con questa email.';
  end if;

  insert into household_members (household_id, user_id, role)
  values (target_household_id, target_profile.id, member_role_value)
  on conflict (household_id, user_id)
  do update set role = case
    when household_members.role = 'owner' then household_members.role
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
