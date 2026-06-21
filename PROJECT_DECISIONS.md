# Decisioni di Progetto (FamilyLedger)

Questo file documenta le decisioni tecniche principali prese durante lo sviluppo di FamilyLedger. Serve come riferimento sia per il team di sviluppo che per Codex.

## 1. Stack Tecnico Frontend
- **Framework**: React + Vite + TypeScript.
- **Styling**: Vanilla CSS (CSS Modules) per mantenere l'interfaccia pulita, controllabile e con una codebase più leggera rispetto a framework utility-first come Tailwind.
- **PWA**: Si, predisposizione a PWA sin dall'inizio per un utilizzo primario da mobile.

## 2. Backend & Database
- **Provider**: Supabase. Fornisce PostgreSQL, Auth, Storage e Row Level Security in un pacchetto unico, velocizzando il MVP.
- **Database-first**: Tutte le logiche finanziarie si basano su viste o calcoli derivati direttamente dalle transazioni (la source of truth).
- **RLS (Row Level Security)**: È implementata fin da subito. Ogni dato appartiene ad un `household_id` ed è visibile solo ai membri di quel nucleo familiare.

## 3. Gestione Conti e Trasferimenti
- **Conto Unico**: Come deciso, l'applicazione gestisce un singolo conto corrente "Conto Principale" condiviso tra l'intero nucleo familiare (household).
- Di conseguenza, non sono previsti trasferimenti (giroconto) né gestione carte prepagate separate. Le transazioni sono solo "entrate" o "uscite".

## 4. OCR e Workflow a Bozze
- L'OCR per scontrini e PDF crea delle transazioni in stato di bozza (`draft` o `pending_review`).
- Il budget **non** viene mai modificato automaticamente senza la conferma umana.

## 5. Previsioni Finanziarie
- Nel MVP non c'è AI opaca. Le previsioni usano metodi trasparenti e spiegabili (media mobile, spese ricorrenti note, previsione di fine mese lineare).

## 6. Autenticazione e Modalità Demo
- Per le prime iterazioni e test, l'app include un seme dati e permette di visualizzare un "Household Demo" senza passare dal login effettivo, pur avendo lo schema RLS e Auth configurati nel database.

## 7. Decision: No Excel data import for MVP
The provided Excel files are not data sources. They are structural references only. FamilyLedger must start as a blank application (Virgin App policy). Any demo data must be fictional and strictly isolated from production data. Onboarding is required to set up the first household and accounts.
