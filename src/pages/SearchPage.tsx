import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { supabase } from '../lib/supabaseClient';
import { getDocumentUrl } from '../lib/documentArchive';
import { useHousehold } from '../hooks';
import type { DocumentType } from '../types/database';
import styles from './SearchPage.module.css';

const monthLabels = [
  'Gennaio',
  'Febbraio',
  'Marzo',
  'Aprile',
  'Maggio',
  'Giugno',
  'Luglio',
  'Agosto',
  'Settembre',
  'Ottobre',
  'Novembre',
  'Dicembre',
];

const documentTypeLabels: Record<string, string> = {
  receipt: 'Scontrino',
  bill: 'Bolletta',
  invoice: 'Fattura',
  bank_statement: 'Estratto conto',
  contract: 'Contratto',
  other: 'Altro',
};

interface TransactionResult {
  id: string;
  transaction_date: string;
  description: string;
  merchant: string | null;
  amount: number;
  type: string;
  status: string;
  inserted_by: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  notes?: string | null;
  categories?: { name?: string | null } | null;
  subcategories?: { name?: string | null } | null;
  inserted_by_profile?: { display_name?: string | null } | null;
}

interface ItemResult {
  id: string;
  description: string;
  amount: number;
  category_id: string | null;
  subcategory_id: string | null;
  transactions?: TransactionResult | null;
  categories?: { name?: string | null } | null;
  subcategories?: { name?: string | null } | null;
}

interface DocumentResult {
  id: string;
  original_filename: string;
  vendor_name: string | null;
  type: DocumentType;
  document_date: string | null;
  total_amount: number | null;
  storage_path: string;
  url?: string;
  ocr_text?: string | null;
}

type SortMode = 'date_desc' | 'amount_desc' | 'amount_asc';

const normalize = (value: string) => (
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
);

const includesText = (values: Array<string | null | undefined>, text: string) => {
  const query = normalize(text.trim());
  if (!query) return true;
  return normalize(values.filter(Boolean).join(' ')).includes(query);
};

const isInPeriod = (date: string | null | undefined, year: string, month: string, from: string, to: string) => {
  if (!date) return false;
  if (year !== 'all' && !date.startsWith(`${year}-`)) return false;
  if (month !== 'all' && date.slice(5, 7) !== month.padStart(2, '0')) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
};

const sumByKey = <T,>(items: T[], getKey: (item: T) => string, getValue: (item: T) => number) => {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item) || 'Non classificato';
    acc[key] = (acc[key] || 0) + getValue(item);
    return acc;
  }, {});
};

const topEntry = (totals: Record<string, number>) => (
  Object.entries(totals).sort((a, b) => b[1] - a[1])[0] || null
);

const sortTransactions = (items: TransactionResult[], sortMode: SortMode) => {
  return [...items].sort((a, b) => {
    if (sortMode === 'amount_desc') return b.amount - a.amount;
    if (sortMode === 'amount_asc') return a.amount - b.amount;
    return b.transaction_date.localeCompare(a.transaction_date);
  });
};

const sortDocuments = (items: DocumentResult[], sortMode: SortMode) => {
  return [...items].sort((a, b) => {
    if (sortMode === 'amount_desc') return (b.total_amount || 0) - (a.total_amount || 0);
    if (sortMode === 'amount_asc') return (a.total_amount || 0) - (b.total_amount || 0);
    return (b.document_date || '').localeCompare(a.document_date || '');
  });
};

export const SearchPage: React.FC = () => {
  const { household, categories } = useHousehold();
  const currentYear = new Date().getFullYear();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionResult[]>([]);
  const [items, setItems] = useState<ItemResult[]>([]);
  const [documents, setDocuments] = useState<DocumentResult[]>([]);

  const [textFilter, setTextFilter] = useState('');
  const [yearFilter, setYearFilter] = useState<string>(String(currentYear));
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [merchantFilter, setMerchantFilter] = useState('');
  const [insertedByFilter, setInsertedByFilter] = useState('all');
  const [documentTypeFilter, setDocumentTypeFilter] = useState<string>('all');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('date_desc');

  const loadData = useCallback(async () => {
    if (!household) return;

    setLoading(true);
    setError(null);

    try {
      const { data: txRows, error: txError } = await supabase
        .from('transactions')
        .select('*, categories(name), subcategories(name), inserted_by_profile:profiles!transactions_inserted_by_fkey(display_name)')
        .eq('household_id', household.id)
        .neq('status', 'deleted')
        .order('transaction_date', { ascending: false });
      if (txError) throw txError;

      const { data: itemRows } = await supabase
        .from('transaction_items')
        .select('*, transactions!inner(*), categories(name), subcategories(name)')
        .eq('household_id', household.id)
        .order('created_at', { ascending: false });

      const { data: docRows, error: docError } = await supabase
        .from('documents')
        .select('*')
        .eq('household_id', household.id)
        .order('document_date', { ascending: false });
      if (docError) throw docError;

      const documentIds = (docRows || []).map(doc => doc.id);
      const { data: ocrRows } = documentIds.length > 0
        ? await supabase.from('ocr_jobs').select('document_id, extracted_text').in('document_id', documentIds)
        : { data: [] };

      const ocrByDocument = (ocrRows || []).reduce<Record<string, string | null>>((acc, row) => {
        acc[row.document_id] = row.extracted_text || null;
        return acc;
      }, {});

      const documentsWithUrls = await Promise.all(((docRows || []) as DocumentResult[]).map(async doc => ({
        ...doc,
        ocr_text: ocrByDocument[doc.id] || null,
        url: await getDocumentUrl(doc.storage_path),
      })));

      setTransactions((txRows || []) as TransactionResult[]);
      setItems((itemRows || []) as ItemResult[]);
      setDocuments(documentsWithUrls);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore durante il caricamento dati');
    } finally {
      setLoading(false);
    }
  }, [household]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const amountLimits = useMemo(() => ({
    min: minAmount ? Number(minAmount) : null,
    max: maxAmount ? Number(maxAmount) : null,
  }), [maxAmount, minAmount]);

  const insertedByOptions = useMemo(() => {
    const map = new Map<string, string>();
    transactions.forEach(tx => {
      if (tx.inserted_by) {
        map.set(tx.inserted_by, tx.inserted_by_profile?.display_name || 'Sconosciuto');
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    const filtered = transactions.filter(tx => {
      if (!isInPeriod(tx.transaction_date, yearFilter, monthFilter, dateFrom, dateTo)) return false;
      if (categoryFilter !== 'all' && tx.category_id !== categoryFilter) return false;
      if (amountLimits.min !== null && tx.amount < amountLimits.min) return false;
      if (amountLimits.max !== null && tx.amount > amountLimits.max) return false;
      if (insertedByFilter !== 'all' && tx.inserted_by !== insertedByFilter) return false;
      if (!includesText([tx.description, tx.merchant, tx.notes, tx.categories?.name, tx.subcategories?.name], textFilter)) return false;
      if (!includesText([tx.merchant, tx.description], merchantFilter)) return false;
      return true;
    });

    return sortTransactions(filtered, sortMode);
  }, [amountLimits, categoryFilter, dateFrom, dateTo, insertedByFilter, merchantFilter, monthFilter, sortMode, textFilter, transactions, yearFilter]);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const tx = item.transactions;
      const date = tx?.transaction_date;
      if (!isInPeriod(date, yearFilter, monthFilter, dateFrom, dateTo)) return false;
      if (categoryFilter !== 'all' && item.category_id !== categoryFilter && tx?.category_id !== categoryFilter) return false;
      if (amountLimits.min !== null && item.amount < amountLimits.min) return false;
      if (amountLimits.max !== null && item.amount > amountLimits.max) return false;
      if (insertedByFilter !== 'all' && tx?.inserted_by !== insertedByFilter) return false;
      if (!includesText([item.description, item.categories?.name, item.subcategories?.name, tx?.description, tx?.merchant], textFilter)) return false;
      if (!includesText([tx?.merchant, tx?.description], merchantFilter)) return false;
      return true;
    }).sort((a, b) => {
      if (sortMode === 'amount_desc') return b.amount - a.amount;
      if (sortMode === 'amount_asc') return a.amount - b.amount;
      return (b.transactions?.transaction_date || '').localeCompare(a.transactions?.transaction_date || '');
    });
  }, [amountLimits, categoryFilter, dateFrom, dateTo, insertedByFilter, items, merchantFilter, monthFilter, sortMode, textFilter, yearFilter]);

  const filteredDocuments = useMemo(() => {
    const filtered = documents.filter(doc => {
      if (!isInPeriod(doc.document_date, yearFilter, monthFilter, dateFrom, dateTo)) return false;
      if (documentTypeFilter !== 'all' && doc.type !== documentTypeFilter) return false;
      if (amountLimits.min !== null && (doc.total_amount || 0) < amountLimits.min) return false;
      if (amountLimits.max !== null && (doc.total_amount || 0) > amountLimits.max) return false;
      if (!includesText([doc.original_filename, doc.vendor_name, doc.type, doc.ocr_text], textFilter)) return false;
      if (!includesText([doc.vendor_name, doc.original_filename], merchantFilter)) return false;
      return true;
    });

    return sortDocuments(filtered, sortMode);
  }, [amountLimits, dateFrom, dateTo, documentTypeFilter, documents, merchantFilter, monthFilter, sortMode, textFilter, yearFilter]);

  const expenseTransactions = filteredTransactions.filter(tx => tx.type === 'expense' && tx.status !== 'rejected');
  const totalExpense = expenseTransactions.reduce((acc, tx) => acc + tx.amount, 0);
  const itemTotal = filteredItems.reduce((acc, item) => acc + item.amount, 0);
  const topCategory = topEntry(sumByKey(expenseTransactions, tx => tx.categories?.name || 'Non classificato', tx => tx.amount));
  const topMerchant = topEntry(sumByKey(expenseTransactions, tx => tx.merchant || tx.description || 'Senza esercente', tx => tx.amount));
  const biggestExpense = expenseTransactions[0] && sortTransactions(expenseTransactions, 'amount_desc')[0];

  const resetFilters = () => {
    setTextFilter('');
    setYearFilter(String(currentYear));
    setMonthFilter('all');
    setDateFrom('');
    setDateTo('');
    setCategoryFilter('all');
    setMerchantFilter('');
    setInsertedByFilter('all');
    setDocumentTypeFilter('all');
    setMinAmount('');
    setMaxAmount('');
    setSortMode('date_desc');
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Analisi e Ricerca Dati</h1>
        <p className="text-muted">Filtra i dati in memoria e confronta transazioni, righe scontrino, documenti e OCR.</p>
      </header>

      <Card title="Filtri" icon={<BarChart3 size={20} />} action={<Button size="sm" variant="secondary" icon={<RefreshCw size={16} />} onClick={loadData}>Aggiorna dati</Button>}>
        <div className={styles.filterPanel}>
          <div className={styles.fieldWide}>
            <label>Testo, articolo o argomento</label>
            <input className={styles.input} value={textFilter} onChange={event => setTextFilter(event.target.value)} placeholder="es. pane, Conad, luce, scuola" />
          </div>

          <div>
            <label>Anno</label>
            <select className={styles.select} value={yearFilter} onChange={event => setYearFilter(event.target.value)}>
              <option value="all">Tutti</option>
              {Array.from({ length: 8 }, (_, index) => currentYear - index).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          <div>
            <label>Mese</label>
            <select className={styles.select} value={monthFilter} onChange={event => setMonthFilter(event.target.value)}>
              <option value="all">Tutti</option>
              {monthLabels.map((label, index) => (
                <option key={label} value={String(index + 1)}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label>Da data</label>
            <input className={styles.input} type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} />
          </div>

          <div>
            <label>A data</label>
            <input className={styles.input} type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} />
          </div>

          <div>
            <label>Categoria</label>
            <select className={styles.select} value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}>
              <option value="all">Tutte</option>
              {categories.filter(category => category.type === 'expense').map(category => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label>Esercente / fornitore</label>
            <input className={styles.input} value={merchantFilter} onChange={event => setMerchantFilter(event.target.value)} placeholder="es. Coop, Enel" />
          </div>

          <div>
            <label>Inserita da</label>
            <select className={styles.select} value={insertedByFilter} onChange={event => setInsertedByFilter(event.target.value)}>
              <option value="all">Tutti</option>
              {insertedByOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </div>

          <div>
            <label>Tipo documento</label>
            <select className={styles.select} value={documentTypeFilter} onChange={event => setDocumentTypeFilter(event.target.value)}>
              <option value="all">Tutti</option>
              {Object.entries(documentTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label>Importo minimo</label>
            <input className={styles.input} type="number" step="0.01" value={minAmount} onChange={event => setMinAmount(event.target.value)} />
          </div>

          <div>
            <label>Importo massimo</label>
            <input className={styles.input} type="number" step="0.01" value={maxAmount} onChange={event => setMaxAmount(event.target.value)} />
          </div>

          <div>
            <label>Ordinamento</label>
            <select className={styles.select} value={sortMode} onChange={event => setSortMode(event.target.value as SortMode)}>
              <option value="date_desc">Piu recenti</option>
              <option value="amount_desc">Importo maggiore</option>
              <option value="amount_asc">Importo minore</option>
            </select>
          </div>
        </div>

        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={resetFilters}>Pulisci filtri</Button>
          <span className="text-muted fs-sm">{loading ? 'Caricamento dati...' : `${transactions.length} transazioni, ${items.length} righe, ${documents.length} documenti in memoria`}</span>
        </div>
      </Card>

      {error && <Card><div className="text-danger">{error}</div></Card>}

      <div className={styles.stats}>
        <div className={styles.statBox}>
          <div className={styles.statLabel}>Spesa transazioni filtrate</div>
          <div className={styles.statValue}>{totalExpense.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}</div>
        </div>
        <div className={styles.statBox}>
          <div className={styles.statLabel}>Totale righe articolo</div>
          <div className={styles.statValue}>{itemTotal.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}</div>
        </div>
        <div className={styles.statBox}>
          <div className={styles.statLabel}>Categoria principale</div>
          <div className={styles.statValue}>{topCategory ? `${topCategory[0]} (${topCategory[1].toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })})` : '-'}</div>
        </div>
        <div className={styles.statBox}>
          <div className={styles.statLabel}>Da dove viene la spesa maggiore</div>
          <div className={styles.statValue}>{topMerchant ? `${topMerchant[0]} (${topMerchant[1].toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })})` : '-'}</div>
        </div>
      </div>

      <div className={styles.resultGrid}>
        <Card title={`Transazioni (${filteredTransactions.length})`}>
          <div className={styles.resultList}>
            {filteredTransactions.length === 0 ? <div className={styles.empty}>Nessuna transazione per questi filtri.</div> : filteredTransactions.map(tx => (
              <div key={tx.id} className={styles.resultItem}>
                <div className={styles.resultHeader}>
                  <div>
                    <div className={styles.resultTitle}>{tx.description}</div>
                    <div className={styles.meta}>{tx.transaction_date} - {tx.merchant || 'Senza esercente'} - {tx.categories?.name || 'Non classificato'} - inserita da {tx.inserted_by_profile?.display_name || 'Sconosciuto'}</div>
                  </div>
                  <div className={styles.amount}>{tx.type === 'expense' ? '-' : '+'}{tx.amount.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title={`Righe scontrino / articoli (${filteredItems.length})`}>
          <div className={styles.resultList}>
            {filteredItems.length === 0 ? <div className={styles.empty}>Nessuna riga articolo trovata. Quando salveremo gli item degli scontrini, qui potrai cercare prodotti come pane o latte.</div> : filteredItems.map(item => (
              <div key={item.id} className={styles.resultItem}>
                <div className={styles.resultHeader}>
                  <div>
                    <div className={styles.resultTitle}>{item.description}</div>
                    <div className={styles.meta}>{item.transactions?.transaction_date || ''} - {item.transactions?.merchant || item.transactions?.description || ''}</div>
                  </div>
                  <div className={styles.amount}>{item.amount.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title={`Documenti e OCR (${filteredDocuments.length})`}>
          <div className={styles.resultList}>
            {filteredDocuments.length === 0 ? <div className={styles.empty}>Nessun documento per questi filtri.</div> : filteredDocuments.map(doc => (
              <div key={doc.id} className={styles.resultItem}>
                <div className={styles.resultTitle}>{doc.vendor_name || doc.original_filename}</div>
                <div className={styles.meta}>{doc.document_date || 'Senza data'} - {documentTypeLabels[doc.type] || doc.type} - {doc.original_filename}</div>
                {doc.total_amount !== null && doc.total_amount !== undefined && (
                  <div className={styles.amount}>{doc.total_amount.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}</div>
                )}
                {doc.ocr_text && <div className={styles.meta}>{doc.ocr_text.slice(0, 180)}...</div>}
                {doc.url && <a href={doc.url} target="_blank" rel="noreferrer">Apri documento</a>}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Spesa singola piu alta">
          {biggestExpense ? (
            <div className={styles.resultItem}>
              <div className={styles.resultTitle}>{biggestExpense.description}</div>
              <div className={styles.meta}>{biggestExpense.transaction_date} - {biggestExpense.merchant || 'Senza esercente'} - {biggestExpense.categories?.name || 'Non classificato'} - inserita da {biggestExpense.inserted_by_profile?.display_name || 'Sconosciuto'}</div>
              <div className={styles.amount}>{biggestExpense.amount.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}</div>
            </div>
          ) : (
            <div className={styles.empty}>Nessuna spesa trovata.</div>
          )}
        </Card>
      </div>
    </div>
  );
};
