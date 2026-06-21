-- Disable RLS on all tables
alter table public.profiles disable row level security;
alter table public.households disable row level security;
alter table public.household_members disable row level security;
alter table public.accounts disable row level security;
alter table public.categories disable row level security;
alter table public.subcategories disable row level security;
alter table public.transactions disable row level security;
alter table public.budget_targets disable row level security;

-- Drop foreign key constraint on profiles.id if it exists
DO $$
DECLARE
    fk_name text;
BEGIN
    SELECT constraint_name INTO fk_name
    FROM information_schema.table_constraints
    WHERE table_name = 'profiles' AND constraint_type = 'FOREIGN KEY'
    LIMIT 1;

    IF fk_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.profiles DROP CONSTRAINT ' || fk_name;
    END IF;
END $$;

-- Make profiles.email nullable
ALTER TABLE public.profiles ALTER COLUMN email DROP NOT NULL;

-- Make profiles.id auto-generate UUID if not provided
ALTER TABLE public.profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Create a default Household if none exists
DO $$
DECLARE
    hh_id uuid;
BEGIN
    SELECT id INTO hh_id FROM public.households LIMIT 1;
    IF hh_id IS NULL THEN
        INSERT INTO public.households (name, currency) VALUES ('La Nostra Famiglia', 'EUR') RETURNING id INTO hh_id;
    END IF;
END $$;
