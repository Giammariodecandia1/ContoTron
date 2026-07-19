import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Calendar, ChevronDown, ChevronRight, Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency } from '../lib/money';
import { createTextPdf, type PdfLine } from '../lib/textPdf';
import { createExcelWorkbook, type ExcelSheet } from '../lib/excelXml';
import { getFoodCharacteristicLabel } from '../lib/foodCharacteristics';
import { spendingTypeOptions } from '../lib/spendingTypes';
import { getTransactionFrequencyLabel } from '../lib/transactionFrequencies';
import { useHousehold } from '../hooks';
import styles from './ReportsPage.module.css';

const monthLabels = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
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
  frequency?: string | null;
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
  month: number;
  category_id: string | null;
  subcategory_id: string | null;
  planned_amount: number;
}

interface ReportIncomeTarget {
  month: number;
  planned_income: number;
}

interface ReportItem {
  id: string;
  transaction_id: string;
  description: string;
  amount: number;
  category_id: string | null;
  subcategory_id: string | null;
  transactions?: { transaction_date?: string | null } | null;
}

interface SummaryRow {
  name: string;
  amount: number;
  count: number;
}

interface SubcategoryReportRow {
  id: string;
  name: string;
  planned: number;
  actual: number;
  count: number;
}

interface CategoryReportRow extends SubcategoryReportRow {
  subcategories: SubcategoryReportRow[];
}

interface WeeklyFoodRow {
  week: number;
  label: string;
  amount: number;
}

interface SpendingTypeReportRow {
  id: string;
  name: string;
  planned: number;
  actual: number;
  plannedCount: number;
  actualCount: number;
  plannedPercent: number;
  actualPercent: number;
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

const getYearRange = (year: number) => ({
  start: `${year}-01-01`,
  end: `${year}-12-31`,
});

const normalizeKey = (value: string) => (
  value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
);

const getIsoWeek = (date: Date) => {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.min(52, Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7));
};

const sumAmounts = <T,>(items: T[], getValue: (item: T) => number) => (
  items.reduce((sum, item) => sum + getValue(item), 0)
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

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const compactText = (value: string, width: number) => {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= width) return clean.padEnd(width, ' ');
  return `${clean.slice(0, Math.max(0, width - 1))}~`;
};

const formatPercent = (value: number) => `${value.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

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
  const [incomeTargets, setIncomeTargets] = useState<ReportIncomeTarget[]>([]);
  const [items, setItems] = useState<ReportItem[]>([]);
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currency = household?.currency || 'EUR';
  const monthLabel = monthLabels[month - 1];
  const monthRange = useMemo(() => getMonthRange(year, month), [month, year]);
  const yearRange = useMemo(() => getYearRange(year), [year]);

  const categoryNameById = useMemo(() => new Map(categories.map(category => [category.id, category.name])), [categories]);
  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);
  const subcategoryById = useMemo(() => new Map(subcategories.map(subcategory => [subcategory.id, subcategory])), [subcategories]);
  const foodCategoryIds = useMemo(() => new Set(
    categories.filter(category => normalizeKey(category.name) === 'alimentari').map(category => category.id),
  ), [categories]);

  const loadReportData = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    setError(null);

    try {
      const [txResult, docResult, budgetResult, incomeResult, itemResult] = await Promise.all([
        supabase
          .from('transactions')
          .select(`*, accounts!transactions_account_id_fkey(name), categories(name), subcategories(name), inserted_by_profile:profiles!transactions_inserted_by_fkey(display_name)`)
          .eq('household_id', householdId)
          .gte('transaction_date', yearRange.start)
          .lte('transaction_date', yearRange.end)
          .neq('status', 'deleted')
          .order('transaction_date', { ascending: true }),
        supabase
          .from('documents')
          .select('id, type, original_filename, vendor_name, document_date, total_amount')
          .eq('household_id', householdId)
          .gte('document_date', yearRange.start)
          .lte('document_date', yearRange.end)
          .order('document_date', { ascending: true }),
        supabase
          .from('budget_targets')
          .select('id, month, category_id, subcategory_id, planned_amount')
          .eq('household_id', householdId)
          .eq('year', year),
        supabase
          .from('monthly_income_targets')
          .select('month, planned_income')
          .eq('household_id', householdId)
          .eq('year', year),
        supabase
          .from('transaction_items')
          .select('id, transaction_id, description, amount, category_id, subcategory_id, transactions!inner(transaction_date)')
          .eq('household_id', householdId),
      ]);

      if (txResult.error) throw txResult.error;
      if (docResult.error) throw docResult.error;
      if (budgetResult.error) throw budgetResult.error;
      if (incomeResult.error) throw incomeResult.error;
      if (itemResult.error) throw itemResult.error;

      setTransactions((txResult.data || []) as ReportTransaction[]);
      setDocuments((docResult.data || []) as ReportDocument[]);
      setBudgetTargets((budgetResult.data || []) as ReportBudgetTarget[]);
      setIncomeTargets((incomeResult.data || []) as ReportIncomeTarget[]);
      setItems(((itemResult.data || []) as unknown as ReportItem[]).filter(item => {
        const date = item.transactions?.transaction_date || '';
        return date >= yearRange.start && date <= yearRange.end;
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore durante il caricamento del report');
    } finally {
      setLoading(false);
    }
  }, [householdId, year, yearRange.end, yearRange.start]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReportData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReportData]);

  const report = useMemo(() => {
    const annualValidTransactions = transactions.filter(tx => tx.status !== 'rejected');
    const monthlyTransactions = annualValidTransactions.filter(tx => tx.transaction_date >= monthRange.start && tx.transaction_date <= monthRange.end);
    const expenses = monthlyTransactions.filter(tx => tx.type === 'expense');
    const incomes = monthlyTransactions.filter(tx => tx.type === 'income');
    const monthlyBudgetTargets = budgetTargets.filter(target => target.month === month);
    const monthlyDocuments = documents.filter(document => (
      !!document.document_date && document.document_date >= monthRange.start && document.document_date <= monthRange.end
    ));
    const monthlyItems = items.filter(item => {
      const date = item.transactions?.transaction_date || '';
      return date >= monthRange.start && date <= monthRange.end;
    });
    const monthlyExpenseById = new Map(expenses.map(tx => [tx.id, tx]));
    const monthlyItemsByTransaction = new Map<string, ReportItem[]>();
    monthlyItems.forEach(item => {
      if (!monthlyExpenseById.has(item.transaction_id)) return;
      const group = monthlyItemsByTransaction.get(item.transaction_id) || [];
      group.push(item);
      monthlyItemsByTransaction.set(item.transaction_id, group);
    });
    const itemizedTransactionIds = new Set(
      Array.from(monthlyItemsByTransaction.entries())
        .filter(([, group]) => sumAmounts(group, item => Number(item.amount || 0)) > 0)
        .map(([transactionId]) => transactionId),
    );
    const allocatedItemAmount = (item: ReportItem, group: ReportItem[], transactionAmount: number) => {
      const itemTotal = sumAmounts(group, row => Number(row.amount || 0));
      return itemTotal > 0 ? Number(item.amount || 0) * transactionAmount / itemTotal : 0;
    };

    const totalExpense = sumAmounts(expenses, tx => Number(tx.amount || 0));
    const actualIncome = sumAmounts(incomes, tx => Number(tx.amount || 0));
    const plannedIncome = Number(incomeTargets.find(target => target.month === month)?.planned_income || 0);
    const availableDelta = plannedIncome - totalExpense;

    const globalBudget = monthlyBudgetTargets.find(target => !target.category_id && !target.subcategory_id)?.planned_amount || 0;
    const categoryBudgetTotal = sumAmounts(monthlyBudgetTargets.filter(target => target.category_id), target => Number(target.planned_amount || 0));
    const plannedBudget = Number(globalBudget || categoryBudgetTotal);

    const categoryMap = new Map<string, CategoryReportRow>();
    const ensureCategory = (id: string, name: string) => {
      const current = categoryMap.get(id) || { id, name, planned: 0, actual: 0, count: 0, subcategories: [] };
      categoryMap.set(id, current);
      return current;
    };

    expenses.filter(tx => !itemizedTransactionIds.has(tx.id)).forEach(tx => {
      const id = tx.category_id || 'uncategorized';
      const category = ensureCategory(id, tx.categories?.name || categoryNameById.get(id) || 'Non classificato');
      category.actual += Number(tx.amount || 0);
      category.count += 1;
    });
    monthlyItemsByTransaction.forEach((group, transactionId) => {
      if (!itemizedTransactionIds.has(transactionId)) return;
      const transaction = monthlyExpenseById.get(transactionId);
      if (!transaction) return;
      group.forEach(item => {
        const id = item.category_id || 'uncategorized';
        const category = ensureCategory(id, categoryNameById.get(id) || 'Non classificato');
        category.actual += allocatedItemAmount(item, group, Number(transaction.amount || 0));
        category.count += 1;
      });
    });

    monthlyBudgetTargets.filter(target => target.category_id).forEach(target => {
      const id = target.category_id || 'uncategorized';
      ensureCategory(id, categoryNameById.get(id) || 'Non classificato').planned += Number(target.planned_amount || 0);
    });

    categoryMap.forEach(category => {
      const subcategoryMap = new Map<string, SubcategoryReportRow>();
      const ensureSubcategory = (id: string, name: string) => {
        const current = subcategoryMap.get(id) || { id, name, planned: 0, actual: 0, count: 0 };
        subcategoryMap.set(id, current);
        return current;
      };

      expenses
        .filter(tx => !itemizedTransactionIds.has(tx.id) && (tx.category_id || 'uncategorized') === category.id)
        .forEach(tx => {
        const id = tx.subcategory_id || 'without-subcategory';
        const name = tx.subcategories?.name || subcategoryById.get(id)?.name || 'Senza sottocategoria';
        const subcategory = ensureSubcategory(id, name);
        subcategory.actual += Number(tx.amount || 0);
        subcategory.count += 1;
      });
      monthlyItemsByTransaction.forEach((group, transactionId) => {
        if (!itemizedTransactionIds.has(transactionId)) return;
        const transaction = monthlyExpenseById.get(transactionId);
        if (!transaction) return;
        group.filter(item => (item.category_id || 'uncategorized') === category.id).forEach(item => {
          const id = item.subcategory_id || 'without-subcategory';
          const subcategory = ensureSubcategory(id, subcategoryById.get(id)?.name || 'Senza sottocategoria');
          subcategory.actual += allocatedItemAmount(item, group, Number(transaction.amount || 0));
          subcategory.count += 1;
        });
      });

      monthlyBudgetTargets
        .filter(target => target.category_id === category.id && target.subcategory_id)
        .forEach(target => {
          const id = target.subcategory_id || 'without-subcategory';
          ensureSubcategory(id, subcategoryById.get(id)?.name || 'Senza sottocategoria').planned += Number(target.planned_amount || 0);
        });

      category.subcategories = Array.from(subcategoryMap.values())
        .filter(row => row.actual > 0 || row.planned > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    });

    const categoryRows = Array.from(categoryMap.values())
      .filter(row => row.actual > 0 || row.planned > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    const annualExpenseById = new Map(
      annualValidTransactions.filter(tx => tx.type === 'expense').map(tx => [tx.id, tx]),
    );
    const annualItemsByTransaction = new Map<string, ReportItem[]>();
    items.forEach(item => {
      if (!annualExpenseById.has(item.transaction_id)) return;
      const group = annualItemsByTransaction.get(item.transaction_id) || [];
      group.push(item);
      annualItemsByTransaction.set(item.transaction_id, group);
    });
    const annualItemizedIds = new Set(
      Array.from(annualItemsByTransaction.entries())
        .filter(([, group]) => sumAmounts(group, item => Number(item.amount || 0)) > 0)
        .map(([transactionId]) => transactionId),
    );
    const annualFoodExpenses = annualValidTransactions.filter(tx => (
      tx.type === 'expense'
      && !annualItemizedIds.has(tx.id)
      && foodCategoryIds.has(tx.category_id || '')
    ));
    const weeklyAmounts = Array.from({ length: 52 }, () => 0);
    annualFoodExpenses.forEach(tx => {
      const date = new Date(`${tx.transaction_date}T00:00:00`);
      const week = getIsoWeek(date);
      weeklyAmounts[week - 1] += Number(tx.amount || 0);
    });
    annualItemsByTransaction.forEach((group, transactionId) => {
      if (!annualItemizedIds.has(transactionId)) return;
      const transaction = annualExpenseById.get(transactionId);
      if (!transaction) return;
      const date = new Date(`${transaction.transaction_date}T00:00:00`);
      const week = getIsoWeek(date);
      group.filter(item => foodCategoryIds.has(item.category_id || '')).forEach(item => {
        weeklyAmounts[week - 1] += allocatedItemAmount(item, group, Number(transaction.amount || 0));
      });
    });
    const foodWeeklyRows: WeeklyFoodRow[] = weeklyAmounts.map((amount, index) => ({
      week: index + 1,
      label: `Settimana ${index + 1}`,
      amount,
    }));
    const foodTotal = sumAmounts(foodWeeklyRows, row => row.amount);
    const foodAverage = foodTotal / 52;
    const foodMedian = median(weeklyAmounts);

    const accountMap = new Map<string, SummaryRow>();
    const insertedByMap = new Map<string, SummaryRow>();
    const documentMap = new Map<string, SummaryRow>();
    const frequencyMap = new Map<string, SummaryRow>();
    const foodCharacteristicMap = new Map<string, SummaryRow>();
    const spendingTypeMap = new Map<string, SpendingTypeReportRow>(
      spendingTypeOptions.map(option => [option.value, {
        id: option.value,
        name: option.label,
        planned: 0,
        actual: 0,
        plannedCount: 0,
        actualCount: 0,
        plannedPercent: 0,
        actualPercent: 0,
      }]),
    );

    const resolveSpendingType = (categoryId?: string | null, subcategoryId?: string | null) => (
      subcategoryById.get(subcategoryId || '')?.spending_type
      || categoryById.get(categoryId || '')?.spending_type
      || 'variable'
    );
    const addSpendingTypeValue = (
      spendingType: string,
      field: 'planned' | 'actual',
      amount: number,
    ) => {
      const row = spendingTypeMap.get(spendingType) || spendingTypeMap.get('variable');
      if (!row) return;
      row[field] += amount;
      if (field === 'planned') row.plannedCount += 1;
      else row.actualCount += 1;
    };

    const targetsByCategory = new Map<string, ReportBudgetTarget[]>();
    monthlyBudgetTargets.filter(target => target.category_id).forEach(target => {
      const group = targetsByCategory.get(target.category_id || '') || [];
      group.push(target);
      targetsByCategory.set(target.category_id || '', group);
    });
    targetsByCategory.forEach((group, categoryId) => {
      const subcategoryTargets = group.filter(target => target.subcategory_id);
      const selectedTargets = subcategoryTargets.length > 0
        ? subcategoryTargets
        : group.filter(target => !target.subcategory_id);
      selectedTargets.forEach(target => {
        addSpendingTypeValue(
          resolveSpendingType(categoryId, target.subcategory_id),
          'planned',
          Number(target.planned_amount || 0),
        );
      });
    });

    expenses.filter(tx => !itemizedTransactionIds.has(tx.id)).forEach(tx => {
      addSpendingTypeValue(
        resolveSpendingType(tx.category_id, tx.subcategory_id),
        'actual',
        Number(tx.amount || 0),
      );
    });
    monthlyItemsByTransaction.forEach((group, transactionId) => {
      if (!itemizedTransactionIds.has(transactionId)) return;
      const transaction = monthlyExpenseById.get(transactionId);
      if (!transaction) return;
      group.forEach(item => {
        addSpendingTypeValue(
          resolveSpendingType(item.category_id, item.subcategory_id),
          'actual',
          allocatedItemAmount(item, group, Number(transaction.amount || 0)),
        );
      });
    });

    expenses.forEach(tx => {
      addToSummary(accountMap, tx.accounts?.name || 'Senza conto', Number(tx.amount || 0));
      addToSummary(insertedByMap, tx.inserted_by_profile?.display_name || 'Sconosciuto', Number(tx.amount || 0));
      addToSummary(frequencyMap, getTransactionFrequencyLabel(tx.frequency), Number(tx.amount || 0));
    });
    monthlyDocuments.forEach(document => {
      addToSummary(documentMap, documentTypeLabels[document.type] || document.type, Number(document.total_amount || 0));
    });

    monthlyItemsByTransaction.forEach((group, transactionId) => {
      if (!itemizedTransactionIds.has(transactionId)) return;
      const transaction = monthlyExpenseById.get(transactionId);
      if (!transaction) return;
      group.filter(item => foodCategoryIds.has(item.category_id || '')).forEach(item => {
        const characteristic = subcategoryById.get(item.subcategory_id || '')?.food_characteristic;
        addToSummary(
          foodCharacteristicMap,
          getFoodCharacteristicLabel(characteristic),
          allocatedItemAmount(item, group, Number(transaction.amount || 0)),
        );
      });
    });
    expenses
      .filter(tx => !itemizedTransactionIds.has(tx.id) && foodCategoryIds.has(tx.category_id || ''))
      .forEach(tx => {
        const characteristic = subcategoryById.get(tx.subcategory_id || '')?.food_characteristic;
        addToSummary(foodCharacteristicMap, getFoodCharacteristicLabel(characteristic), Number(tx.amount || 0));
      });

    const spendingTypeRows = Array.from(spendingTypeMap.values());
    const typedPlannedTotal = sumAmounts(spendingTypeRows, row => row.planned);
    const typedActualTotal = sumAmounts(spendingTypeRows, row => row.actual);
    spendingTypeRows.forEach(row => {
      row.plannedPercent = typedPlannedTotal > 0 ? (row.planned / typedPlannedTotal) * 100 : 0;
      row.actualPercent = typedActualTotal > 0 ? (row.actual / typedActualTotal) * 100 : 0;
    });
    const foodCharacteristicRows = sortedRows(foodCharacteristicMap);
    const foodCharacteristicTotal = sumAmounts(foodCharacteristicRows, row => row.amount);

    return {
      expenses,
      incomes,
      totalExpense,
      actualIncome,
      plannedIncome,
      availableDelta,
      plannedBudget,
      budgetRemaining: plannedBudget - totalExpense,
      categoryRows,
      accountRows: sortedRows(accountMap),
      insertedByRows: sortedRows(insertedByMap),
      documentRows: sortedRows(documentMap),
      frequencyRows: sortedRows(frequencyMap),
      foodCharacteristicRows,
      foodCharacteristicTotal,
      spendingTypeRows,
      typedPlannedTotal,
      typedActualTotal,
      foodWeeklyRows,
      foodTotal,
      foodAverage,
      foodMedian,
      monthlyDocuments,
    };
  }, [budgetTargets, categoryById, categoryNameById, documents, foodCategoryIds, incomeTargets, items, month, monthRange.end, monthRange.start, subcategoryById, transactions]);

  const buildPdfLines = () => {
    const money = (value: number) => formatCurrency(value, currency).replace(/\s?\u20ac/g, ' EUR');
    const lines: PdfLine[] = [
      { text: 'Contotron - Report mensile', size: 18, bold: true, gapAfter: 4 },
      { text: `${monthLabel} ${year} - ${household?.name || 'Famiglia'}`, size: 12, bold: true },
      { text: `Periodo: ${monthRange.start} / ${monthRange.end}` },
      { text: `Generato il: ${new Date().toLocaleString('it-IT')}`, gapAfter: 10 },
      { text: 'Riepilogo generale', size: 14, bold: true },
      { text: `Entrata prevista dal budget annuale: ${money(report.plannedIncome)}` },
      { text: `Entrate effettive registrate: ${money(report.actualIncome)}` },
      { text: `Spese totali: ${money(report.totalExpense)}` },
      { text: `Delta entrata disponibile/spese: ${money(report.availableDelta)}` },
      { text: `Budget di spesa previsto: ${money(report.plannedBudget)}` },
      { text: `Residuo budget di spesa: ${money(report.budgetRemaining)}`, gapAfter: 10 },
      { text: 'Categorie e sottocategorie', size: 14, bold: true },
      { text: tableLine(['Voce', 'Previsto', 'Speso', 'Diff.'], [32, 13, 13, 13], [1, 2, 3]), mono: true, bold: true },
    ];

    report.categoryRows.forEach(category => {
      lines.push({ text: tableLine([category.name, money(category.planned), money(category.actual), money(category.planned - category.actual)], [32, 13, 13, 13], [1, 2, 3]), mono: true, bold: true });
      category.subcategories.forEach(subcategory => {
        lines.push({ text: tableLine([`  ${subcategory.name}`, money(subcategory.planned), money(subcategory.actual), money(subcategory.planned - subcategory.actual)], [32, 13, 13, 13], [1, 2, 3]), mono: true });
      });
    });

    lines.push({ text: '', gapAfter: 4 });
    lines.push({ text: 'Tipi di spesa: previsione e consuntivo', size: 14, bold: true });
    report.spendingTypeRows.forEach(row => lines.push({
      text: `${row.name}: previsto ${money(row.planned)} (${formatPercent(row.plannedPercent)}), consuntivo ${money(row.actual)} (${formatPercent(row.actualPercent)}), voci ${row.actualCount}`,
    }));

    lines.push({ text: '', gapAfter: 4 });
    lines.push({ text: `Alimentari ${year} - settimane 1-52`, size: 14, bold: true });
    lines.push({ text: `Totale: ${money(report.foodTotal)} - Media settimanale: ${money(report.foodAverage)} - Mediana: ${money(report.foodMedian)}` });
    report.foodWeeklyRows.forEach(row => lines.push({ text: `Settimana ${row.week}: ${money(row.amount)}` }));

    lines.push({ text: '', gapAfter: 4 });
    lines.push({ text: 'Frequenza delle spese', size: 14, bold: true });
    report.frequencyRows.forEach(row => lines.push({ text: `${row.name}: ${money(row.amount)} (${row.count})` }));
    lines.push({ text: 'Caratteristiche spesa alimentare', size: 14, bold: true });
    report.foodCharacteristicRows.forEach(row => {
      const percent = report.foodCharacteristicTotal > 0 ? (row.amount / report.foodCharacteristicTotal) * 100 : 0;
      lines.push({ text: `${row.name}: ${money(row.amount)} - ${formatPercent(percent)} (${row.count})` });
    });

    return lines;
  };

  const buildExcelSheets = (): ExcelSheet[] => [
    {
      name: 'Riepilogo',
      rows: [
        ['Campo', 'Valore'],
        ['Famiglia', household?.name || 'Famiglia'],
        ['Mese', `${monthLabel} ${year}`],
        ['Entrata prevista', report.plannedIncome],
        ['Entrate effettive', report.actualIncome],
        ['Spese totali', report.totalExpense],
        ['Delta disponibile', report.availableDelta],
        ['Budget di spesa', report.plannedBudget],
        ['Residuo budget', report.budgetRemaining],
      ],
    },
    {
      name: 'Categorie',
      rows: [
        ['Categoria', 'Sottocategoria', 'Previsto', 'Speso', 'Differenza', 'Movimenti'],
        ...report.categoryRows.flatMap(category => [
          [category.name, '', category.planned, category.actual, category.planned - category.actual, category.count],
          ...category.subcategories.map(subcategory => [category.name, subcategory.name, subcategory.planned, subcategory.actual, subcategory.planned - subcategory.actual, subcategory.count]),
        ]),
      ],
    },
    {
      name: 'Tipi di spesa',
      rows: [
        ['Tipo spesa', 'Previsione', '% previsione', 'Consuntivo', '% consuntivo', 'Voci previste', 'Voci effettive'],
        ...report.spendingTypeRows.map(row => [row.name, row.planned, row.plannedPercent / 100, row.actual, row.actualPercent / 100, row.plannedCount, row.actualCount]),
      ],
    },
    {
      name: 'Alimentari settimane 1-52',
      rows: [
        ['Indicatore', 'Valore'],
        ['Totale alimentari', report.foodTotal],
        ['Media settimanale', report.foodAverage],
        ['Mediana settimanale', report.foodMedian],
        [],
        ['Settimana', 'Spesa'],
        ...report.foodWeeklyRows.map(row => [row.week, row.amount]),
      ],
    },
    {
      name: 'Frequenze',
      rows: [['Frequenza', 'Spesa', 'Movimenti'], ...report.frequencyRows.map(row => [row.name, row.amount, row.count])],
    },
    {
      name: 'Caratteristiche alimentari',
      rows: [
        ['Caratteristica', 'Spesa', 'Percentuale', 'Voci'],
        ...report.foodCharacteristicRows.map(row => [
          row.name,
          row.amount,
          report.foodCharacteristicTotal > 0 ? row.amount / report.foodCharacteristicTotal : 0,
          row.count,
        ]),
      ],
    },
    {
      name: 'Persone e conti',
      rows: [
        ['Tipo', 'Nome', 'Spesa', 'Movimenti'],
        ...report.insertedByRows.map(row => ['Persona', row.name, row.amount, row.count]),
        ...report.accountRows.map(row => ['Conto', row.name, row.amount, row.count]),
      ],
    },
    {
      name: 'Documenti',
      rows: [
        ['Data', 'Tipo', 'Fornitore', 'Nome file', 'Totale indicato'],
        ...report.monthlyDocuments.map(document => [
          document.document_date || '',
          documentTypeLabels[document.type] || document.type,
          document.vendor_name || '',
          document.original_filename,
          document.total_amount || 0,
        ]),
      ],
    },
  ];

  const handleDownloadPdf = () => {
    downloadBlob(createTextPdf(buildPdfLines()), `contotron-report-${year}-${String(month).padStart(2, '0')}.pdf`);
  };

  const handleDownloadExcel = () => {
    downloadBlob(createExcelWorkbook(buildExcelSheets()), `contotron-report-${year}-${String(month).padStart(2, '0')}.xls`);
  };

  const yearOptions = Array.from({ length: 8 }, (_, index) => today.getFullYear() - index);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Consuntivo mensile</h1>
          <p className="text-muted">Riepilogo del mese, tipi di spesa e analisi delle caratteristiche alimentari.</p>
        </div>
        <div className={styles.headerActions}>
          <Button icon={<Download size={16} />} onClick={handleDownloadPdf} disabled={loading}>Genera PDF</Button>
          <Button variant="secondary" icon={<FileSpreadsheet size={16} />} onClick={handleDownloadExcel} disabled={loading}>Genera Excel</Button>
        </div>
      </header>

      <Card title="Periodo report" icon={<Calendar size={20} />} action={<Button size="sm" variant="secondary" icon={<RefreshCw size={16} />} onClick={loadReportData} disabled={loading}>Aggiorna</Button>}>
        <div className={styles.controls}>
          <label>Mese<select className={styles.select} value={month} onChange={event => setMonth(Number(event.target.value))}>{monthLabels.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label>
          <label>Anno<select className={styles.select} value={year} onChange={event => setYear(Number(event.target.value))}>{yearOptions.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
          <div className={styles.periodInfo}><span>Periodo</span><strong>{monthRange.start} / {monthRange.end}</strong></div>
        </div>
      </Card>

      {error && <div className={styles.errorBox}>{error}</div>}

      {loading ? <Card><div className={styles.loading}>Caricamento report...</div></Card> : (
        <>
          <div className={styles.stats}>
            <div className={styles.statBox}><span>Entrata prevista</span><strong className={styles.income}>{formatCurrency(report.plannedIncome, currency)}</strong></div>
            <div className={styles.statBox}><span>Entrate effettive</span><strong className={styles.income}>{formatCurrency(report.actualIncome, currency)}</strong></div>
            <div className={styles.statBox}><span>Spese mese</span><strong className={styles.expense}>{formatCurrency(report.totalExpense, currency)}</strong></div>
            <div className={styles.statBox}><span>Delta disponibile</span><strong className={report.availableDelta < 0 ? styles.expense : styles.income}>{formatCurrency(report.availableDelta, currency)}</strong></div>
            <div className={styles.statBox}><span>Documenti</span><strong>{report.monthlyDocuments.length}</strong></div>
          </div>

          <div className={styles.grid}>
            <Card title="Budget, categorie e sottocategorie" icon={<BarChart3 size={20} />}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Categoria</th><th>Previsto</th><th>Speso</th><th>Differenza</th></tr></thead>
                  <tbody>
                    {report.categoryRows.length === 0 ? <tr><td colSpan={4}>Nessuna spesa o budget per questo mese.</td></tr> : report.categoryRows.map(category => {
                      const expanded = expandedCategoryId === category.id;
                      return (
                        <React.Fragment key={category.id}>
                          <tr className={styles.categoryRow} onClick={() => setExpandedCategoryId(expanded ? null : category.id)}>
                            <td><button type="button" className={styles.categoryToggle}>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}{category.name}</button></td>
                            <td>{formatCurrency(category.planned, currency)}</td>
                            <td>{formatCurrency(category.actual, currency)}</td>
                            <td className={category.planned - category.actual < 0 ? styles.expenseText : styles.incomeText}>{formatCurrency(category.planned - category.actual, currency)}</td>
                          </tr>
                          {expanded && category.subcategories.map(subcategory => (
                            <tr key={`${category.id}-${subcategory.id}`} className={styles.subcategoryRow}>
                              <td>{subcategory.name}</td>
                              <td>{formatCurrency(subcategory.planned, currency)}</td>
                              <td>{formatCurrency(subcategory.actual, currency)}</td>
                              <td className={subcategory.planned - subcategory.actual < 0 ? styles.expenseText : styles.incomeText}>{formatCurrency(subcategory.planned - subcategory.actual, currency)}</td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Tipi di spesa: previsione e consuntivo">
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>Tipo spesa</th><th>Previsione</th><th>% previsione</th><th>Consuntivo</th><th>% consuntivo</th><th>Voci</th></tr>
                  </thead>
                  <tbody>
                    {report.spendingTypeRows.map(row => (
                      <tr key={row.id}>
                        <td><strong>{row.name}</strong></td>
                        <td>{formatCurrency(row.planned, currency)}</td>
                        <td>{formatPercent(row.plannedPercent)}</td>
                        <td>{formatCurrency(row.actual, currency)}</td>
                        <td>{formatPercent(row.actualPercent)}</td>
                        <td>{row.actualCount}</td>
                      </tr>
                    ))}
                    <tr className={styles.totalTypeRow}>
                      <td>Totale</td>
                      <td>{formatCurrency(report.typedPlannedTotal, currency)}</td>
                      <td>{formatPercent(report.typedPlannedTotal > 0 ? 100 : 0)}</td>
                      <td>{formatCurrency(report.typedActualTotal, currency)}</td>
                      <td>{formatPercent(report.typedActualTotal > 0 ? 100 : 0)}</td>
                      <td>{report.spendingTypeRows.reduce((sum, row) => sum + row.actualCount, 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className={styles.typeComparison}>
                {report.spendingTypeRows.map(row => (
                  <div key={`bars-${row.id}`} className={styles.typeComparisonRow}>
                    <strong>{row.name}</strong>
                    <div><span>Prev.</span><div className={styles.typeTrack}><i className={styles.plannedTypeBar} style={{ width: `${row.plannedPercent}%` }} /></div><b>{formatPercent(row.plannedPercent)}</b></div>
                    <div><span>Cons.</span><div className={styles.typeTrack}><i className={styles.actualTypeBar} style={{ width: `${row.actualPercent}%` }} /></div><b>{formatPercent(row.actualPercent)}</b></div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title={`Alimentari ${year}: media e mediana settimanale`}>
              <div className={styles.foodSummary}>
                <div><span>Totale annuale</span><strong>{formatCurrency(report.foodTotal, currency)}</strong></div>
                <div><span>Media settimanale</span><strong>{formatCurrency(report.foodAverage, currency)}</strong></div>
                <div><span>Mediana settimanale</span><strong>{formatCurrency(report.foodMedian, currency)}</strong></div>
              </div>
              <div className={styles.weeklyBars}>
                {report.foodWeeklyRows.map(row => {
                  const maxAmount = Math.max(...report.foodWeeklyRows.map(item => item.amount), 1);
                  const width = Math.max((row.amount / maxAmount) * 100, row.amount > 0 ? 4 : 0);
                  return <div key={row.week} className={styles.weeklyRow}><span>Sett. {row.week}</span><div className={styles.weeklyBarTrack}><div className={styles.weeklyBar} style={{ width: `${width}%` }} /></div><strong>{formatCurrency(row.amount, currency)}</strong></div>;
                })}
              </div>
            </Card>

            <Card title="Frequenza delle spese">
              <div className={styles.list}>{report.frequencyRows.length === 0 ? <div className={styles.empty}>Nessun dato</div> : report.frequencyRows.map(row => <div key={row.name} className={styles.listItem}><div><strong>{row.name}</strong><span>{row.count} movimenti</span></div><b>{formatCurrency(row.amount, currency)}</b></div>)}</div>
            </Card>

            <Card title="Caratteristiche alimentari">
              {report.foodCharacteristicRows.length === 0 ? (
                <div className={styles.empty}>Assegna le caratteristiche alle sottocategorie Alimentari.</div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Caratteristica</th><th>Spesa</th><th>Percentuale</th><th>Voci</th></tr></thead>
                    <tbody>
                      {report.foodCharacteristicRows.map(row => {
                        const percent = report.foodCharacteristicTotal > 0 ? (row.amount / report.foodCharacteristicTotal) * 100 : 0;
                        return <tr key={row.name}><td><strong>{row.name}</strong></td><td>{formatCurrency(row.amount, currency)}</td><td>{formatPercent(percent)}</td><td>{row.count}</td></tr>;
                      })}
                      <tr className={styles.totalTypeRow}><td>Totale</td><td>{formatCurrency(report.foodCharacteristicTotal, currency)}</td><td>{formatPercent(100)}</td><td>{report.foodCharacteristicRows.reduce((sum, row) => sum + row.count, 0)}</td></tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Persone e conti">
              <div className={styles.dualList}>
                <div><h4>Inserita da</h4>{report.insertedByRows.length === 0 ? <p className={styles.empty}>Nessun dato</p> : report.insertedByRows.map(row => <div key={row.name} className={styles.compactRow}><span>{row.name}</span><strong>{formatCurrency(row.amount, currency)}</strong></div>)}</div>
                <div><h4>Conto</h4>{report.accountRows.length === 0 ? <p className={styles.empty}>Nessun dato</p> : report.accountRows.map(row => <div key={row.name} className={styles.compactRow}><span>{row.name}</span><strong>{formatCurrency(row.amount, currency)}</strong></div>)}</div>
              </div>
            </Card>

            <Card title="Documenti archiviati">
              <div className={styles.list}>{report.documentRows.length === 0 ? <div className={styles.empty}>Nessun documento archiviato nel mese.</div> : report.documentRows.map(row => <div key={row.name} className={styles.listItem}><div><strong>{row.name}</strong><span>{row.count} documenti</span></div><b>{formatCurrency(row.amount, currency)}</b></div>)}</div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
