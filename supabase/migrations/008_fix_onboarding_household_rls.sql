-- Allow a newly authenticated user to read the household they just created
-- before the owner membership row is inserted by onboarding.

drop policy if exists "Members can view household" on households;

create policy "Members and creators can view household"
on households for select
using (
  public.is_household_member(id)
  or created_by = auth.uid()
);
