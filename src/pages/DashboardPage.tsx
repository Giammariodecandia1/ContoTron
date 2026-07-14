import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { ExpenseCharts } from '../components/dashboard/ExpenseCharts';
import { useHousehold } from '../hooks';
import { supabase } from '../lib/supabaseClient';
import type { Transaction } from '../types/database';
import styles from './DashboardPage.module.css';

type IncomeTargetRow = {
  id?: string;
  month: number;
  planned_income: number;
};

type AnnualRow = {
  month: number;
  label: string;
  plannedIncome: number;
  plannedExpense: number;
  actualExpense: number;
  actualIncome: number;
};

type AnnualBudgetTarget = {
  month: number;
  planned_amount: number;
  category_id: string | null;
};

type DashboardTransaction = Transaction & {
  categories?: { name?: string | null } | null;
  subcategories?: { name?: string | null } | null;
};

type DashboardItem = {
  id: string;
  transaction_id: string;
  amount: number;
  category_id: string | null;
};

const monthNames = [
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

const currency = (value: number, currencyCode = 'EUR') => (
  value.toLocaleString('it-IT', { style: 'currency', currency: currencyCode })
);

export const DashboardPage: React.FC = () => {
  const { household, categories, loading: hhLoading } = useHousehold();
  const householdId = household?.id || null;
  const currencyCode = household?.currency || 'EUR';
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [transactions, setTransactions] = useState<DashboardTransaction[]>([]);
  const [transactionItems, setTransactionItems] = useState<DashboardItem[]>([]);
  const [incomeTargets, setIncomeTargets] = useState<Record<number, IncomeTargetRow>>({});
  const [incomeDrafts, setIncomeDrafts] = useState<Record<number, string>>({});
  const [plannedExpenses, setPlannedExpenses] = useState<Record<number, number>>({});
  const [budgetTargets, setBudgetTargets] = useState<AnnualBudgetTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingMonth, setSavingMonth] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!householdId) return;

    setLoading(true);
    setMessage(null);
    setError(null);

    try {
      const transactionStart = `${selectedYear - 1}-12-01`;
      const end = `${selectedYear}-12-31`;

      const [txResult, itemResult, budgetResult, incomeResult] = await Promise.all([
        supabase
          .from('transactions')
          .select('*, categories(name), subcategories(name), inserted_by_profile:profiles!transactions_inserted_by_fkey(display_name, email)')
          .eq('household_id', householdId)
          .gte('transaction_date', transactionStart)
          .lte('transaction_date', end)
          .neq('status', 'deleted')
          .order('transaction_date', { ascending: false }),
        supabase
          .from('transaction_items')
          .select('id, transaction_id, amount, category_id, transactions!inner(transaction_date)')
          .eq('household_id', householdId)
          .gte('transactions.transaction_date', transactionStart)
          .lte('transactions.transaction_date', end),
        supabase
          .from('budget_targets')
          .select('month, planned_amount, category_id, subcategory_id')
          .eq('household_id', householdId)
          .eq('year', selectedYear),
        supabase
          .from('monthly_income_targets')
          .select('id, month, planned_income')
          .eq('household_id', householdId)
          .eq('year', selectedYear),
      ]);

      if (txResult.error) throw txResult.error;
      if (itemResult.error) throw itemResult.error;
      if (budgetResult.error) throw budgetResult.error;
      if (incomeResult.error) throw incomeResult.error;

      const expenseMap: Record<number, number> = {};
      (budgetResult.data || []).forEach(row => {
        if (!row.category_id) return;
        expenseMap[row.month] = (expenseMap[row.month] || 0) + Number(row.planned_amount || 0);
      });

      const targetMap: Record<number, IncomeTargetRow> = {};
      const draftMap: Record<number, string> = {};
      (incomeResult.data || []).forEach(row => {
        targetMap[row.month] = {
          id: row.id,
          month: row.month,
          planned_income: Number(row.planned_income || 0),
        };
        draftMap[row.month] = String(Number(row.planned_income || 0));
      });

      setTransactions((txResult.data || []) as DashboardTransaction[]);
      setTransactionItems((itemResult.data || []) as unknown as DashboardItem[]);
      setBudgetTargets((budgetResult.data || []) as AnnualBudgetTarget[]);
      setPlannedExpenses(expenseMap);
      setIncomeTargets(targetMap);
      setIncomeDrafts(draftMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore durante il caricamento dashboard.');
    } finally {
      setLoading(false);
    }
  }, [householdId, selectedYear]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  const annualRows = useMemo<AnnualRow[]>(() => {
    const actualExpenses: Record<number, number> = {};
    const actualIncomes: Record<number, number> = {};

    transactions.forEach(tx => {
      const txDate = new Date(`${tx.cash_impact_date || tx.transaction_date}T00:00:00`);
      if (txDate.getFullYear() !== selectedYear) return;
      const month = txDate.getMonth() + 1;
      if (tx.type === 'expense') {
        actualExpenses[month] = (actualExpenses[month] || 0) + Number(tx.amount || 0);
      } else if (tx.type === 'income') {
        actualIncomes[month] = (actualIncomes[month] || 0) + Number(tx.amount || 0);
      }
    });

    return monthNames.map((label, index) => {
      const month = index + 1;
      return {
        month,
        label,
        plannedIncome: incomeTargets[month]?.planned_income || 0,
        plannedExpense: plannedExpenses[month] || 0,
        actualExpense: actualExpenses[month] || 0,
        actualIncome: actualIncomes[month] || 0,
      };
    });
  }, [incomeTargets, plannedExpenses, selectedYear, transactions]);

  const totals = useMemo(() => {
    const total = annualRows.reduce((acc, row) => ({
      plannedIncome: acc.plannedIncome + row.plannedIncome,
      plannedExpense: acc.plannedExpense + row.plannedExpense,
      actualExpense: acc.actualExpense + row.actualExpense,
      actualIncome: acc.actualIncome + row.actualIncome,
    }), {
      plannedIncome: 0,
      plannedExpense: 0,
      actualExpense: 0,
      actualIncome: 0,
    });

    return {
      ...total,
      plannedDelta: total.plannedIncome - total.plannedExpense,
      actualDelta: total.plannedIncome - total.actualExpense,
      averagePlannedIncome: total.plannedIncome / 12,
      averagePlannedExpense: total.plannedExpense / 12,
      averageActualExpense: total.actualExpense / 12,
    };
  }, [annualRows]);

  const annualCategoryRows = useMemo(() => {
    const planned = new Map<string, Record<number, number>>();
    const actual = new Map<string, Record<number, number>>();

    budgetTargets.forEach(target => {
      if (!target.category_id) return;
      const months = planned.get(target.category_id) || {};
      months[target.month] = (months[target.month] || 0) + Number(target.planned_amount || 0);
      planned.set(target.category_id, months);
    });

    const expenseById = new Map<string, DashboardTransaction>();
    transactions.forEach(tx => {
      if (tx.type !== 'expense') return;
      const date = new Date(`${tx.cash_impact_date || tx.transaction_date}T00:00:00`);
      if (date.getFullYear() !== selectedYear) return;
      expenseById.set(tx.id, tx);
    });
    const itemsByTransaction = new Map<string, DashboardItem[]>();
    transactionItems.forEach(item => {
      if (!expenseById.has(item.transaction_id)) return;
      const group = itemsByTransaction.get(item.transaction_id) || [];
      group.push(item);
      itemsByTransaction.set(item.transaction_id, group);
    });
    const itemizedTransactionIds = new Set(
      Array.from(itemsByTransaction.entries())
        .filter(([, group]) => group.reduce((sum, item) => sum + Number(item.amount || 0), 0) > 0)
        .map(([transactionId]) => transactionId),
    );

    expenseById.forEach(tx => {
      if (!tx.category_id || itemizedTransactionIds.has(tx.id)) return;
      const date = new Date(`${tx.cash_impact_date || tx.transaction_date}T00:00:00`);
      const month = date.getMonth() + 1;
      const months = actual.get(tx.category_id) || {};
      months[month] = (months[month] || 0) + Number(tx.amount || 0);
      actual.set(tx.category_id, months);
    });
    itemsByTransaction.forEach((group, transactionId) => {
      if (!itemizedTransactionIds.has(transactionId)) return;
      const transaction = expenseById.get(transactionId);
      if (!transaction) return;
      const itemTotal = group.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const date = new Date(`${transaction.cash_impact_date || transaction.transaction_date}T00:00:00`);
      const month = date.getMonth() + 1;

      group.forEach(item => {
        if (!item.category_id) return;
        const months = actual.get(item.category_id) || {};
        const allocatedAmount = Number(item.amount || 0) * Number(transaction.amount || 0) / itemTotal;
        months[month] = (months[month] || 0) + allocatedAmount;
        actual.set(item.category_id, months);
      });
    });

    return categories
      .filter(category => category.type === 'expense')
      .map(category => {
        const plannedMonths = planned.get(category.id) || {};
        const actualMonths = actual.get(category.id) || {};
        const months = monthNames.map((_, index) => ({
          month: index + 1,
          planned: plannedMonths[index + 1] || 0,
          actual: actualMonths[index + 1] || 0,
        }));

        return {
          id: category.id,
          name: category.name,
          months,
          plannedTotal: months.reduce((sum, month) => sum + month.planned, 0),
          actualTotal: months.reduce((sum, month) => sum + month.actual, 0),
        };
      })
      .filter(row => row.plannedTotal > 0 || row.actualTotal > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [budgetTargets, categories, selectedYear, transactionItems, transactions]);

  const handleIncomeChange = (month: number, value: string) => {
    setIncomeDrafts(prev => ({ ...prev, [month]: value }));
  };

  const saveIncomeTarget = async (month: number) => {
    if (!householdId) return;

    const value = Number((incomeDrafts[month] || '').replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) {
      setError('Inserisci una previsione entrate valida.');
      return;
    }

    setSavingMonth(month);
    setError(null);
    setMessage(null);

    try {
      const existing = incomeTargets[month];
      if (existing?.id) {
        const { error: updateError } = await supabase
          .from('monthly_income_targets')
          .update({ planned_income: value, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .eq('household_id', householdId);

        if (updateError) throw updateError;
      } else {
        const { data, error: insertError } = await supabase
          .from('monthly_income_targets')
          .insert([{
            household_id: householdId,
            year: selectedYear,
            month,
            planned_income: value,
          }])
          .select('id, month, planned_income')
          .single();

        if (insertError) throw insertError;
        if (data) {
          setIncomeTargets(prev => ({
            ...prev,
            [month]: {
              id: data.id,
              month: data.month,
              planned_income: Number(data.planned_income || 0),
            },
          }));
        }
      }

      setIncomeTargets(prev => ({
        ...prev,
        [month]: {
          ...prev[month],
          month,
          planned_income: value,
        },
      }));
      setMessage(`Entrata prevista di ${monthNames[month - 1]} salvata.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile salvare entrata prevista.');
    } finally {
      setSavingMonth(null);
    }
  };

  if (hhLoading && !household) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', padding: '2rem' }}>Caricamento dashboard...</div>;
  }

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Dashboard</h1>
          <p className="text-muted">Quadro annuale del nucleo {household?.name}.</p>
        </div>
        <select className={styles.yearSelect} value={selectedYear} onChange={event => setSelectedYear(Number(event.target.value))}>
          {Array.from({ length: 5 }, (_, index) => currentYear - 2 + index).map(year => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>
      </header>

      <Link to="/scan" className={styles.mobileScanCard}>
        <span className={styles.mobileScanIcon}>
          <Camera size={24} />
        </span>
        <span>
          <strong>Scansiona scontrino</strong>
          <small>Foto rapida, OCR e transazione automatica</small>
        </span>
      </Link>

      <div className={styles.kpiGrid}>
        <Card>
          <div className={styles.kpiLabel}>Entrate previste anno</div>
          <p className={styles.kpiValue}>{currency(totals.plannedIncome, currencyCode)}</p>
        </Card>
        <Card>
          <div className={styles.kpiLabel}>Uscite previste anno</div>
          <p className={styles.kpiValue}>{currency(totals.plannedExpense, currencyCode)}</p>
        </Card>
        <Card>
          <div className={styles.kpiLabel}>Delta previsto</div>
          <p className={`${styles.kpiValue} ${totals.plannedDelta >= 0 ? styles.positive : styles.negative}`}>
            {currency(totals.plannedDelta, currencyCode)}
          </p>
          <div className={styles.kpiTrend}>
            {totals.plannedDelta >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            Media mensile: {currency(totals.plannedDelta / 12, currencyCode)}
          </div>
        </Card>
        <Card>
          <div className={styles.kpiLabel}>Uscite effettive anno</div>
          <p className={styles.kpiValue}>{currency(totals.actualExpense, currencyCode)}</p>
        </Card>
      </div>

      <Card title="Previsione annuale" icon={<Wallet size={20} />}>
        {message && <div className={`${styles.notice} ${styles.success}`}>{message}</div>}
        {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}
        {loading ? (
          <div className={styles.empty}>Caricamento quadro annuale...</div>
        ) : (
          <div className={styles.annualTableWrapper}>
            <table className={styles.annualTable}>
              <thead>
                <tr>
                  <th>Mese</th>
                  <th>Entrate previste</th>
                  <th>Uscite previste</th>
                  <th>Delta previsto</th>
                  <th>Uscite effettive</th>
                  <th>Delta reale</th>
                </tr>
              </thead>
              <tbody>
                {annualRows.map(row => {
                  const plannedDelta = row.plannedIncome - row.plannedExpense;
                  const actualDelta = row.plannedIncome - row.actualExpense;

                  return (
                    <tr key={row.month}>
                      <td data-label="Mese">{row.label}</td>
                      <td data-label="Entrate previste">
                        <input
                          className={styles.incomeInput}
                          type="number"
                          step="0.01"
                          value={incomeDrafts[row.month] ?? ''}
                          onChange={event => handleIncomeChange(row.month, event.target.value)}
                          onBlur={() => saveIncomeTarget(row.month)}
                          disabled={savingMonth === row.month}
                          placeholder="0"
                        />
                      </td>
                      <td data-label="Uscite previste">{currency(row.plannedExpense, currencyCode)}</td>
                      <td data-label="Delta previsto" className={plannedDelta >= 0 ? styles.positive : styles.negative}>
                        {currency(plannedDelta, currencyCode)}
                      </td>
                      <td data-label="Uscite effettive">{currency(row.actualExpense, currencyCode)}</td>
                      <td data-label="Delta reale" className={actualDelta >= 0 ? styles.positive : styles.negative}>
                        {currency(actualDelta, currencyCode)}
                      </td>
                    </tr>
                  );
                })}
                <tr className={styles.totalRow}>
                  <td data-label="Mese">Totale</td>
                  <td data-label="Entrate previste">{currency(totals.plannedIncome, currencyCode)}</td>
                  <td data-label="Uscite previste">{currency(totals.plannedExpense, currencyCode)}</td>
                  <td data-label="Delta previsto" className={totals.plannedDelta >= 0 ? styles.positive : styles.negative}>
                    {currency(totals.plannedDelta, currencyCode)}
                  </td>
                  <td data-label="Uscite effettive">{currency(totals.actualExpense, currencyCode)}</td>
                  <td data-label="Delta reale" className={totals.actualDelta >= 0 ? styles.positive : styles.negative}>
                    {currency(totals.actualDelta, currencyCode)}
                  </td>
                </tr>
                <tr className={styles.averageRow}>
                  <td data-label="Mese">Media mese</td>
                  <td data-label="Entrate previste">{currency(totals.averagePlannedIncome, currencyCode)}</td>
                  <td data-label="Uscite previste">{currency(totals.averagePlannedExpense, currencyCode)}</td>
                  <td data-label="Delta previsto">{currency(totals.plannedDelta / 12, currencyCode)}</td>
                  <td data-label="Uscite effettive">{currency(totals.averageActualExpense, currencyCode)}</td>
                  <td data-label="Delta reale">{currency(totals.actualDelta / 12, currencyCode)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Budget per categoria ${selectedYear}`}>
        <p className="text-muted fs-sm">Categorie in ordine alfabetico. Per ogni mese sono affiancati previsto e consuntivo.</p>
        {annualCategoryRows.length === 0 ? (
          <div className={styles.empty}>Nessun budget o movimento categorizzato per l'anno selezionato.</div>
        ) : (
          <div className={styles.categoryAnnualList}>
            {annualCategoryRows.map(row => (
              <section key={row.id} className={styles.categoryAnnualSection}>
                <header className={styles.categoryAnnualHeader}>
                  <h3>{row.name}</h3>
                  <div className={styles.categoryAnnualTotals}>
                    <span>Previsto <strong>{currency(row.plannedTotal, currencyCode)}</strong></span>
                    <span>Consuntivo <strong>{currency(row.actualTotal, currencyCode)}</strong></span>
                  </div>
                </header>
                <div className={styles.categoryMonthGrid}>
                  {row.months.map(month => (
                    <div key={month.month} className={styles.categoryMonthCell}>
                      <span className={styles.categoryMonthName}>{monthNames[month.month - 1]}</span>
                      <span className={styles.plannedValue}>Prev. {currency(month.planned, currencyCode)}</span>
                      <span className={styles.actualValue}>Cons. {currency(month.actual, currencyCode)}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Card>

      {transactions.length > 0 && (
        <ExpenseCharts transactions={transactions} selectedYear={selectedYear} />
      )}
    </div>
  );
};
