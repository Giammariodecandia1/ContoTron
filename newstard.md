# Contotron - Passaggio di consegne

Aggiornato: 29 luglio 2026

## Istruzione per la nuova conversazione

Leggere interamente questo file prima di modificare il progetto.

Il progetto si trova in:

`E:\Gestione Finanze\familyledger`

Prima di iniziare eseguire:

```powershell
git status --short
git log -5 --oneline --decorate
npm.cmd run lint
npm.cmd run build
```

Non annullare o sovrascrivere le modifiche locali elencate qui sotto. Non fare
deploy finche l'utente non lo chiede esplicitamente.

## Stato sintetico

- Applicazione: Contotron, gestionale web mobile-first per contabilita familiare.
- Frontend: React 19, TypeScript, Vite, CSS Modules.
- Backend: Supabase PostgreSQL, Auth Google, Storage e RLS per nucleo.
- OCR: Tesseract.js nel browser.
- Repository: `Giammariodecandia1/ContoTron`.
- Branch: `main`.
- Ultimo commit pubblicato: `9344ff8 Make active Netlify site self-contained`.
- `origin/main` e il branch locale puntano ancora a `9344ff8`.
- Sito canonico unico: `https://contotron.netlify.app`.
- Il vecchio sito `contotronapp.netlify.app` non deve essere riattivato.
- Le modifiche descritte sotto sono locali, non committate, non pushate e non
  pubblicate.

## Regole di sicurezza

1. Supabase e la fonte persistente dei dati degli utenti. Un deploy Netlify non
   deve cancellare dati.
2. Ogni query deve restare filtrata per `household_id`; RLS deve restare attiva.
3. Non inserire password, token Netlify, password PostgreSQL o chiavi private nei
   file versionati o nei messaggi finali.
4. Le variabili locali esistono in `.env.local`; citare solo i nomi delle
   variabili, mai i valori.
5. Usare un solo dominio pubblico: `https://contotron.netlify.app`.
6. Prima di un deploy: applicare le migrazioni necessarie, eseguire lint, build e
   test manuale dei flussi principali.

## Stato dei dati verificato

Ultimo controllo eseguito prima di questo handoff:

- progetto Supabase: `amemywpuzwehcykvkmdr`
- households: 12
- household_members: 10
- transactions: 113
- transaction_items: 232
- budget_targets: 145
- documents: 28
- categories: 170
- subcategories: 163
- recurring_rules: 12

Questi numeri sono uno snapshot storico e possono crescere. Non usare operazioni
distruttive per riallinearli.

## File di note piu recente

Documento del beta tester analizzato:

`E:\Gestione Finanze\NOTE BUDGET FAMILIARE GIAMMARIO 2807.docx`

Il DOCX e stato letto strutturalmente, incluse tabelle e immagini incorporate.
Non e stato possibile renderizzarlo in PNG perche LibreOffice non e installato
nell'ambiente. I punti 42-50 e i due nuovi report sono stati comunque ricostruiti
dal contenuto e dalle schermate incorporate.

## Ultima richiesta del beta tester

Il tester dichiarava mancanti i punti 42, 43, 44, 45, 47 e 48, con i nuovi punti
49 e 50 e un ulteriore report annuale.

### Implementazione locale effettuata

- Punto 42: in Gestione categorie il tipo di spesa non e piu scelto sulla
  categoria. Rimane configurabile sulle sottocategorie. Il campo database della
  categoria resta solo come fallback per dati senza sottocategoria.
- Punto 43: rimosse dalla tabella Dashboard le righe finali duplicate `Totale` e
  `Media mese`; i KPI superiori restano la sintesi.
- Punto 44: nell'istogramma annuale per categoria viene mostrata anche la
  percentuale sul totale, con ordinamento decrescente.
- Punto 45: dopo OCR viene mostrato un controllo tra righe con descrizione/prezzo
  individuate e articoli proposti. Sono spiegate le righe escluse come IVA,
  totale, pagamento o prezzo unitario e resta disponibile `Aggiungi riga`.
- Punto 46: rimossi dalla Dashboard i due grafici indicati dal consulente
  (`Spese per Categoria (Questo mese)` e `Andamento Spese`).
- Punto 47: corretta l'impaginazione mobile di Gestione categorie, evitando nomi
  spezzati lettera per lettera e controlli troppo stretti.
- Punto 48: corretti gli stili del componente Card. Il componente usava classi
  `.header/.title/.action`, mentre il CSS dichiarava nomi diversi; ora i titoli
  sono realmente piu grandi, marcati e riconoscibili.
- Punto 49: `food_characteristic = null` viene interpretato come `Necessaria`
  invece di `Non definita`; aggiunta una migrazione di backfill.
- Punto 50: aggiunta in Analisi annuale la tabella annuale
  `Caratteristiche alimentari`, con spesa, percentuale e numero voci.
- Nuovo report: aggiunta in Analisi annuale la tabella
  `Tipi di spesa: previsione e consuntivo`, con percentuali e barre di confronto.

I calcoli annuali evitano il doppio conteggio: quando una transazione ha righe
articolo valide, il totale viene ripartito proporzionalmente sulle righe e non
viene sommato una seconda volta come transazione intera.

## Modifiche Google Drive locali non ancora pubblicate

E stata implementata anche una revisione precedente del salvataggio documenti:

- ogni membro collega il proprio Google Drive;
- la connessione e salvata per coppia `household_id + user_id`;
- i token OAuth non vengono salvati nel database;
- onboarding e impostazioni mostrano in modo esplicito account e cartella;
- prima del salvataggio dello scontrino e mostrata la destinazione reale;
- se Drive non e autorizzato, il documento usa l'archivio interno per non andare
  perso;
- gli altri membri vedono dati, OCR e autore del caricamento; l'accesso al file
  Drive puo richiedere i permessi Google del proprietario.

Questa parte richiede la migrazione 023 e un test reale con almeno due account.

## Migrazioni locali non applicate

Applicare in quest'ordine solo quando si passa al test Supabase:

1. `supabase/migrations/023_member_google_drive_connections.sql`
2. `supabase/migrations/024_default_food_characteristics.sql`

La 023 crea le connessioni Google Drive per singolo membro con RLS.
La 024 assegna `necessary` alle sottocategorie Alimentari esistenti che hanno
ancora la caratteristica nulla.

Non considerare completa la funzionalita Drive finche la 023 non e applicata e
testata con account Google reali.

## Worktree locale da preservare

Al momento dell'handoff `git status --short` mostra:

```text
 M CONTEXT.md
 M src/components/ui/Card.module.css
 M src/components/ui/Card.tsx
 M src/hooks/index.ts
 M src/lib/documentArchive.ts
 M src/lib/documentStoragePreference.ts
 M src/lib/foodCharacteristics.ts
 M src/lib/googleDriveStorage.ts
 M src/lib/receiptParsing.ts
 M src/pages/AnnualAnalysisPage.module.css
 M src/pages/AnnualAnalysisPage.tsx
 M src/pages/CategoriesPage.module.css
 M src/pages/DashboardPage.module.css
 M src/pages/DashboardPage.tsx
 M src/pages/DocumentsPage.tsx
 M src/pages/OnboardingPage.module.css
 M src/pages/OnboardingPage.tsx
 M src/pages/ScanReceiptPage.module.css
 M src/pages/ScanReceiptPage.tsx
 M src/pages/SettingsPage.module.css
 M src/pages/SettingsPage.tsx
 M src/types/database.ts
?? newstard.md
?? src/hooks/usePersonalDriveConnection.ts
?? supabase/migrations/023_member_google_drive_connections.sql
?? supabase/migrations/024_default_food_characteristics.sql
```

Queste modifiche appartengono tutte al lavoro in corso e non vanno eliminate.

## Verifiche gia eseguite

Dopo le ultime modifiche:

```text
npm.cmd run lint   -> superato
npm.cmd run build  -> superato
```

La build Vite completa e stata generata correttamente il 28 luglio 2026.

Il server locale non e rimasto attivo alla fine della conversazione: il runner ha
interrotto il processo mentre veniva avviato. Per il test usare:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

oppure fare doppio clic su:

`E:\Gestione Finanze\familyledger\avvia-contotron-locale.bat`

URL locale:

`http://127.0.0.1:5173/`

## Test manuali ancora necessari

1. Login Google locale.
2. Dashboard:
   - assenza delle righe Totale/Media in fondo;
   - assenza dei due grafici eliminati;
   - percentuali corrette e totale pari a circa 100%.
3. Gestione categorie su desktop e smartphone:
   - nessun selettore tipo spesa sulla categoria;
   - sottocategorie leggibili senza testo verticale;
   - titolo Card ben visibile;
   - `Necessaria` presente per Alimentari.
4. Analisi annuale:
   - report Caratteristiche alimentari;
   - report Tipi di spesa previsione/consuntivo;
   - somme coerenti con le transazioni e nessun doppio conteggio.
5. OCR:
   - foto dalla fotocamera e dalla galleria;
   - scontrino multipagina;
   - confronto righe OCR/articoli;
   - IVA e prezzi unitari non trattati come prodotti;
   - somma articoli confrontata con il totale.
6. Google Drive:
   - migrazione 023 applicata;
   - due membri dello stesso nucleo;
   - ognuno salva sul proprio Drive;
   - fallback interno se manca autorizzazione.
7. Mobile:
   - nessuna sovrapposizione;
   - controlli utilizzabili con font ingrandito;
   - pagina aggiungi transazione resta la prima dopo il login.

## Limiti noti e decisioni aperte

- Il conteggio OCR delle righe e un controllo euristico, non una garanzia:
  aiuta l'utente a individuare prodotti mancanti.
- Le correzioni OCR migliorano il riconoscimento futuro solo nel nucleo corrente
  attraverso regole prodotto private; non esiste ancora un modello globale
  addestrato con i dati di tutte le famiglie.
- Il bundle di Analisi annuale e piu grande per Recharts, ma la build passa.
- La migrazione 024 persiste il fallback `Necessaria`; senza migrazione la UI
  mostra comunque il valore corretto.
- Non fare deploy su due siti. Il solo indirizzo pubblico da mantenere e
  `https://contotron.netlify.app`.

## Flusso consigliato per proseguire

1. Leggere questo file e `git diff`.
2. Avviare il progetto in locale.
3. Eseguire i test manuali sopra.
4. Correggere eventuali regressioni senza fare deploy.
5. Chiedere conferma all'utente prima di applicare migrazioni al database.
6. Dopo l'approvazione: applicare 023 e 024, ripetere lint/build e smoke test.
7. Solo su richiesta esplicita: commit, push su `main` e deploy del solo sito
   canonico.

## Documenti vecchi

`CONTEXT.md`, `TODO.md` e parti di `PROJECT_DECISIONS.md` descrivono fasi iniziali
ormai superate (login finto, RLS disabilitata, sottocategorie mancanti). Non
usarli come fonte dello stato corrente. Questo `newstard.md` e la fonte di
handoff aggiornata.

## Verifica finale note beta tester - 30 luglio 2026

E stato verificato anche il documento
`NOTE BUDGET FAMILIARE GIAMMARIO bis (1).docx`, compresa l'ultima indicazione
sul totale dei tipi di spesa.

Correzioni finali:

- Budget Mensile, Dashboard, Consuntivo e Analisi annuale usano la data di
  impatto sul budget per attribuire le spese al mese;
- il prospetto Tipi di spesa conta le sottocategorie configurate, non le righe
  delle transazioni, e usa l'etichetta `Sottocategorie`;
- il report alimentare e il riepilogo settimanale seguono lo stesso criterio
  temporale del budget.

Controlli autenticati completati:

- luglio 2026 coerente a `326,35 EUR` nelle quattro schermate;
- totale sottocategorie del nucleo di prova pari a 32 (il nucleo del beta
  tester mostrera le proprie 88);
- caratteristiche Alimentari visibili e senza valori indefiniti;
- categorie ordinate e percentuali del grafico coerenti;
- layout mobile verificato a 390 x 844 senza overflow orizzontale;
- form nuova transazione, spese fisse e acquisizione OCR verificati;
- nessun errore JavaScript rilevato durante i controlli.
