import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, ShoppingBasket } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useHousehold } from '../hooks';
import { formatCurrency, roundMoney } from '../lib/money';
import { createExcelWorkbook } from '../lib/excelXml';
import {
  fetchRecurringBudgetPlans,
  recurringBudgetPeriodsForYear,
  syncRecurringBudgetPlanMonths,
  type RecurringBudgetPlanWithItems,
} from '../lib/recurringBudgetPlans';
import { supabase } from '../lib/supabaseClient';
import styles from './FoodWeeklyAnalysisPage.module.css';

interface FoodTransaction {
  id: string;
  transaction_date: string;
  cash_impact_date?: string | null;
  amount: number;
  type: string;
  status: string;
  category_id: string | null;
  subcategory_id: string | null;
}

interface FoodItem {
  transaction_id: string;
  amount: number;
  category_id: string | null;
  subcategory_id: string | null;
  transactions?: {
    transaction_date?: string | null;
    cash_impact_date?: string | null;
  } | null;
}

const normalizeKey = (value: string) => (
  value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
);

const impactDate = (transaction: {
  transaction_date?: string | null;
  cash_impact_date?: string | null;
}) => transaction.transaction_date || '';

const isoWeek = (date: Date) => {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.min(52, Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7));
};

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const monthNames = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

export const FoodWeeklyAnalysisPage: React.FC = () => {
  const { household, categories, subcategories } = useHousehold();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [transactions, setTransactions] = useState<FoodTransaction[]>([]);
  const [items, setItems] = useState<FoodItem[]>([]);
  const [foodPlan, setFoodPlan] = useState<RecurringBudgetPlanWithItems | null>(null);
  const [exportWeekFrom, setExportWeekFrom] = useState(36);
  const [exportWeekTo, setExportWeekTo] = useState(37);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const householdId = household?.id || null;

  const foodCategoryIds = useMemo(() => new Set(
    categories.filter(category => normalizeKey(category.name) === 'alimentari').map(category => category.id),
  ), [categories]);
  const foodSubcategories = useMemo(() => subcategories
    .filter(subcategory => foodCategoryIds.has(subcategory.category_id))
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name)), [foodCategoryIds, subcategories]);

  const loadData = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    setError(null);

    const yearStart = `${selectedYear}-01-01`;
    const yearEnd = `${selectedYear}-12-31`;
    const transactionStart = `${selectedYear - 1}-12-01`;
    const now = new Date();
    const monthsToSync = recurringBudgetPeriodsForYear(selectedYear, now.getFullYear(), now.getMonth() + 1);
    const planRequest = syncRecurringBudgetPlanMonths(householdId, monthsToSync, [...foodCategoryIds]).catch(async syncError => {
      // Un membro in sola lettura deve comunque poter consultare l'analisi.
      // In quel caso mostriamo il piano senza tentare di modificare i budget.
      console.warn('Piano Alimentari non sincronizzato automaticamente:', syncError);
      try {
        return await fetchRecurringBudgetPlans(householdId);
      } catch {
        return [];
      }
    });

    try {
      const [transactionResult, itemResult, plans] = await Promise.all([
        supabase
          .from('transactions')
          .select('id, transaction_date, cash_impact_date, amount, type, status, category_id, subcategory_id')
          .eq('household_id', householdId)
          .gte('transaction_date', transactionStart)
          .lte('transaction_date', yearEnd)
          .neq('status', 'deleted')
          .order('transaction_date', { ascending: true }),
        supabase
          .from('transaction_items')
          .select('transaction_id, amount, category_id, subcategory_id, transactions!inner(transaction_date, cash_impact_date)')
          .eq('household_id', householdId)
          .gte('transactions.transaction_date', transactionStart)
          .lte('transactions.transaction_date', yearEnd),
        planRequest,
      ]);

      if (transactionResult.error) throw transactionResult.error;
      if (itemResult.error) throw itemResult.error;

      setTransactions(((transactionResult.data || []) as FoodTransaction[]).filter(row => {
        const date = impactDate(row);
        return date >= yearStart && date <= yearEnd;
      }));
      setItems(((itemResult.data || []) as unknown as FoodItem[]).filter(row => {
        const date = impactDate(row.transactions || {});
        return date >= yearStart && date <= yearEnd;
      }));
      setFoodPlan(plans.find(plan => foodCategoryIds.has(plan.category_id)) || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossibile caricare l’analisi alimentare.');
    } finally {
      setLoading(false);
    }
  }, [foodCategoryIds, householdId, selectedYear]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const analysis = useMemo(() => {
    const expenses = transactions.filter(row => row.type === 'expense' && row.status !== 'rejected');
    const expenseById = new Map(expenses.map(row => [row.id, row]));
    const itemsByTransaction = new Map<string, FoodItem[]>();

    items.forEach(item => {
      if (!expenseById.has(item.transaction_id)) return;
      const group = itemsByTransaction.get(item.transaction_id) || [];
      group.push(item);
      itemsByTransaction.set(item.transaction_id, group);
    });

    const itemizedIds = new Set(
      Array.from(itemsByTransaction.entries())
        .filter(([, group]) => group.reduce((sum, item) => sum + Number(item.amount || 0), 0) > 0)
        .map(([transactionId]) => transactionId),
    );
    const weeklyAmounts = Array.from({ length: 52 }, () => 0);
    const weeklyAmountsBySubcategory = new Map<string, number[]>();
    const monthlyAmountsBySubcategory = new Map<string, number[]>();
    foodSubcategories.forEach(subcategory => {
      weeklyAmountsBySubcategory.set(subcategory.id, Array.from({ length: 52 }, () => 0));
      monthlyAmountsBySubcategory.set(subcategory.id, Array.from({ length: 12 }, () => 0));
    });
    const unclassifiedWeeklyAmounts = Array.from({ length: 52 }, () => 0);
    const unclassifiedMonthlyAmounts = Array.from({ length: 12 }, () => 0);
    const addFoodAmount = (dateValue: string, amount: number, subcategoryId: string | null) => {
      const date = new Date(`${dateValue}T00:00:00`);
      const week = isoWeek(date);
      const index = week - 1;
      const monthIndex = date.getMonth();
      weeklyAmounts[index] += amount;
      if (subcategoryId && weeklyAmountsBySubcategory.has(subcategoryId)) {
        weeklyAmountsBySubcategory.get(subcategoryId)![index] += amount;
        monthlyAmountsBySubcategory.get(subcategoryId)![monthIndex] += amount;
      } else {
        unclassifiedWeeklyAmounts[index] += amount;
        unclassifiedMonthlyAmounts[monthIndex] += amount;
      }
    };

    expenses
      .filter(row => !itemizedIds.has(row.id) && foodCategoryIds.has(row.category_id || ''))
      .forEach(row => {
        addFoodAmount(impactDate(row), Number(row.amount || 0), row.subcategory_id);
      });

    itemsByTransaction.forEach((group, transactionId) => {
      if (!itemizedIds.has(transactionId)) return;
      const transaction = expenseById.get(transactionId);
      if (!transaction) return;
      const itemTotal = group.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      group
        .filter(item => foodCategoryIds.has(item.category_id || ''))
        .forEach(item => {
          addFoodAmount(
            impactDate(transaction),
            itemTotal > 0 ? Number(item.amount || 0) * Number(transaction.amount || 0) / itemTotal : 0,
            item.subcategory_id,
          );
        });
    });

    const total = weeklyAmounts.reduce((sum, amount) => sum + amount, 0);
    return {
      total,
      average: total / 52,
      median: median(weeklyAmounts.filter(amount => amount > 0)),
      activeWeeks: weeklyAmounts.filter(amount => amount > 0).length,
      rows: weeklyAmounts.map((amount, index) => ({ week: index + 1, amount })),
      subcategoryRows: [
        ...foodSubcategories.map(subcategory => ({
          name: subcategory.name,
          weeklyAmounts: weeklyAmountsBySubcategory.get(subcategory.id) || Array.from({ length: 52 }, () => 0),
          monthlyAmounts: monthlyAmountsBySubcategory.get(subcategory.id) || Array.from({ length: 12 }, () => 0),
        })),
        ...(unclassifiedWeeklyAmounts.some(amount => amount > 0)
          ? [{ name: 'Non classificato', weeklyAmounts: unclassifiedWeeklyAmounts, monthlyAmounts: unclassifiedMonthlyAmounts }]
          : []),
      ],
    };
  }, [foodCategoryIds, foodSubcategories, items, transactions]);

  const maxAmount = Math.max(...analysis.rows.map(row => row.amount), 1);
  const currency = household?.currency || 'EUR';
  const planAmountBySubcategory = useMemo(() => new Map(
    (foodPlan?.items || []).map(item => [item.subcategory_id, Number(item.monthly_amount || 0)]),
  ), [foodPlan]);
  const plannedMonthlyTotal = foodSubcategories.reduce(
    (sum, subcategory) => sum + (planAmountBySubcategory.get(subcategory.id) || 0),
    0,
  );
  const actualMonthlyTotal = analysis.subcategoryRows.reduce(
    (sum, row) => sum + (row.monthlyAmounts[selectedMonth - 1] || 0),
    0,
  );

  const exportWeeklyVerification = () => {
    const from = Math.max(1, Math.min(52, Math.min(exportWeekFrom, exportWeekTo)));
    const to = Math.max(1, Math.min(52, Math.max(exportWeekFrom, exportWeekTo)));
    const weeks = Array.from({ length: to - from + 1 }, (_, index) => from + index);
    const rows = [
      ['Sottocategoria', ...weeks.map(week => `Settimana ${week}`), 'Totale'],
      ...analysis.subcategoryRows.map(row => {
        const values = weeks.map(week => roundMoney(row.weeklyAmounts[week - 1] || 0));
        return [row.name, ...values, roundMoney(values.reduce((sum, amount) => sum + amount, 0))];
      }),
    ];
    downloadBlob(
      createExcelWorkbook([{ name: 'Verifica alimentari', rows }]),
      `contotron-alimentari-${selectedYear}-settimane-${from}-${to}.xls`,
    );
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Analisi alimentari</h1>
          <p className="text-muted">Media, mediana e andamento delle spese Alimentari nelle 52 settimane dell’anno.</p>
        </div>
        <div className={styles.controls}>
          <select value={selectedYear} onChange={event => setSelectedYear(Number(event.target.value))} aria-label="Anno analisi alimentari">
            {Array.from({ length: 7 }, (_, index) => currentYear - 3 + index).map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          <Button variant="secondary" size="sm" icon={<RefreshCw size={16} />} onClick={loadData} disabled={loading}>
            Aggiorna
          </Button>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}
      <Card title={`Alimentari ${selectedYear}: media e mediana settimanale`} icon={<ShoppingBasket size={20} />}>
        {loading ? (
          <div className={styles.loading}>Caricamento analisi...</div>
        ) : (
          <>
            <div className={styles.summary}>
              <div><span>Totale annuale</span><strong>{formatCurrency(analysis.total, currency)}</strong></div>
              <div><span>Media settimanale</span><strong>{formatCurrency(analysis.average, currency)}</strong></div>
              <div><span>Mediana settimanale</span><strong>{formatCurrency(analysis.median, currency)}</strong></div>
              <div><span>Settimane con spese</span><strong>{analysis.activeWeeks} / 52</strong></div>
            </div>
            <p className={styles.note}>La media considera tutte le 52 settimane; la mediana considera solo le settimane con spese registrate.</p>
            <section className={styles.weekVerification} aria-labelledby="food-week-verification-title">
              <div>
                <h3 id="food-week-verification-title">Verifica per sottocategoria</h3>
                <p>Esporta un foglio Excel con le sottocategorie e i rispettivi valori settimanali.</p>
              </div>
              <div className={styles.weekVerificationControls}>
                <label>Da settimana
                  <input type="number" min="1" max="52" value={exportWeekFrom} onChange={event => setExportWeekFrom(Number(event.target.value) || 1)} />
                </label>
                <label>A settimana
                  <input type="number" min="1" max="52" value={exportWeekTo} onChange={event => setExportWeekTo(Number(event.target.value) || 1)} />
                </label>
                <Button size="sm" variant="secondary" icon={<Download size={16} />} onClick={exportWeeklyVerification}>Esporta Excel</Button>
              </div>
            </section>
            <div className={styles.weeklyRows} role="list" aria-label={`Spese alimentari settimanali ${selectedYear}`}>
              {analysis.rows.map(row => (
                <div key={row.week} className={styles.weeklyRow} role="listitem">
                  <span>Sett. {row.week}</span>
                  <div className={styles.track} aria-hidden="true">
                    <div className={styles.bar} style={{ width: `${row.amount > 0 ? Math.max(3, row.amount / maxAmount * 100) : 0}%` }} />
                  </div>
                  <strong>{formatCurrency(row.amount, currency)}</strong>
                </div>
              ))}
            </div>
            <section className={styles.monthlyActual} aria-labelledby="food-monthly-actual-title">
              <header>
                <div>
                  <h3 id="food-monthly-actual-title">Consuntivo mensile per sottocategoria</h3>
                  <p>Quanto e stato effettivamente speso nel mese scelto, calcolato dalle transazioni registrate.</p>
                </div>
                <div className={styles.monthlyActualControls}>
                  <select value={selectedMonth} onChange={event => setSelectedMonth(Number(event.target.value))} aria-label="Mese consuntivo alimentari">
                    {monthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
                  </select>
                  <strong>{formatCurrency(actualMonthlyTotal, currency)}</strong>
                </div>
              </header>
              <div className={styles.monthlyPlanRows} role="list">
                {analysis.subcategoryRows.map(row => (
                  <div key={`actual-${row.name}`} className={styles.monthlyPlanRow} role="listitem">
                    <span>{row.name}</span>
                    <strong>{formatCurrency(row.monthlyAmounts[selectedMonth - 1] || 0, currency)}</strong>
                  </div>
                ))}
              </div>
            </section>
            <section className={styles.monthlyPlan} aria-labelledby="food-monthly-plan-title">
              <header>
                <div>
                  <h3 id="food-monthly-plan-title">Medie mensili per sottocategoria</h3>
                  <p>
                    Valori del piano Alimentari usati automaticamente come previsto nei mesi successivi.
                    Le modifiche manuali di un singolo mese restano invariate.
                  </p>
                </div>
                <strong>{formatCurrency(plannedMonthlyTotal, currency)}</strong>
              </header>
              {!foodPlan && (
                <p className={styles.planNotice}>
                  Configura il Piano settimanale facoltativo in Budget mensile per attivare la compilazione automatica.
                </p>
              )}
              <div className={styles.monthlyPlanRows} role="list">
                {foodSubcategories.map(subcategory => (
                  <div key={subcategory.id} className={styles.monthlyPlanRow} role="listitem">
                    <span>{subcategory.name}</span>
                    <strong>{formatCurrency(planAmountBySubcategory.get(subcategory.id) || 0, currency)}</strong>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </Card>
    </div>
  );
};
