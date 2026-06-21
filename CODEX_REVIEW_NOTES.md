# Note per la Revisione di Codex

Questo progetto implementa il gestionale "FamilyLedger".
Il codice è stato strutturato per essere leggibile, modulare e per facilitare le revisioni architetturali.

## Struttura e Convenzioni
- L'interfaccia utente è in **Italiano**, ma il codice, i nomi delle variabili e dei file sono in **Inglese**.
- Il layout usa **CSS Modules** nativi.
- La logica di business finanziaria pura (calcoli, formattazione, predizioni) è separata dalla UI e risiede sotto `src/lib/`.
- L'interazione col DB è centralizzata sotto `src/services/`.

## Aree di attenzione per la revisione (Focus points)
1. **Sicurezza RLS**: Tutte le tabelle hanno RLS abilitata che filtra per `household_id`. Verifica che non ci siano policy aperte o possibilità di leggere dati cross-household.
2. **Trasferimenti (Transfers)**: Verifica che la logica delle transazioni di tipo `transfer` aggiorni correttamente i saldi dei conti (`account_id` e `destination_account_id`) senza essere conteggiate come entrate/uscite nel calcolo del budget.
3. **Draft Workflow (OCR/PDF)**: Assicurarsi che le transazioni derivate da documenti mantengano lo stato "draft" finché non confermate esplicitamente dall'utente.
4. **Separation of Concerns**: Verificare che le componenti UI non contengano logica di calcolo pesante che potrebbe essere spostata in `src/lib/`.

## Note Aggiuntive
## Important review note

Please verify that no real data from the original Excel files is imported, seeded, hardcoded, or used in demo data.
The app must start blank in production.
Excel files are structural references only.
