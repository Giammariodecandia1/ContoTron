# Contesto Progetto: FamilyLedger

Questo file contiene lo stato completo del progetto "FamilyLedger", utile per riprendere rapidamente lo sviluppo in qualsiasi momento senza dover ispezionare l'intero codice.

## 1. Informazioni Generali
- **Stack**: React 19, TypeScript, Vite, CSS Modules.
- **Database**: Supabase (PostgreSQL).
- **Stato Auth**: Attualmente **disabilitato** (RLS disabilitata via `disable_auth.sql`, no Supabase Auth). Il login è "finto" (salvataggio del profilo in `localStorage` in `AuthContext.tsx`).
- **Obiettivo**: App mobile-first per la gestione delle finanze familiari con OCR per scontrini e auto-apprendimento delle categorie.

## 2. Struttura del Database (Principale)
- `profiles`: Profili utente finti (ID auto-generati, niente email richiesta).
- `households`: Nucleo familiare (ne esiste uno solo per ora).
- `household_members`: Collegamento profiles <-> households.
- `accounts`: Conti correnti (es. Conto Principale).
- `categories`: Categorie principali (es. Assicurazione, Alimentari). Tipi: `expense`, `income`, `transfer`.
- `subcategories`: Sottocategorie (es. Auto sotto Assicurazione). Legate a `category_id` in CASCADE.
- `transactions`: Transazioni con `amount`, `date`, `merchant`, `category_id`, `subcategory_id`, ecc.
- `classification_rules`: Regole per OCR. Mappa un `match_text` (es. "brico") a `category_id` e `subcategory_id`.

**ATTENZIONE**: RLS è disabilitato su quasi tutto, le policy in `consolidated_migration.sql` non sono attive a causa dell'esecuzione di `disable_auth.sql`.

## 3. Architettura Frontend
- **Routing** (`App.tsx`): 3 livelli di router in base a: Nessun utente (`/login`) -> Nessun household (`/onboarding`) -> App principale (Dashboard, Transazioni, ecc.).
- **Contexts**:
  - `AuthContext`: Gestisce l'utente finto in `localStorage`.
  - `HouseholdContext`: Carica in parallelo household, account e categorie. **NON carica le subcategories**.
- **Hooks**:
  - `useTransactions`: Fetcha e salva transazioni (`addTransaction`).

## 4. Stato delle Feature (Da Completare)

Il piano attuale prevede di implementare 3 funzionalità bloccanti per l'utente:

### A. Fix Cancellazione Profili
- **Dove**: `UserSelectPage.tsx`.
- **Problema**: Cancellare un utente fallisce silenziosamente se l'utente è il creatore (`created_by`) di un `households` (chiave esterna senza CASCADE).
- **Soluzione**: Verificare se l'utente ha creato un household. Se sì, avvisare che verranno eliminati tutti i dati e procedere a eliminare prima l'household (che ha CASCADE su tutto il resto).

### B. Sottocategorie
- **Dove**: `HouseholdContext.tsx`, `CategoriesPage.tsx`, `NewTransactionPage.tsx`.
- **Problema**: La tabella DB c'è, i tipi TS ci sono, ma non vengono mai caricate né mostrate.
- **Soluzione**:
  1. Caricarle nel `HouseholdContext`.
  2. In `CategoriesPage`, rendere le categorie espandibili (accordion) per gestire le sottocategorie.
  3. In `NewTransactionPage`, aggiungere un menu a tendina dipendente dalla categoria scelta.

### C. OCR Auto-Apprendente (Smart Classification)
- **Dove**: `ScanReceiptPage.tsx`, `useTransactions.ts`.
- **Problema**: L'OCR riconosce il testo ma classifica usando un dizionario hardcoded (`categoryKeywords`).
- **Soluzione**:
  1. Quando si salva una transazione con un `merchant`, fare upsert su `classification_rules` (memorizza abitudine).
  2. Quando l'OCR finisce, interrogare prima `classification_rules` passando il testo estratto. Se trova match, usare quelle categorie. Altrimenti fallback sul dizionario hardcoded.

## 5. File Chiave per queste Modifiche
- `e:\Gestione Finanze\familyledger\src\pages\UserSelectPage.tsx`
- `e:\Gestione Finanze\familyledger\src\contexts\HouseholdContext.tsx`
- `e:\Gestione Finanze\familyledger\src\pages\CategoriesPage.tsx`
- `e:\Gestione Finanze\familyledger\src\pages\CategoriesPage.module.css`
- `e:\Gestione Finanze\familyledger\src\pages\NewTransactionPage.tsx`
- `e:\Gestione Finanze\familyledger\src\pages\ScanReceiptPage.tsx`
- `e:\Gestione Finanze\familyledger\src\hooks\useTransactions.ts`

**Punto di ripresa**: Il piano di implementazione dettagliato (`implementation_plan.md`) è stato appena generato. Basta leggerlo e iniziare l'esecuzione per completare le 3 feature.
