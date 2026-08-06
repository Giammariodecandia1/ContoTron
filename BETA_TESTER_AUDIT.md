# Verifica note beta tester

Documento verificato: NOTE BUDGET FAMILIARE GIAMMARIO bis (3).docx.

## Esito punti 1-56

1. **Dashboard annuale e medie mensili** - Implementato: tabella mensile,
   medie di entrate/uscite e incidenza delle uscite sull'entrata media.
2. **Budget annuale per categoria** - Implementato: previsto e consuntivo per
   ogni mese, categorie alfabetiche e layout responsive.
3. **Indicazione affidabilita totale OCR** - Implementato: fonte del totale e
   messaggio di confidenza comprensibile.
4. **Eliminazione scansione non salvata** - Implementato: rimozione pagine e
   comando Annulla scansione.
5. **Caratteristiche delle sottocategorie** - Implementato tramite Tipo spesa.
6. **Commento transazione** - Implementato.
7. **Periodicita obbligatoria e report** - Implementato.
8. **Tutte le spese nel grafico categorie** - Implementato, compresi articoli
   di scontrini multi-categoria.
9. **Dashboard senza elenco transazioni** - Implementato.
10. **Spese fisse automatiche** - Implementato con data iniziale, durata,
    scadenza e salvataggio esplicito.
11. **Frequenza nelle transazioni** - Implementato con etichetta Periodicita.
12. **Entrate e delta nel Consuntivo** - Implementato; categorie alfabetiche.
13. **Carta di credito e impatto mese successivo** - Implementato.
14. **Tag Tipo spesa sulle sottocategorie** - Implementato.
15. **Media e mediana Alimentari** - Implementato nella pagina dedicata.
16. **Totale non trattato come prodotto** - Implementato.
17. **Apprendimento prodotti e classificazione** - Implementato per nucleo.
18. **Prezzo unitario non duplicato** - Implementato.
19. **Correzione OCR zero/nove e riconciliazione** - Implementato.
20. **Caratteristiche Alimentari** - Implementato con tre valori previsti.
21. **Consuntivo alleggerito e settimane 1-52** - Implementato.
22. **Sottocategorie espandibili nel Consuntivo** - Implementato.
23. **Tipologia guidata spese fisse** - Implementato.
24. **Sottocategorie Alimentari alfabetiche** - Implementato.
25. **Uscite previste dal budget** - Implementato.
26. **Nessuna categoria globale dello scontrino** - Implementato; la
    classificazione e per articolo.
27. **Flusso OCR senza riepilogo ridondante** - Implementato.
28. **IVA non riconosciuta come totale** - Implementato.
29. **Articoli non alimentari negli scontrini** - Implementato con categoria
    e sottocategoria per riga.
30. **Inserimento manuale righe mancanti** - Implementato.
31. **Report sottocategorie Alimentari** - Implementato nel dettaglio
    espandibile del Consuntivo.
32. **Report caratteristiche per tutte le categorie** - Implementato tramite
    i Tipi di spesa assegnati alle sottocategorie.
33. **Consuntivo sotto Budget e totali coerenti** - Implementato usando la
    stessa data di impatto sul budget.
34. **Grafici adattivi** - Implementato.
35. **Spese fisse nel budget previsto** - Implementato mediante sincronizzazione
    delle regole ricorrenti nei target mensili.
36. **Spese ripetitive mensili editabili** - Implementato con TAG esplicito,
    generazione soltanto quando il mese e iniziato e aggiornamento immediato
    del movimento e del budget del mese corrente dopo una modifica.
37. **Istogramma categorie decrescente** - Implementato.
38. **Modifica budget limitata al mese selezionato** - Implementato con target
    univoci per anno, mese, categoria e sottocategoria.
39. **Modifica spese fisse** - Implementato.
40. **Stesso colore mese nei grafici annuali** - Implementato.
41. **Rimozione tipo Fissa dalla categoria principale** - Implementato; il
    tipo e gestito sulle sottocategorie.
42. **Medie mensili senza righe duplicate** - Implementato: i totali annuali
    restano nei KPI superiori e la tabella mantiene una sola riga finale
    dedicata alle medie mensili.
43. **Percentuali categorie in ordine decrescente** - Implementato.
44. **Confronto righe OCR/articoli** - Implementato con contatore e avviso.
45. **Rimozione grafici Dashboard non richiesti** - Implementato.
46. **Impaginazione desktop/mobile** - Implementato con layout responsive.
47. **Titoli piu riconoscibili** - Implementato con dimensione maggiore, peso,
    contrasto, sfondo leggero e accento laterale coerente in tutte le pagine.
48. **Necessaria al posto di Non definita** - Implementato e migrato.
49. **Caratteristiche Alimentari annuali, non mensili** - Implementato.
50. **Tipi di spesa annuali** - Implementato.
51. **Coerenza Budget/Analisi annuale** - Implementato con data di impatto.
52. **Conteggio Tipi di spesa sulle sottocategorie** - Implementato.
53. **Pagina dedicata media/mediana Alimentari** - Implementato nella route
    /analisi-alimentari.
54. **Prezzo negativo come sconto** - Implementato: lo sconto riduce la riga
    prodotto precedente ed entra nella riconciliazione del totale.
55. **Riga VALORI SCONTI non inserita** - Implementato: le righe sconto non
    diventano articoli separati.
56. **Elenco completo spese fisse nel Budget Mensile** - Implementato: il mese
    mostra tutte le spese ripetitive applicabili, il loro totale, categoria e
    sottocategoria. I badge sono ricavati dalle regole e non soltanto dalle
    righe budget create automaticamente; le voci pregresse senza categoria
    sono segnalate e le nuove richiedono obbligatoriamente una categoria.

## Funzione Split

La pagina /split calcola le spese condivise per conto, intervallo di date e
partecipanti. Per ogni membro mostra:

- totale speso e numero di movimenti;
- percentuale sul totale;
- quota paritaria;
- importo da versare o da ricevere;
- trasferimenti minimi suggeriti per pareggiare le spese, anche con piu di due
  partecipanti.

I calcoli sono eseguiti in centesimi per evitare errori di arrotondamento.

## Modalita semplice

La visualizzazione Semplice si attiva da Impostazioni ed e una preferenza
personale per account. Non cambia il motore, non cancella dati e non modifica
le classificazioni gia presenti.

- mostra un riepilogo mensile con spese, entrate, differenza, media giornaliera
  e stima a fine mese;
- mantiene inserimento essenziale, elenco movimenti e Split;
- non richiede categoria o sottocategoria per le nuove spese semplici;
- nasconde navigazione, campi e pagine avanzate, che restano operative nel
  motore;
- tornando alla visualizzazione Completa ripristina immediatamente tutte le
  funzioni e i dati avanzati gia salvati;
- modificare un movimento dalla visualizzazione Semplice conserva i campi
  avanzati nascosti finche non viene cambiato intenzionalmente il tipo del
  movimento.
