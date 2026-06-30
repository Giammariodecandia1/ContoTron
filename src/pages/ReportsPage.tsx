import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Calendar, Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency } from '../lib/money';
import { createTextPdf, type PdfLine } from '../lib/textPdf';
import { createExcelWorkbook, type ExcelSheet } from '../lib/excelXml';
import { useHousehold } from '../hooks';
import styles from './ReportsPage.module.css';

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
  receipt: 'Scontrini',
  bill: 'Bollette',
  invoice: 'Fatture',
  bank_statement: 'Estratti conto',
  contract: 'Contratti',
  other: 'Altro',
};

interface ReportTransaction {
  id: string;
  transaction_date: string;
  description: string;
  merchant: string | null;
  amount: number;
  type: string;
  status: string;
  category_id: string | null;
  subcategory_id: string | null;
  account_id: string | null;
  inserted_by: string | null;
  accounts?: { name?: string | null } | null;
  categories?: { name?: string | null } | null;
  subcategories?: { name?: string | null } | null;
  inserted_by_profile?: { display_name?: string | null } | null;
}

interface ReportDocument {
  id: string;
  type: string;
  original_filename: string;
  vendor_name: string | null;
  document_date: string | null;
  total_amount: number | null;
}

interface ReportBudgetTarget {
  id: string;
  category_id: string | null;
  subcategory_id: string | null;
  planned_amount: number;
}

interface ReportItem {
  id: string;
  description: string;
  amount: number;
  transactions?: {
    transaction_date?: string | null;
    merchant?: string | null;
    description?: string | null;
  } | null;
}

interface SummaryRow {
  name: string;
  amount: number;
  count: number;
}

interface CategoryReportRow {
  id: string;
  name: string;
  planned: number;
  actual: number;
  count: number;
}

const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getMonthRange = (year: number, month: number) => ({
  start: toIsoDate(new Date(year, month - 1, 1)),
  end: toIsoDate(new Date(year, month, 0)),
});

const sumAmounts = <T,>(items: T[], getValue: (item: T) => number) => (
  items.reduce((acc, item) => acc + getValue(item), 0)
);

const addToSummary = (map: Map<string, SummaryRow>, name: string, amount: number) => {
  const key = name || 'Non classificato';
  const current = map.get(key) || { name: key, amount: 0, count: 0 };
  current.amount += amount;
  current.count += 1;
  map.set(key, current);
};

const sortedRows = (map: Map<string, SummaryRow>) => (
  Array.from(map.values()).sort((a, b) => b.amount - a.amount)
);

const normalizeKey = (value: string) => (
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
);

const compactText = (value: string, width: number) => {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= width) return clean.padEnd(width, ' ');
  return `${clean.slice(0, Math.max(0, width - 1))}~`;
};

const tableLine = (columns: string[], widths: number[], alignRight: number[] = []) => (
  columns.map((column, index) => {
    const clean = compactText(column, widths[index]);
    return alignRight.includes(index) ? clean.trim().padStart(widths[index], ' ') : clean;
  }).join('  ')
);

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
};

export const ReportsPage: React.FC = () => {
  const { household, categories, subcategories } = useHousehold();
  const today = new Date();
  const householdId = household?.id || null;
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [transactions, setTransactions] = useState<ReportTransaction[]>([]);
  const [documents, setDocuments] = useState<ReportDocument[]>([]);
  const [budgetTargets, setBudgetTargets] = useState<ReportBudgetTarget[]>([]);
  const [items, setItems] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currency = household?.currency || 'EUR';
  const monthLabel = monthLabels[month - 1];
  const range = useMemo(() => getMonthRange(year, month), [month, year]);

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach(category => map.set(category.id, category.name));
    return map;
  }, [categories]);

  const subcategoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    subcategories.forEach(subcategory => map.set(subcategory.id, subcategory.name));
    return map;
  }, [subcategories]);

  const loadReportData = useCallback(async () => {
    if (!householdId) return;

    setLoading(true);
    setError(null);

    try {
      const { data: txRows, error: txError } = await supabase
        .from('transactions')
        .select(`
          *,
          accounts!transactions_account_id_fkey(name),
          categories(name),
          subcategories(name),
          inserted_by_profile:profiles!transactions_inserted_by_fkey(display_name)
        `)
        .eq('household_id', householdId)
        .gte('transaction_date', range.start)
        .lte('transaction_date', range.end)
        .neq('status', 'deleted')
        .order('transaction_date', { ascending: true });

      if (txError) throw txError;

      const { data: docRows, error: docError } = await supabase
        .from('documents')
        .select('id, type, original_filename, vendor_name, document_date, total_amount')
        .eq('household_id', householdId)
        .gte('document_date', range.start)
        .lte('document_date', range.end)
        .order('document_date', { ascending: true });

      if (docError) throw docError;

      const { data: budgetRows, error: budgetError } = await supabase
        .from('budget_targets')
        .select('id, category_id, subcategory_id, planned_amount')
        .eq('household_id', householdId)
        .eq('year', year)
        .eq('month', month);

      if (budgetError) throw budgetError;

      const { data: itemRows, error: itemError } = await supabase
        .from('transaction_items')
        .select('id, description, amount, transactions!inner(transaction_date, merchant, description)')
        .eq('household_id', householdId);

      if (itemError) throw itemError;

      const monthItems = ((itemRows || []) as ReportItem[]).filter(item => {
        const date = item.transactions?.transaction_date || '';
        return date >= range.start && date <= range.end;
      });

      setTransactions((txRows || []) as ReportTransaction[]);
      setDocuments((docRows || []) as ReportDocument[]);
      setBudgetTargets((budgetRows || []) as ReportBudgetTarget[]);
      setItems(monthItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore durante il caricamento del report');
    } finally {
      setLoading(false);
    }
  }, [householdId, month, range.end, range.start, year]);

  useEffect(() => {
    loadReportData();
  }, [loadReportData]);

  const report = useMemo(() => {
    const validTransactions = transactions.filter(tx => tx.status !== 'rejected');
    const expenses = validTransactions.filter(tx => tx.type === 'expense');
    const incomes = validTransactions.filter(tx => tx.type === 'income');
    const transfers = validTransactions.filter(tx => tx.type === 'transfer');
    const totalExpense = sumAmounts(expenses, tx => tx.amount);
    const totalIncome = sumAmounts(incomes, tx => tx.amount);
    const net = totalIncome - totalExpense;

    const globalBudget = budgetTargets.find(target => !target.category_id && !target.subcategory_id)?.planned_amount || 0;
    const categoryBudgetTotal = sumAmounts(
      budgetTargets.filter(target => target.category_id),
      target => target.planned_amount
    );
    const plannedBudget = globalBudget || categoryBudgetTotal;

    const actualByCategory = new Map<string, CategoryReportRow>();
    expenses.forEach(tx => {
      const id = tx.category_id || 'uncategorized';
      const name = tx.categories?.name || categoryNameById.get(id) || 'Non classificato';
      const current = actualByCategory.get(id) || { id, name, planned: 0, actual: 0, count: 0 };
      current.actual += tx.amount;
      current.count += 1;
      actualByCategory.set(id, current);
    });

    budgetTargets.filter(target => target.category_id).forEach(target => {
      const id = target.category_id || 'uncategorized';
      const name = categoryNameById.get(id) || 'Non classificato';
      const current = actualByCategory.get(id) || { id, name, planned: 0, actual: 0, count: 0 };
      current.planned += target.planned_amount;
      actualByCategory.set(id, current);
    });

    const categoryRows = Array.from(actualByCategory.values())
      .filter(row => row.actual > 0 || row.planned > 0)
      .sort((a, b) => b.actual - a.actual);

    const merchantMap = new Map<string, SummaryRow>();
    const accountMap = new Map<string, SummaryRow>();
    const insertedByMap = new Map<string, SummaryRow>();
    const documentMap = new Map<string, SummaryRow>();
    const itemMap = new Map<string, SummaryRow>();

    expenses.forEach(tx => {
      addToSummary(merchantMap, tx.merchant || tx.description || 'Senza esercente', tx.amount);
      addToSummary(accountMap, tx.accounts?.name || 'Senza conto', tx.amount);
      addToSummary(insertedByMap, tx.inserted_by_profile?.display_name || 'Sconosciuto', tx.amount);
    });

    documents.forEach(document => {
      addToSummary(documentMap, documentTypeLabels[document.type] || document.type, document.total_amount || 0);
    });

    items.forEach(item => {
      const key = normalizeKey(item.description);
      const displayName = key || 'Articolo senza nome';
      addToSummary(itemMap, displayName, item.amount);
    });

    return {
      validTransactions,
      expenses,
      incomes,
      transfers,
      totalExpense,
      totalIncome,
      net,
      plannedBudget,
      budgetRemaining: plannedBudget - totalExpense,
      categoryRows,
      merchantRows: sortedRows(merchantMap),
      accountRows: sortedRows(accountMap),
      insertedByRows: sortedRows(insertedByMap),
      documentRows: sortedRows(documentMap),
      itemRows: sortedRows(itemMap),
      documentTotal: sumAmounts(documents, document => document.total_amount || 0),
    };
  }, [budgetTargets, categoryNameById, documents, items, transactions]);

  const buildPdfLines = () => {
    const money = (value: number) => formatCurrency(value, currency).replace(/\s?\u20ac/g, ' EUR');
    const generatedAt = new Date().toLocaleString('it-IT');
    const lines: PdfLine[] = [
      { text: 'Contotron - Report mensile', size: 18, bold: true, gapAfter: 4 },
      { text: `${monthLabel} ${year} - ${household?.name || 'Famiglia'}`, size: 12, bold: true },
      { text: `Periodo: ${range.start} / ${range.end}` },
      { text: `Generato il: ${generatedAt}`, gapAfter: 10 },
      { text: 'Riepilogo generale', size: 14, bold: true },
      { text: `Spese totali: ${money(report.totalExpense)}` },
      { text: `Entrate totali: ${money(report.totalIncome)}` },
      { text: `Saldo mese: ${money(report.net)}` },
      { text: `Budget previsto: ${money(report.plannedBudget)}` },
      { text: `Differenza budget/spese: ${money(report.budgetRemaining)}` },
      { text: `Transazioni: ${report.validTransactions.length} (${report.expenses.length} spese, ${report.incomes.length} entrate, ${report.transfers.length} trasferimenti)` },
      { text: `Documenti archiviati nel mese: ${documents.length}`, gapAfter: 10 },
      { text: 'Spese per categoria', size: 14, bold: true },
      { text: tableLine(['Categoria', 'Previsto', 'Speso', 'Diff.', 'N.'], [24, 12, 12, 12, 4], [1, 2, 3, 4]), mono: true, bold: true },
    ];

    if (report.categoryRows.length === 0) {
      lines.push({ text: 'Nessuna spesa categorizzata nel periodo.' });
    } else {
      report.categoryRows.forEach(row => {
        lines.push({
          text: tableLine([
            row.name,
            money(row.planned),
            money(row.actual),
            money(row.planned - row.actual),
            String(row.count),
          ], [24, 12, 12, 12, 4], [1, 2, 3, 4]),
          mono: true,
        });
      });
    }

    lines.push({ text: '', gapAfter: 4 });
    lines.push({ text: 'Da dove viene la spesa maggiore', size: 14, bold: true });
    lines.push({ text: tableLine(['Esercente', 'Spesa', 'N.'], [34, 14, 4], [1, 2]), mono: true, bold: true });
    report.merchantRows.slice(0, 12).forEach(row => {
      lines.push({ text: tableLine([row.name, money(row.amount), String(row.count)], [34, 14, 4], [1, 2]), mono: true });
    });

    lines.push({ text: '', gapAfter: 4 });
    lines.push({ text: 'Spese per conto e per persona', size: 14, bold: true });
    lines.push({ text: tableLine(['Conto', 'Spesa', 'N.'], [30, 14, 4], [1, 2]), mono: true, bold: true });
    report.accountRows.forEach(row => {
      lines.push({ text: tableLine([row.name, money(row.amount), String(row.count)], [30, 14, 4], [1, 2]), mono: true });
    });
    lines.push({ text: tableLine(['Inserita da', 'Spesa', 'N.'], [30, 14, 4], [1, 2]), mono: true, bold: true });
    report.insertedByRows.forEach(row => {
      lines.push({ text: tableLine([row.name, money(row.amount), String(row.count)], [30, 14, 4], [1, 2]), mono: true });
    });

    lines.push({ text: '', gapAfter: 4 });
    lines.push({ text: 'Documenti del mese', size: 14, bold: true });
    if (report.documentRows.length === 0) {
      lines.push({ text: 'Nessun documento archiviato nel periodo.' });
    } else {
      report.documentRows.forEach(row => {
        lines.push({ text: `${row.name}: ${row.count} documenti - totale indicato ${money(row.amount)}` });
      });
    }

    lines.push({ text: '', gapAfter: 4 });
    lines.push({ text: 'Articoli piu presenti nelle righe scontrino', size: 14, bold: true });
    if (report.itemRows.length === 0) {
      lines.push({ text: 'Nessuna riga articolo salvata nel periodo.' });
    } else {
      report.itemRows.slice(0, 12).forEach(row => {
        lines.push({ text: tableLine([row.name, money(row.amount), String(row.count)], [34, 14, 4], [1, 2]), mono: true });
      });
    }

    lines.push({ text: '', gapAfter: 4 });
    lines.push({ text: 'Dettaglio transazioni', size: 14, bold: true });
    lines.push({ text: tableLine(['Data', 'Descrizione', 'Cat.', 'Importo'], [10, 28, 18, 12], [3]), mono: true, bold: true });
    report.validTransactions.forEach(tx => {
      const categoryName = tx.categories?.name || (tx.category_id ? categoryNameById.get(tx.category_id) : null) || 'Non class.';
      const subcategoryName = tx.subcategory_id ? subcategoryNameById.get(tx.subcategory_id) : null;
      const signedAmount = tx.type === 'expense' ? -tx.amount : tx.amount;
      lines.push({
        text: tableLine([
          tx.transaction_date,
          tx.merchant || tx.description,
          subcategoryName ? `${categoryName}/${subcategoryName}` : categoryName,
          money(signedAmount),
        ], [10, 28, 18, 12], [3]),
        mono: true,
      });
    });

    return lines;
  };

  const handleDownloadPdf = () => {
    const filename = `contotron-report-${year}-${String(month).padStart(2, '0')}.pdf`;
    downloadBlob(createTextPdf(buildPdfLines()), filename);
  };

  const buildExcelSheets = (): ExcelSheet[] => {
    const signedAmount = (tx: ReportTransaction) => (tx.type === 'expense' ? -tx.amount : tx.amount);
    const categoryLabel = (tx: ReportTransaction) => (
      tx.categories?.name || (tx.category_id ? categoryNameById.get(tx.category_id) : null) || 'Non classificato'
    );
    const subcategoryLabel = (tx: ReportTransaction) => (
      tx.subcategories?.name || (tx.subcategory_id ? subcategoryNameById.get(tx.subcategory_id) : null) || ''
    );

    return [
      {
        name: 'Riepilogo',
        rows: [
          ['Campo', 'Valore'],
          ['Famiglia', household?.name || 'Famiglia'],
          ['Mese', `${monthLabel} ${year}`],
          ['Periodo inizio', range.start],
          ['Periodo fine', range.end],
          ['Spese totali', report.totalExpense],
          ['Entrate totali', report.totalIncome],
          ['Saldo mese', report.net],
          ['Budget previsto', report.plannedBudget],
          ['Budget residuo', report.budgetRemaining],
          ['Numero transazioni', report.validTransactions.length],
          ['Numero spese', report.expenses.length],
          ['Numero entrate', report.incomes.length],
          ['Numero trasferimenti', report.transfers.length],
          ['Documenti archiviati', documents.length],
        ],
      },
      {
        name: 'Categorie',
        rows: [
          ['Categoria', 'Budget previsto', 'Speso', 'Differenza', 'Movimenti'],
          ...report.categoryRows.map(row => [
            row.name,
            row.planned,
            row.actual,
            row.planned - row.actual,
            row.count,
          ]),
        ],
      },
      {
        name: 'Esercenti',
        rows: [
          ['Esercente o fornitore', 'Spesa', 'Movimenti'],
          ...report.merchantRows.map(row => [row.name, row.amount, row.count]),
        ],
      },
      {
        name: 'Persone',
        rows: [
          ['Inserita da', 'Spesa', 'Movimenti'],
          ...report.insertedByRows.map(row => [row.name, row.amount, row.count]),
        ],
      },
      {
        name: 'Conti',
        rows: [
          ['Conto', 'Spesa', 'Movimenti'],
          ...report.accountRows.map(row => [row.name, row.amount, row.count]),
        ],
      },
      {
        name: 'Documenti',
        rows: [
          ['Data', 'Tipo', 'Fornitore', 'Nome file', 'Totale indicato'],
          ...documents.map(document => [
            document.document_date || '',
            documentTypeLabels[document.type] || document.type,
            document.vendor_name || '',
            document.original_filename,
            document.total_amount || 0,
          ]),
        ],
      },
      {
        name: 'Transazioni',
        rows: [
          ['Data', 'Tipo', 'Descrizione', 'Esercente', 'Categoria', 'Sottocategoria', 'Conto', 'Inserita da', 'Importo', 'Stato'],
          ...report.validTransactions.map(tx => [
            tx.transaction_date,
            tx.type,
            tx.description,
            tx.merchant || '',
            categoryLabel(tx),
            subcategoryLabel(tx),
            tx.accounts?.name || '',
            tx.inserted_by_profile?.display_name || 'Sconosciuto',
            signedAmount(tx),
            tx.status,
          ]),
        ],
      },
      {
        name: 'Articoli',
        rows: [
          ['Articolo', 'Spesa', 'Movimenti'],
          ...report.itemRows.map(row => [row.name, row.amount, row.count]),
        ],
      },
      {
        name: 'Righe scontrino',
        rows: [
          ['Data', 'Esercente', 'Descrizione transazione', 'Articolo', 'Importo'],
          ...items.map(item => [
            item.transactions?.transaction_date || '',
            item.transactions?.merchant || '',
            item.transactions?.description || '',
            item.description,
            item.amount,
          ]),
        ],
      },
    ];
  };

  const handleDownloadExcel = () => {
    const filename = `contotron-report-${year}-${String(month).padStart(2, '0')}.xls`;
    downloadBlob(createExcelWorkbook(buildExcelSheets()), filename);
  };

  const yearOptions = Array.from({ length: 8 }, (_, index) => today.getFullYear() - index);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Report Mensile</h1>
          <p className="text-muted">Genera un PDF o un file Excel di fine mese con spese, budget, categorie, documenti e dati principali.</p>
        </div>
        <div className={styles.headerActions}>
          <Button icon={<Download size={16} />} onClick={handleDownloadPdf} disabled={loading}>
            Genera PDF
          </Button>
          <Button variant="secondary" icon={<FileSpreadsheet size={16} />} onClick={handleDownloadExcel} disabled={loading}>
            Genera Excel
          </Button>
        </div>
      </header>

      <Card
        title="Periodo report"
        icon={<Calendar size={20} />}
        action={<Button size="sm" variant="secondary" icon={<RefreshCw size={16} />} onClick={loadReportData} disabled={loading}>Aggiorna</Button>}
      >
        <div className={styles.controls}>
          <label>
            Mese
            <select className={styles.select} value={month} onChange={event => setMonth(Number(event.target.value))}>
              {monthLabels.map((label, index) => (
                <option key={label} value={index + 1}>{label}</option>
              ))}
            </select>
          </label>

          <label>
            Anno
            <select className={styles.select} value={year} onChange={event => setYear(Number(event.target.value))}>
              {yearOptions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>

          <div className={styles.periodInfo}>
            <span>Periodo</span>
            <strong>{range.start} / {range.end}</strong>
          </div>
        </div>
      </Card>

      {error && <div className={styles.errorBox}>{error}</div>}

      {loading ? (
        <Card>
          <div className={styles.loading}>Caricamento report...</div>
        </Card>
      ) : (
        <>
          <div className={styles.stats}>
            <div className={styles.statBox}>
              <span>Spese mese</span>
              <strong className={styles.expense}>{formatCurrency(report.totalExpense, currency)}</strong>
            </div>
            <div className={styles.statBox}>
              <span>Entrate mese</span>
              <strong className={styles.income}>{formatCurrency(report.totalIncome, currency)}</strong>
            </div>
            <div className={styles.statBox}>
              <span>Budget residuo</span>
              <strong className={report.budgetRemaining < 0 ? styles.expense : styles.income}>
                {formatCurrency(report.budgetRemaining, currency)}
              </strong>
            </div>
            <div className={styles.statBox}>
              <span>Documenti</span>
              <strong>{documents.length}</strong>
            </div>
          </div>

          <div className={styles.grid}>
            <Card title="Budget e categorie" icon={<BarChart3 size={20} />}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Previsto</th>
                      <th>Speso</th>
                      <th>Differenza</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.categoryRows.length === 0 ? (
                      <tr><td colSpan={4}>Nessuna spesa o budget per questo mese.</td></tr>
                    ) : report.categoryRows.map(row => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>{formatCurrency(row.planned, currency)}</td>
                        <td>{formatCurrency(row.actual, currency)}</td>
                        <td className={row.planned - row.actual < 0 ? styles.expenseText : styles.incomeText}>
                          {formatCurrency(row.planned - row.actual, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Spesa maggiore per esercente">
              <div className={styles.list}>
                {report.merchantRows.length === 0 ? (
                  <div className={styles.empty}>Nessuna spesa nel periodo.</div>
                ) : report.merchantRows.slice(0, 8).map(row => (
                  <div key={row.name} className={styles.listItem}>
                    <div>
                      <strong>{row.name}</strong>
                      <span>{row.count} movimenti</span>
                    </div>
                    <b>{formatCurrency(row.amount, currency)}</b>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Persone e conti">
              <div className={styles.dualList}>
                <div>
                  <h4>Inserita da</h4>
                  {report.insertedByRows.length === 0 ? <p className={styles.empty}>Nessun dato</p> : report.insertedByRows.map(row => (
                    <div key={row.name} className={styles.compactRow}>
                      <span>{row.name}</span>
                      <strong>{formatCurrency(row.amount, currency)}</strong>
                    </div>
                  ))}
                </div>
                <div>
                  <h4>Conto</h4>
                  {report.accountRows.length === 0 ? <p className={styles.empty}>Nessun dato</p> : report.accountRows.map(row => (
                    <div key={row.name} className={styles.compactRow}>
                      <span>{row.name}</span>
                      <strong>{formatCurrency(row.amount, currency)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card title="Documenti archiviati">
              <div className={styles.list}>
                {report.documentRows.length === 0 ? (
                  <div className={styles.empty}>Nessun documento archiviato nel mese.</div>
                ) : report.documentRows.map(row => (
                  <div key={row.name} className={styles.listItem}>
                    <div>
                      <strong>{row.name}</strong>
                      <span>{row.count} documenti</span>
                    </div>
                    <b>{formatCurrency(row.amount, currency)}</b>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Dettaglio transazioni">
              <div className={styles.transactionList}>
                {report.validTransactions.length === 0 ? (
                  <div className={styles.empty}>Nessuna transazione per questo mese.</div>
                ) : report.validTransactions.map(tx => (
                  <div key={tx.id} className={styles.transactionItem}>
                    <div>
                      <strong>{tx.description}</strong>
                      <span>
                        {tx.transaction_date} - {tx.merchant || 'Senza esercente'} - {tx.categories?.name || 'Non classificato'} - inserita da {tx.inserted_by_profile?.display_name || 'Sconosciuto'}
                      </span>
                    </div>
                    <b className={tx.type === 'expense' ? styles.expenseText : styles.incomeText}>
                      {tx.type === 'expense' ? '-' : '+'}{formatCurrency(tx.amount, currency)}
                    </b>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
