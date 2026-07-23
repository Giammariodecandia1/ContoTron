import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, RefreshCw } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useHousehold } from '../hooks';
import { formatCurrency } from '../lib/money';
import { supabase } from '../lib/supabaseClient';
import styles from './AnnualAnalysisPage.module.css';

const monthNames = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

const monthShortNames = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

const monthColors = [
  '#2563eb', '#0d9488', '#d97706', '#dc2626', '#7c3aed', '#db2777',
  '#0891b2', '#65a30d', '#ea580c', '#4f46e5', '#059669', '#b45309',
];

type BudgetRow = {
  month: number;
  planned_amount: number;
  category_id: string | null;
  subcategory_id: string | null;
};

type IncomeRow = {
  month: number;
  planned_income: number;
};

type ExpenseRow = {
  amount: number;
  type: string;
  status: string;
  transaction_date: string;
  cash_impact_date: string | null;
};

type AnalysisRow = {
  month: number;
  label: string;
  shortLabel: string;
  plannedExpense: number;
  actualExpense: number;
  plannedIncome: number;
};

type ChartValueKey = 'plannedExpense' | 'actualExpense';

const exactCurrency = (value: number, currency: string) => formatCurrency(value, currency);

const compactNumber = (value: number) => (
  Math.round(value).toLocaleString('it-IT')
);

const seriesLabels: Record<string, string> = {
  plannedExpense: 'Spese previste',
  actualExpense: 'Spese effettive',
  plannedIncome: 'Entrate previste',
};

const ExpenseChart: React.FC<{
  data: AnalysisRow[];
  valueKey: ChartValueKey;
  average: number;
  currency: string;
}> = ({ data, valueKey, average, currency }) => (
  <div className={styles.chart}>
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 28, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--color-gray-200)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="shortLabel" tick={{ fill: 'var(--color-gray-600)', fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis
          width={58}
          tick={{ fill: 'var(--color-gray-500)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={value => compactNumber(Number(value))}
        />
        <Tooltip
          formatter={(value, name) => [exactCurrency(Number(value || 0), currency), seriesLabels[String(name)] || String(name)]}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.label || ''}
          contentStyle={{
            background: 'var(--bg-card)',
            border: '1px solid var(--color-gray-200)',
            borderRadius: '6px',
            color: 'var(--color-gray-900)',
          }}
        />
        <Legend formatter={value => seriesLabels[String(value)] || value} />
        <ReferenceLine
          y={average}
          stroke="#d97706"
          strokeDasharray="6 4"
          strokeWidth={2}
          label={{ value: `Media ${compactNumber(average)}`, position: 'insideTopRight', fill: '#b45309', fontSize: 11 }}
        />
        <Bar dataKey={valueKey} name={valueKey} radius={[4, 4, 0, 0]} maxBarSize={42}>
          {data.map(row => {
            const value = row[valueKey];
            const warningColor = row.plannedIncome > 0 && value > row.plannedIncome
              ? '#dc2626'
              : value > average
                ? '#d97706'
                : undefined;
            return (
              <Cell
                key={`${valueKey}-${row.month}`}
                fill={monthColors[(row.month - 1) % monthColors.length]}
                stroke={warningColor}
                strokeWidth={warningColor ? 2 : 0}
              />
            );
          })}
          <LabelList dataKey={valueKey} position="top" formatter={value => compactNumber(Number(value || 0))} fill="var(--color-gray-700)" fontSize={10} />
        </Bar>
        <Line
          type="monotone"
          dataKey="plannedIncome"
          name="plannedIncome"
          stroke="#0e7490"
          strokeWidth={2}
          dot={{ r: 2, fill: '#0e7490' }}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  </div>
);

export const AnnualAnalysisPage: React.FC = () => {
  const { household } = useHousehold();
  const today = useMemo(() => new Date(), []);
  const currentYear = today.getFullYear();
  const householdId = household?.id || null;
  const currency = household?.currency || 'EUR';
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [budgetRows, setBudgetRows] = useState<BudgetRow[]>([]);
  const [incomeRows, setIncomeRows] = useState<IncomeRow[]>([]);
  const [expenseRows, setExpenseRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    setError(null);

    try {
      const transactionStart = `${selectedYear - 1}-12-01`;
      const transactionEnd = `${selectedYear}-12-31`;
      const [budgetResult, incomeResult, transactionResult] = await Promise.all([
        supabase
          .from('budget_targets')
          .select('month, planned_amount, category_id, subcategory_id')
          .eq('household_id', householdId)
          .eq('year', selectedYear),
        supabase
          .from('monthly_income_targets')
          .select('month, planned_income')
          .eq('household_id', householdId)
          .eq('year', selectedYear),
        supabase
          .from('transactions')
          .select('amount, type, status, transaction_date, cash_impact_date')
          .eq('household_id', householdId)
          .gte('transaction_date', transactionStart)
          .lte('transaction_date', transactionEnd)
          .neq('status', 'deleted'),
      ]);

      if (budgetResult.error) throw budgetResult.error;
      if (incomeResult.error) throw incomeResult.error;
      if (transactionResult.error) throw transactionResult.error;

      setBudgetRows((budgetResult.data || []) as BudgetRow[]);
      setIncomeRows((incomeResult.data || []) as IncomeRow[]);
      setExpenseRows((transactionResult.data || []) as ExpenseRow[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossibile caricare l analisi annuale.');
    } finally {
      setLoading(false);
    }
  }, [householdId, selectedYear]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const analysis = useMemo(() => {
    const plannedByMonth: Record<number, number> = {};
    const incomeByMonth: Record<number, number> = {};
    const actualByMonth: Record<number, number> = {};

    budgetRows.forEach(row => {
      if (!row.category_id) return;
      plannedByMonth[row.month] = (plannedByMonth[row.month] || 0) + Number(row.planned_amount || 0);
    });
    incomeRows.forEach(row => {
      incomeByMonth[row.month] = Number(row.planned_income || 0);
    });
    expenseRows.forEach(row => {
      if (row.type !== 'expense' || row.status === 'rejected') return;
      const impactDate = new Date(`${row.cash_impact_date || row.transaction_date}T00:00:00`);
      if (impactDate.getFullYear() !== selectedYear) return;
      const month = impactDate.getMonth() + 1;
      actualByMonth[month] = (actualByMonth[month] || 0) + Number(row.amount || 0);
    });

    const rows: AnalysisRow[] = monthNames.map((label, index) => ({
      month: index + 1,
      label,
      shortLabel: monthShortNames[index],
      plannedExpense: plannedByMonth[index + 1] || 0,
      actualExpense: actualByMonth[index + 1] || 0,
      plannedIncome: incomeByMonth[index + 1] || 0,
    }));
    const plannedTotal = rows.reduce((sum, row) => sum + row.plannedExpense, 0);
    const actualTotal = rows.reduce((sum, row) => sum + row.actualExpense, 0);
    const actualMonthCount = selectedYear === currentYear
      ? today.getMonth() + 1
      : 12;
    const plannedAverage = plannedTotal / 12;
    const actualAverage = actualTotal / actualMonthCount;
    const actualComparableRows = rows.slice(0, actualMonthCount);
    const plannedPeak = [...rows].sort((a, b) => b.plannedExpense - a.plannedExpense)[0];
    const actualPeak = [...actualComparableRows].sort((a, b) => b.actualExpense - a.actualExpense)[0];

    return {
      rows,
      plannedTotal,
      actualTotal,
      plannedAverage,
      actualAverage,
      actualMonthCount,
      plannedPeak,
      actualPeak,
      plannedAboveAverage: rows.filter(row => row.plannedExpense > plannedAverage).length,
      actualAboveAverage: actualComparableRows.filter(row => row.actualExpense > actualAverage).length,
      plannedAboveIncome: rows.filter(row => row.plannedIncome > 0 && row.plannedExpense > row.plannedIncome).length,
      actualAboveIncome: actualComparableRows.filter(row => row.plannedIncome > 0 && row.actualExpense > row.plannedIncome).length,
      hasIncomeTargets: rows.some(row => row.plannedIncome > 0),
    };
  }, [budgetRows, currentYear, expenseRows, incomeRows, selectedYear, today]);

  const imbalance = Math.max(0, analysis.plannedPeak.plannedExpense - analysis.plannedAverage);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Analisi annuale</h1>
          <p className="text-muted">Confronta la distribuzione mensile delle spese previste e di quelle effettive.</p>
        </div>
        <div className={styles.controls}>
          <select className={styles.yearSelect} value={selectedYear} onChange={event => setSelectedYear(Number(event.target.value))} aria-label="Anno analisi">
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
      {loading ? (
        <div className={styles.loading}>Caricamento analisi {selectedYear}...</div>
      ) : (
        <>
          {!analysis.hasIncomeTargets && (
            <div className={styles.notice}>Le entrate previste non sono ancora compilate per questo anno. I grafici mostrano comunque spese e medie.</div>
          )}
          <div className={styles.notice}>Ogni mese mantiene lo stesso colore nel previsionale e nel consuntivo. Il bordo evidenzia gli eventuali sforamenti.</div>

          <div className={styles.chartGrid}>
            <Card title="Spese previste" icon={<BarChart3 size={20} />}>
              <ExpenseChart
                data={analysis.rows}
                valueKey="plannedExpense"
                average={analysis.plannedAverage}
                currency={currency}
              />
              <div className={styles.statsGrid}>
                <div><span>Totale anno</span><strong>{exactCurrency(analysis.plannedTotal, currency)}</strong></div>
                <div><span>Media mensile</span><strong>{exactCurrency(analysis.plannedAverage, currency)}</strong></div>
                <div><span>Mesi sopra media</span><strong>{analysis.plannedAboveAverage}</strong></div>
                <div><span>Mesi sopra entrata</span><strong className={analysis.plannedAboveIncome > 0 ? styles.danger : ''}>{analysis.plannedAboveIncome}</strong></div>
              </div>
            </Card>

            <Card title="Spese effettive" icon={<BarChart3 size={20} />}>
              <ExpenseChart
                data={analysis.rows}
                valueKey="actualExpense"
                average={analysis.actualAverage}
                currency={currency}
              />
              <div className={styles.statsGrid}>
                <div><span>Totale registrato</span><strong>{exactCurrency(analysis.actualTotal, currency)}</strong></div>
                <div><span>Media su {analysis.actualMonthCount} mesi</span><strong>{exactCurrency(analysis.actualAverage, currency)}</strong></div>
                <div><span>Mesi sopra media</span><strong>{analysis.actualAboveAverage}</strong></div>
                <div><span>Mesi sopra entrata</span><strong className={analysis.actualAboveIncome > 0 ? styles.danger : ''}>{analysis.actualAboveIncome}</strong></div>
              </div>
            </Card>
          </div>

          <Card title="Indicazioni di riequilibrio">
            {analysis.plannedTotal <= 0 ? (
              <p className="text-muted">Nessun budget previsionale disponibile per il {selectedYear}.</p>
            ) : (
              <div className={styles.insights}>
                <p>
                  Il mese previsto piu impegnativo e <strong>{analysis.plannedPeak.label}</strong> con{' '}
                  <strong>{exactCurrency(analysis.plannedPeak.plannedExpense, currency)}</strong>.
                  {imbalance > 0 && <> Per avvicinarlo alla media mensile occorrerebbe redistribuire circa <strong>{exactCurrency(imbalance, currency)}</strong>.</>}
                </p>
                {analysis.actualTotal > 0 && (
                  <p>
                    Nel consuntivo, il mese con la spesa maggiore e <strong>{analysis.actualPeak.label}</strong> con{' '}
                    <strong>{exactCurrency(analysis.actualPeak.actualExpense, currency)}</strong>.
                  </p>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
};
