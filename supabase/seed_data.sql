-- Disable foreign key checks for the duration of the script if necessary, but we will use DO blocks
DO $$
DECLARE
    v_household_id uuid;
    v_giovanni_id uuid;
    v_maria_id uuid;
    v_luca_id uuid;
    
    v_conto_corrente_id uuid;
    v_carta_prepagata_id uuid;
    v_contanti_id uuid;
    v_conto_risparmio_id uuid;

BEGIN
    -- 1. Profiles
    INSERT INTO public.profiles (display_name, email) VALUES ('Giovanni', 'giovanni@example.com') ON CONFLICT DO NOTHING RETURNING id INTO v_giovanni_id;
    IF v_giovanni_id IS NULL THEN SELECT id INTO v_giovanni_id FROM public.profiles WHERE display_name = 'Giovanni' LIMIT 1; END IF;

    INSERT INTO public.profiles (display_name, email) VALUES ('Maria', 'maria@example.com') ON CONFLICT DO NOTHING RETURNING id INTO v_maria_id;
    IF v_maria_id IS NULL THEN SELECT id INTO v_maria_id FROM public.profiles WHERE display_name = 'Maria' LIMIT 1; END IF;

    INSERT INTO public.profiles (display_name, email) VALUES ('Luca', 'luca@example.com') ON CONFLICT DO NOTHING RETURNING id INTO v_luca_id;
    IF v_luca_id IS NULL THEN SELECT id INTO v_luca_id FROM public.profiles WHERE display_name = 'Luca' LIMIT 1; END IF;

    -- 2. Household
    INSERT INTO public.households (name, currency, budget_month_start_day) VALUES ('La Nostra Famiglia', 'EUR', 1) ON CONFLICT DO NOTHING RETURNING id INTO v_household_id;
    IF v_household_id IS NULL THEN SELECT id INTO v_household_id FROM public.households WHERE name = 'La Nostra Famiglia' LIMIT 1; END IF;

    -- 3. Household Members
    INSERT INTO public.household_members (household_id, user_id, role) VALUES (v_household_id, v_giovanni_id, 'owner') ON CONFLICT (household_id, user_id) DO NOTHING;
    INSERT INTO public.household_members (household_id, user_id, role) VALUES (v_household_id, v_maria_id, 'editor') ON CONFLICT (household_id, user_id) DO NOTHING;
    INSERT INTO public.household_members (household_id, user_id, role) VALUES (v_household_id, v_luca_id, 'viewer') ON CONFLICT (household_id, user_id) DO NOTHING;

    -- 4. Accounts
    INSERT INTO public.accounts (household_id, name, type, opening_balance) VALUES (v_household_id, 'Conto Corrente Principale', 'current_account', 5000.00) ON CONFLICT DO NOTHING RETURNING id INTO v_conto_corrente_id;
    IF v_conto_corrente_id IS NULL THEN SELECT id INTO v_conto_corrente_id FROM public.accounts WHERE household_id = v_household_id AND name = 'Conto Corrente Principale' LIMIT 1; END IF;

    INSERT INTO public.accounts (household_id, name, type, opening_balance) VALUES (v_household_id, 'Carta Prepagata', 'prepaid_card', 300.00) ON CONFLICT DO NOTHING RETURNING id INTO v_carta_prepagata_id;
    IF v_carta_prepagata_id IS NULL THEN SELECT id INTO v_carta_prepagata_id FROM public.accounts WHERE household_id = v_household_id AND name = 'Carta Prepagata' LIMIT 1; END IF;

    INSERT INTO public.accounts (household_id, name, type, opening_balance) VALUES (v_household_id, 'Contanti', 'cash', 150.00) ON CONFLICT DO NOTHING RETURNING id INTO v_contanti_id;
    IF v_contanti_id IS NULL THEN SELECT id INTO v_contanti_id FROM public.accounts WHERE household_id = v_household_id AND name = 'Contanti' LIMIT 1; END IF;

    INSERT INTO public.accounts (household_id, name, type, opening_balance) VALUES (v_household_id, 'Conto Risparmio', 'savings_book', 10000.00) ON CONFLICT DO NOTHING RETURNING id INTO v_conto_risparmio_id;
    IF v_conto_risparmio_id IS NULL THEN SELECT id INTO v_conto_risparmio_id FROM public.accounts WHERE household_id = v_household_id AND name = 'Conto Risparmio' LIMIT 1; END IF;

    -- Clear old categories to insert Excel ones fresh
    DELETE FROM public.categories WHERE household_id = v_household_id;

    -- 5. Categories from Excel (Expenses)
    INSERT INTO public.categories (household_id, name, type, sort_order) VALUES 
    (v_household_id, 'Generi alimentari', 'expense', 10),
    (v_household_id, 'Abbigliamento', 'expense', 20),
    (v_household_id, 'Cure mediche', 'expense', 30),
    (v_household_id, 'Materiale didattico', 'expense', 40),
    (v_household_id, 'Corsi', 'expense', 50),
    (v_household_id, 'Concerti', 'expense', 60),
    (v_household_id, 'Vacanze', 'expense', 70),
    (v_household_id, 'Cinema/teatro', 'expense', 80),
    (v_household_id, 'Scuola di ballo', 'expense', 90),
    (v_household_id, 'Eventi sportivi', 'expense', 100),
    (v_household_id, 'PC (acquisto)', 'expense', 110),
    (v_household_id, 'Video/DVD/bici', 'expense', 120),
    (v_household_id, 'Cene fuori', 'expense', 130),
    (v_household_id, 'Beneficenza', 'expense', 140),
    (v_household_id, 'Regali/varie', 'expense', 150),
    (v_household_id, 'TV via cavo/satellitare', 'expense', 160),
    (v_household_id, 'Elettricità', 'expense', 170),
    (v_household_id, 'Gas', 'expense', 180),
    (v_household_id, 'Acqua', 'expense', 190),
    (v_household_id, 'Servizio pulizia casa', 'expense', 200),
    (v_household_id, 'Manutenzione', 'expense', 210),
    (v_household_id, 'Riscaldamento', 'expense', 220),
    (v_household_id, 'Internet/Online', 'expense', 230),
    (v_household_id, 'Telefono', 'expense', 240),
    (v_household_id, 'Casa', 'expense', 250),
    (v_household_id, 'Lavanderia', 'expense', 260),
    (v_household_id, 'Parrucchiere/manicure', 'expense', 270),
    (v_household_id, 'Palestra', 'expense', 280),
    (v_household_id, 'Pulizia ed Igiene', 'expense', 290),
    (v_household_id, 'Tari', 'expense', 300),
    (v_household_id, 'IMU', 'expense', 310),
    (v_household_id, 'Condominio', 'expense', 320),
    (v_household_id, 'Carburante', 'expense', 330),
    (v_household_id, 'Assicurazione', 'expense', 340),
    (v_household_id, 'Bollo', 'expense', 350),
    (v_household_id, 'Parcheggio/autostrada', 'expense', 360),
    (v_household_id, 'Rata veicolo', 'expense', 370),
    (v_household_id, 'Fondo pensione', 'expense', 380),
    (v_household_id, 'Conto investimenti', 'expense', 390);

    -- Income
    INSERT INTO public.categories (household_id, name, type, sort_order) VALUES 
    (v_household_id, 'Stipendio', 'income', 10),
    (v_household_id, 'Entrate Extra', 'income', 20);

END $$;
