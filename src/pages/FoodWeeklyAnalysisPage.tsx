import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShoppingBasket } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useHousehold } from '../hooks';
import { formatCurrency } from '../lib/money';
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
}

interface FoodItem {
  transaction_id: string;
  amount: number;
  category_id: string | null;
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
}) => transaction.cash_impact_date || transaction.transaction_date || '';

const isoWeek = (date: Date) => {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.min(52, Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7));
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

export const FoodWeeklyAnalysisPage: React.FC = () => {
  const { household, categories } = useHousehold();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [transactions, setTransactions] = useState<FoodTransaction[]>([]);
  const [items, setItems] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const householdId = household?.id || null;

  const foodCategoryIds = useMemo(() => new Set(
    categories.filter(category => normalizeKey(category.name) === 'alimentari').map(category => category.id),
  ), [categories]);

  const loadData = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    setError(null);

    const yearStart = `${selectedYear}-01-01`;
    const yearEnd = `${selectedYear}-12-31`;
    const transactionStart = `${selectedYear - 1}-12-01`;

    try {
      const [transactionResult, itemResult] = await Promise.all([
        supabase
          .from('transactions')
          .select('id, transaction_date, cash_impact_date, amount, type, status, category_id')
          .eq('household_id', householdId)
          .gte('transaction_date', transactionStart)
          .lte('transaction_date', yearEnd)
          .neq('status', 'deleted')
          .order('transaction_date', { ascending: true }),
        supabase
          .from('transaction_items')
          .select('transaction_id, amount, category_id, transactions!inner(transaction_date, cash_impact_date)')
          .eq('household_id', householdId)
          .gte('transactions.transaction_date', transactionStart)
          .lte('transactions.transaction_date', yearEnd),
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
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossibile caricare l’analisi alimentare.');
    } finally {
      setLoading(false);
    }
  }, [householdId, selectedYear]);

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

    expenses
      .filter(row => !itemizedIds.has(row.id) && foodCategoryIds.has(row.category_id || ''))
      .forEach(row => {
        const week = isoWeek(new Date(`${impactDate(row)}T00:00:00`));
        weeklyAmounts[week - 1] += Number(row.amount || 0);
      });

    itemsByTransaction.forEach((group, transactionId) => {
      if (!itemizedIds.has(transactionId)) return;
      const transaction = expenseById.get(transactionId);
      if (!transaction) return;
      const itemTotal = group.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const week = isoWeek(new Date(`${impactDate(transaction)}T00:00:00`));

      group
        .filter(item => foodCategoryIds.has(item.category_id || ''))
        .forEach(item => {
          weeklyAmounts[week - 1] += itemTotal > 0
            ? Number(item.amount || 0) * Number(transaction.amount || 0) / itemTotal
            : 0;
        });
    });

    const total = weeklyAmounts.reduce((sum, amount) => sum + amount, 0);
    return {
      total,
      average: total / 52,
      median: median(weeklyAmounts),
      activeWeeks: weeklyAmounts.filter(amount => amount > 0).length,
      rows: weeklyAmounts.map((amount, index) => ({ week: index + 1, amount })),
    };
  }, [foodCategoryIds, items, transactions]);

  const maxAmount = Math.max(...analysis.rows.map(row => row.amount), 1);
  const currency = household?.currency || 'EUR';

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
            <p className={styles.note}>Media e mediana sono calcolate su tutte le 52 settimane, incluse quelle senza spese registrate.</p>
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
          </>
        )}
      </Card>
    </div>
  );
};
