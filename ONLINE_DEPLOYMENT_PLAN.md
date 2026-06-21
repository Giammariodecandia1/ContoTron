# Contotron online: multi-famiglia, privacy, deploy

## Obiettivo

Portare Contotron online come web app multi-famiglia:

- una sola applicazione deployata;
- piu famiglie gestite nello stesso database;
- dati separati per `household_id`;
- ogni famiglia personalizzabile;
- uso comodo anche da smartphone;
- deploy automatico da Git verso Netlify;
- dati persistenti in Supabase anche dopo aggiornamenti del codice.

## Dati che servono

- Progetto Supabase di produzione.
- `VITE_SUPABASE_URL`.
- `VITE_SUPABASE_ANON_KEY`.
- Account GitHub o GitLab dove creare il repository.
- Account Netlify collegato al repository.
- Dominio desiderato, anche provvisorio Netlify.
- Scelta login iniziale: email/password oppure magic link.

## Prima di andare online

1. Sostituire la login locale con Supabase Auth reale.
2. Riattivare RLS su tutte le tabelle pubbliche.
3. Verificare che ogni tabella dati abbia `household_id`.
4. Rendere privato il bucket documenti.
5. Consentire accesso ai documenti solo ai membri della famiglia.
6. Gestire ruoli famiglia: `owner`, `editor`, `viewer`.
7. Aggiungere inviti famiglia.
8. Aggiungere impostazioni famiglia: nome, logo, colore, valuta, preferenze report.
9. Tenere `.env.local` fuori da Git.
10. Configurare le variabili su Netlify.

## Regole di privacy

- La UI puo filtrare, ma la sicurezza vera deve stare in Supabase RLS.
- Un utente puo vedere solo righe di famiglie in cui esiste una riga in `household_members`.
- Le policy di insert/update/delete devono controllare anche il ruolo del membro.
- I documenti non devono essere pubblici.
- Le URL dei file devono essere firmate o comunque generate solo dopo controllo membership.

## Deploy

- Repository Git con branch principale.
- Netlify collegato al repository.
- Build command: `npm run build`.
- Publish directory: `dist`.
- Redirect SPA gia presente in `netlify.toml`.
- Variabili Netlify:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

## Priorita tecnica

1. Mobile navigation e layout.
2. Supabase Auth.
3. RLS produzione.
4. Storage privato documenti.
5. Famiglie e inviti.
6. Personalizzazione famiglia.
7. Git e Netlify.
