# FamilyLedger

FamilyLedger è una PWA per la gestione semplice, condivisa e predittiva del budget familiare/personale, basata su React, Vite, TypeScript, e Supabase. Nasce per trasformare file Excel di budget in un'applicazione moderna e intelligente.

## Data Policy
The original Excel files are used only as structural inspiration. No real data from those files is imported into the application. The production app starts empty and is populated only by the user through onboarding, manual input, OCR/PDF review, or future explicit imports.

## Obiettivi MVP
- Setup progetto e struttura base
- Gestione multi-conto (saldi reali e trasferimenti)
- Tracking entrate, uscite e budget mensile/annuale
- Dashboard con visione chiara della liquidità
- Predisposizione all'upload e validazione scontrini (bozze OCR)

## Stack Tecnico
- **Frontend**: React + Vite + TypeScript
- **Styling**: Vanilla CSS (CSS Modules)
- **Database e Auth**: Supabase (PostgreSQL + RLS + Storage)
- **Deployment**: Netlify
- **PWA**: PWA nativa per un facile accesso da smartphone

## Struttura Cartelle
- `src/components/`: Componenti React riusabili (suddivisi per dominio)
- `src/pages/`: Le pagine principali dell'applicazione
- `src/lib/`: Librerie di utilità e logica finanziaria pura (money, dates, forecast)
- `src/services/`: Chiamate al database (Supabase)
- `src/types/`: Definizioni TypeScript per il database e l'interfaccia
- `supabase/`: Migrazioni SQL, RLS, policy e dati di seed

## Setup
1. Clonare il repository.
2. Eseguire `npm install`.
3. Creare un file `.env` partendo da `.env.example`.
4. (Opzionale) Applicare le migrazioni in `supabase/migrations/` al proprio progetto Supabase.
5. Eseguire `npm run dev`.

## Stato di Avanzamento
Attualmente in **Fase 1**: Setup del progetto base, inizializzazione della struttura di cartelle e migrazioni Supabase.
