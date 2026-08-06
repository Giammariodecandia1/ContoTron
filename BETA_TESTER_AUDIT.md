# Verifica note beta tester

Documento verificato: NOTE BUDGET FAMILIARE GIAMMARIO bis.docx, revisione del
6 agosto 2026.

## Esito punti 1-55

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
36. **Spese ripetitive mensili editabili** - Implementato e generate soltanto
    quando il mese e iniziato.
37. **Istogramma categorie decrescente** - Implementato.
38. **Modifica budget limitata al mese selezionato** - Implementato con target
    univoci per anno, mese, categoria e sottocategoria.
39. **Modifica spese fisse** - Implementato.
40. **Stesso colore mese nei grafici annuali** - Implementato.
41. **Rimozione tipo Fissa dalla categoria principale** - Implementato; il
    tipo e gestito sulle sottocategorie.
42. **Medie mensili senza righe duplicate** - Implementato nei KPI superiori.
43. **Percentuali categorie in ordine decrescente** - Implementato.
44. **Confronto righe OCR/articoli** - Implementato con contatore e avviso.
45. **Rimozione grafici Dashboard non richiesti** - Implementato.
46. **Impaginazione desktop/mobile** - Implementato con layout responsive.
47. **Titoli piu riconoscibili** - Implementato con peso, contrasto e accento.
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
