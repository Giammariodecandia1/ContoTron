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
import { foodCharacteristicOptions, getFoodCharacteristicLabel } from '../lib/foodCharacteristics';
import { formatCurrency } from '../lib/money';
import { spendingTypeOptions } from '../lib/spendingTypes';
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
  id: string;
  amount: number;
  type: string;
  status: string;
  transaction_date: string;
  cash_impact_date: string | null;
  category_id: string | null;
  subcategory_id: string | null;
};

type ExpenseItemRow = {
  id: string;
  transaction_id: string;
  amount: number;
  category_id: string | null;
  subcategory_id: string | null;
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

type AnnualBreakdownRow = {
  id: string;
  name: string;
  planned: number;
  actual: number;
  subcategoryCount: number;
  plannedPercent: number;
  actualPercent: number;
};

type FoodCharacteristicRow = {
  id: string;
  name: string;
  amount: number;
  count: number;
  percent: number;
};

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
  const { household, categories, subcategories } = useHousehold();
  const today = useMemo(() => new Date(), []);
  const currentYear = today.getFullYear();
  const householdId = household?.id || null;
  const currency = household?.currency || 'EUR';
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [budgetRows, setBudgetRows] = useState<BudgetRow[]>([]);
  const [incomeRows, setIncomeRows] = useState<IncomeRow[]>([]);
  const [expenseRows, setExpenseRows] = useState<ExpenseRow[]>([]);
  const [expenseItemRows, setExpenseItemRows] = useState<ExpenseItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    setError(null);

    try {
      const transactionStart = `${selectedYear - 1}-12-01`;
      const transactionEnd = `${selectedYear}-12-31`;
      const [budgetResult, incomeResult, transactionResult, itemResult] = await Promise.all([
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
          .select('id, amount, type, status, transaction_date, cash_impact_date, category_id, subcategory_id')
          .eq('household_id', householdId)
          .gte('transaction_date', transactionStart)
          .lte('transaction_date', transactionEnd)
          .neq('status', 'deleted'),
        supabase
          .from('transaction_items')
          .select('id, transaction_id, amount, category_id, subcategory_id, transactions!inner(transaction_date)')
          .eq('household_id', householdId)
          .gte('transactions.transaction_date', transactionStart)
          .lte('transactions.transaction_date', transactionEnd),
      ]);

      if (budgetResult.error) throw budgetResult.error;
      if (incomeResult.error) throw incomeResult.error;
      if (transactionResult.error) throw transactionResult.error;
      if (itemResult.error) throw itemResult.error;

      setBudgetRows((budgetResult.data || []) as BudgetRow[]);
      setIncomeRows((incomeResult.data || []) as IncomeRow[]);
      setExpenseRows((transactionResult.data || []) as ExpenseRow[]);
      setExpenseItemRows((itemResult.data || []) as unknown as ExpenseItemRow[]);
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
    const validAnnualExpenses = expenseRows.filter(row => {
      if (row.type !== 'expense' || row.status === 'rejected') return;
      const impactDate = new Date(`${row.cash_impact_date || row.transaction_date}T00:00:00`);
      return impactDate.getFullYear() === selectedYear;
    });
    validAnnualExpenses.forEach(row => {
      const impactDate = new Date(`${row.cash_impact_date || row.transaction_date}T00:00:00`);
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

    const categoryById = new Map(categories.map(category => [category.id, category]));
    const subcategoryById = new Map(subcategories.map(subcategory => [subcategory.id, subcategory]));
    const foodCategoryIds = new Set(
      categories
        .filter(category => category.name.trim().toLocaleLowerCase('it-IT') === 'alimentari')
        .map(category => category.id),
    );
    const expenseById = new Map(validAnnualExpenses.map(row => [row.id, row]));
    const itemsByTransaction = new Map<string, ExpenseItemRow[]>();
    expenseItemRows.forEach(item => {
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
    const allocatedAmount = (item: ExpenseItemRow, group: ExpenseItemRow[], transactionAmount: number) => {
      const itemTotal = group.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      return itemTotal > 0 ? Number(item.amount || 0) * transactionAmount / itemTotal : 0;
    };

    const spendingTypeMap = new Map<string, AnnualBreakdownRow>(
      spendingTypeOptions.map(option => [option.value, {
        id: option.value,
        name: option.label,
        planned: 0,
        actual: 0,
        subcategoryCount: 0,
        plannedPercent: 0,
        actualPercent: 0,
      }]),
    );
    const resolveSpendingType = (categoryId?: string | null, subcategoryId?: string | null) => (
      subcategoryById.get(subcategoryId || '')?.spending_type
      || categoryById.get(categoryId || '')?.spending_type
      || 'variable'
    );
    const addSpendingType = (
      categoryId: string | null,
      subcategoryId: string | null,
      field: 'planned' | 'actual',
      amount: number,
    ) => {
      const row = spendingTypeMap.get(resolveSpendingType(categoryId, subcategoryId))
        || spendingTypeMap.get('variable');
      if (!row) return;
      row[field] += amount;
    };
    subcategories.forEach(subcategory => {
      const row = spendingTypeMap.get(resolveSpendingType(subcategory.category_id, subcategory.id))
        || spendingTypeMap.get('variable');
      if (row) row.subcategoryCount += 1;
    });

    budgetRows
      .filter(row => row.category_id)
      .forEach(row => addSpendingType(row.category_id, row.subcategory_id, 'planned', Number(row.planned_amount || 0)));
    validAnnualExpenses
      .filter(row => !itemizedTransactionIds.has(row.id))
      .forEach(row => addSpendingType(row.category_id, row.subcategory_id, 'actual', Number(row.amount || 0)));
    itemsByTransaction.forEach((group, transactionId) => {
      if (!itemizedTransactionIds.has(transactionId)) return;
      const transaction = expenseById.get(transactionId);
      if (!transaction) return;
      group.forEach(item => addSpendingType(
        item.category_id,
        item.subcategory_id,
        'actual',
        allocatedAmount(item, group, Number(transaction.amount || 0)),
      ));
    });

    const spendingTypeRows = Array.from(spendingTypeMap.values());
    const spendingTypePlannedTotal = spendingTypeRows.reduce((sum, row) => sum + row.planned, 0);
    const spendingTypeActualTotal = spendingTypeRows.reduce((sum, row) => sum + row.actual, 0);
    spendingTypeRows.forEach(row => {
      row.plannedPercent = spendingTypePlannedTotal > 0 ? (row.planned / spendingTypePlannedTotal) * 100 : 0;
      row.actualPercent = spendingTypeActualTotal > 0 ? (row.actual / spendingTypeActualTotal) * 100 : 0;
    });

    const foodCharacteristicMap = new Map<string, FoodCharacteristicRow>(
      foodCharacteristicOptions.map(option => [option.value, {
        id: option.value,
        name: option.label,
        amount: 0,
        count: 0,
        percent: 0,
      }]),
    );
    const addFoodCharacteristic = (subcategoryId: string | null, amount: number) => {
      const characteristic = subcategoryById.get(subcategoryId || '')?.food_characteristic || 'necessary';
      const row = foodCharacteristicMap.get(characteristic) || foodCharacteristicMap.get('necessary');
      if (!row) return;
      row.amount += amount;
      row.count += 1;
    };
    validAnnualExpenses
      .filter(row => !itemizedTransactionIds.has(row.id) && foodCategoryIds.has(row.category_id || ''))
      .forEach(row => addFoodCharacteristic(row.subcategory_id, Number(row.amount || 0)));
    itemsByTransaction.forEach((group, transactionId) => {
      if (!itemizedTransactionIds.has(transactionId)) return;
      const transaction = expenseById.get(transactionId);
      if (!transaction) return;
      group
        .filter(item => foodCategoryIds.has(item.category_id || ''))
        .forEach(item => addFoodCharacteristic(
          item.subcategory_id,
          allocatedAmount(item, group, Number(transaction.amount || 0)),
        ));
    });
    const foodCharacteristicRows = Array.from(foodCharacteristicMap.values());
    const foodCharacteristicTotal = foodCharacteristicRows.reduce((sum, row) => sum + row.amount, 0);
    foodCharacteristicRows.forEach(row => {
      row.percent = foodCharacteristicTotal > 0 ? (row.amount / foodCharacteristicTotal) * 100 : 0;
      row.name = getFoodCharacteristicLabel(row.id);
    });

    return {
      rows,
      plannedTotal,
      actualTotal,
      plannedAverage,
      actualAverage,
      actualMonthCount,
      plannedAboveAverage: rows.filter(row => row.plannedExpense > plannedAverage).length,
      actualAboveAverage: actualComparableRows.filter(row => row.actualExpense > actualAverage).length,
      plannedAboveIncome: rows.filter(row => row.plannedIncome > 0 && row.plannedExpense > row.plannedIncome).length,
      actualAboveIncome: actualComparableRows.filter(row => row.plannedIncome > 0 && row.actualExpense > row.plannedIncome).length,
      hasIncomeTargets: rows.some(row => row.plannedIncome > 0),
      spendingTypeRows,
      spendingTypePlannedTotal,
      spendingTypeActualTotal,
      foodCharacteristicRows,
      foodCharacteristicTotal,
    };
  }, [budgetRows, categories, currentYear, expenseItemRows, expenseRows, incomeRows, selectedYear, subcategories, today]);

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

          <div className={styles.annualReports}>
            <Card title={`Caratteristiche alimentari ${selectedYear}`}>
              <p className="text-muted fs-sm">Riepilogo annuale delle spese Alimentari in base alla caratteristica assegnata alle sottocategorie.</p>
              <div className={styles.tableWrap}>
                <table className={styles.reportTable}>
                  <thead>
                    <tr><th>Caratteristica</th><th>Spesa</th><th>Percentuale</th><th>Voci</th></tr>
                  </thead>
                  <tbody>
                    {analysis.foodCharacteristicRows.map(row => (
                      <tr key={row.id}>
                        <td><strong>{row.name}</strong></td>
                        <td>{exactCurrency(row.amount, currency)}</td>
                        <td>{row.percent.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
                        <td>{row.count}</td>
                      </tr>
                    ))}
                    <tr className={styles.totalReportRow}>
                      <td>Totale</td>
                      <td>{exactCurrency(analysis.foodCharacteristicTotal, currency)}</td>
                      <td>{analysis.foodCharacteristicTotal > 0 ? '100,00%' : '0,00%'}</td>
                      <td>{analysis.foodCharacteristicRows.reduce((sum, row) => sum + row.count, 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title={`Tipi di spesa ${selectedYear}: previsione e consuntivo`}>
              <p className="text-muted fs-sm">Confronto annuale calcolato dalle caratteristiche delle sottocategorie del nucleo.</p>
              <div className={styles.tableWrap}>
                <table className={styles.reportTable}>
                  <thead>
                    <tr><th>Tipo spesa</th><th>Previsione</th><th>% previsione</th><th>Consuntivo</th><th>% consuntivo</th><th>Sottocategorie</th></tr>
                  </thead>
                  <tbody>
                    {analysis.spendingTypeRows.map(row => (
                      <tr key={row.id}>
                        <td><strong>{row.name}</strong></td>
                        <td>{exactCurrency(row.planned, currency)}</td>
                        <td>{row.plannedPercent.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
                        <td>{exactCurrency(row.actual, currency)}</td>
                        <td>{row.actualPercent.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
                        <td>{row.subcategoryCount}</td>
                      </tr>
                    ))}
                    <tr className={styles.totalReportRow}>
                      <td>Totale</td>
                      <td>{exactCurrency(analysis.spendingTypePlannedTotal, currency)}</td>
                      <td>{analysis.spendingTypePlannedTotal > 0 ? '100,00%' : '0,00%'}</td>
                      <td>{exactCurrency(analysis.spendingTypeActualTotal, currency)}</td>
                      <td>{analysis.spendingTypeActualTotal > 0 ? '100,00%' : '0,00%'}</td>
                      <td>{analysis.spendingTypeRows.reduce((sum, row) => sum + row.subcategoryCount, 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className={styles.typeBars}>
                {analysis.spendingTypeRows.map(row => (
                  <div key={`bars-${row.id}`} className={styles.typeBarRow}>
                    <strong>{row.name}</strong>
                    <div><span>Prev.</span><i><b className={styles.plannedBar} style={{ width: `${row.plannedPercent}%` }} /></i><em>{row.plannedPercent.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%</em></div>
                    <div><span>Cons.</span><i><b className={styles.actualBar} style={{ width: `${row.actualPercent}%` }} /></i><em>{row.actualPercent.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%</em></div>
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
