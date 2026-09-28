import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Check, Pencil, Plus, TrendingDown, TrendingUp, Wallet, X } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { useAuth, useHousehold, useHouseholdMembers } from '../hooks';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency, formatPercentage } from '../lib/money';
import {
  calculateEffectiveIncome,
  summarizeAnnualCashFlow,
  type CreditCardAdvanceDetail,
} from '../lib/annualCashFlow';
import type { Transaction } from '../types/database';
import { generateIncomeSchedule, type IncomeCadence, type IncomeSourceSchedule, type ScheduledIncome } from '../lib/incomeSchedule';
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
  immediateExpense: number;
  creditCardAdvance: number;
  creditCardAdvanceDetails: CreditCardAdvanceDetail[];
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

type IncomeSourceRow = IncomeSourceSchedule & {
  household_id: string;
  beneficiary_user_id: string;
  account_id: string | null;
  created_by: string | null;
};

type IncomeSourceDraft = {
  name: string;
  beneficiary_user_id: string;
  account_id: string;
  amount: string;
  payday: string;
  cadence: IncomeCadence;
  effective_from: string;
  thirteenth_amount: string;
  thirteenth_month: string;
  fourteenth_amount: string;
  fourteenth_month: string;
};

type ScheduledIncomeWithStatus = ScheduledIncome & {
  beneficiary_user_id: string;
  account_id: string | null;
  beneficiaryName: string;
  transaction: DashboardTransaction | null;
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
  formatCurrency(value, currencyCode)
);

export const DashboardPage: React.FC = () => {
  const { household, accounts, categories, loading: hhLoading } = useHousehold();
  const { user } = useAuth();
  const { members } = useHouseholdMembers();
  const currentMembership = members.find(member => member.userId === user?.id) || null;
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
  const [incomeSources, setIncomeSources] = useState<IncomeSourceRow[]>([]);
  const [incomePanelOpen, setIncomePanelOpen] = useState(false);
  const [incomeFormOpen, setIncomeFormOpen] = useState(false);
  const [editingIncomeSource, setEditingIncomeSource] = useState<IncomeSourceRow | null>(null);
  const [incomeSourceDraft, setIncomeSourceDraft] = useState<IncomeSourceDraft | null>(null);
  const [incomeActualDrafts, setIncomeActualDrafts] = useState<Record<string, string>>({});
  const [savingIncome, setSavingIncome] = useState(false);
  const [savingOccurrence, setSavingOccurrence] = useState<string | null>(null);
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

      const [txResult, itemResult, budgetResult, incomeResult, sourcesResult] = await Promise.all([
        supabase
          .from('transactions')
          .select('*, categories(name), subcategories(name), inserted_by_profile:profiles!transactions_inserted_by_fkey(display_name, email)')
          .eq('household_id', householdId)
          .gte('transaction_date', transactionStart)
          .lte('transaction_date', end)
          .eq('status', 'confirmed')
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
        supabase
          .from('income_sources')
          .select('id, household_id, name, beneficiary_user_id, account_id, amount, payday, cadence, effective_from, effective_to, thirteenth_amount, thirteenth_month, fourteenth_amount, fourteenth_month, created_by')
          .eq('household_id', householdId)
          .order('created_at', { ascending: true }),
      ]);

      if (txResult.error) throw txResult.error;
      if (itemResult.error) throw itemResult.error;
      if (budgetResult.error) throw budgetResult.error;
      if (incomeResult.error) throw incomeResult.error;
      if (sourcesResult.error) throw sourcesResult.error;

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
      setIncomeSources((sourcesResult.data || []) as IncomeSourceRow[]);
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
    const cashFlow = summarizeAnnualCashFlow(transactions, selectedYear);
    const sourceSchedule = generateIncomeSchedule(incomeSources, selectedYear);
    const sourceTotals: Record<number, number> = {};
    sourceSchedule.forEach(entry => {
      sourceTotals[entry.month] = (sourceTotals[entry.month] || 0) + entry.amount;
    });

    return monthNames.map((label, index) => {
      const month = index + 1;
      const monthStart = `${selectedYear}-${String(month).padStart(2, '0')}-01`;
      const monthEnd = `${selectedYear}-${String(month).padStart(2, '0')}-${String(new Date(selectedYear, month, 0).getDate()).padStart(2, '0')}`;
      const hasIncomeSource = incomeSources.some(source => source.effective_from <= monthEnd && (!source.effective_to || source.effective_to >= monthStart));
      const plannedIncome = hasIncomeSource ? sourceTotals[month] || 0 : incomeTargets[month]?.planned_income || 0;
      const monthFlow = cashFlow[month];
      return {
        month,
        label,
        plannedIncome,
        plannedExpense: plannedExpenses[month] || 0,
        actualExpense: monthFlow.nominalExpense,
        immediateExpense: monthFlow.immediateExpense,
        creditCardAdvance: monthFlow.creditCardAdvance,
        creditCardAdvanceDetails: monthFlow.creditCardAdvanceDetails,
        actualIncome: calculateEffectiveIncome(
          plannedIncome,
          monthFlow.recordedIncome,
          monthFlow.creditCardAdvance,
        ),
      };
    });
  }, [incomeSources, incomeTargets, plannedExpenses, selectedYear, transactions]);

  const totals = useMemo(() => {
    const total = annualRows.reduce((acc, row) => ({
      plannedIncome: acc.plannedIncome + row.plannedIncome,
      plannedExpense: acc.plannedExpense + row.plannedExpense,
      actualExpense: acc.actualExpense + row.actualExpense,
      immediateExpense: acc.immediateExpense + row.immediateExpense,
      creditCardAdvance: acc.creditCardAdvance + row.creditCardAdvance,
      actualIncome: acc.actualIncome + row.actualIncome,
    }), {
      plannedIncome: 0,
      plannedExpense: 0,
      actualExpense: 0,
      immediateExpense: 0,
      creditCardAdvance: 0,
      actualIncome: 0,
    });

    return {
        ...total,
        plannedDelta: total.plannedIncome - total.plannedExpense,
        actualDelta: total.actualIncome - total.immediateExpense,
    };
  }, [annualRows]);

  const actualExpenseMonthCount = useMemo(
    () => annualRows.filter(row => row.actualExpense > 0).length,
    [annualRows],
  );
  const plannedIncomeAverage = totals.plannedIncome / 12;
  const actualIncomeAverage = totals.actualIncome / 12;
  const actualExpenseAverage = actualExpenseMonthCount > 0
    ? totals.actualExpense / actualExpenseMonthCount
    : 0;
  const plannedExpenseIncidence = totals.plannedIncome > 0
    ? totals.plannedExpense / totals.plannedIncome * 100
    : 0;
  const actualExpenseIncidence = totals.actualIncome > 0
    ? totals.actualExpense / totals.actualIncome * 100
    : 0;

  const scheduledIncome = useMemo(() => generateIncomeSchedule(incomeSources, selectedYear).map(entry => {
    const source = incomeSources.find(item => item.id === entry.incomeSourceId);
    const transaction = transactions.find(item => (
      item.type === 'income'
      && item.income_source_id === entry.incomeSourceId
      && item.transaction_date === entry.date
      && (item.income_occurrence_kind || 'regular') === entry.kind
      && item.status !== 'deleted'
      && item.status !== 'rejected'
    )) || null;
    const beneficiary = members.find(member => member.userId === source?.beneficiary_user_id);
    return {
      ...entry,
      beneficiary_user_id: source?.beneficiary_user_id || '',
      account_id: source?.account_id || null,
      beneficiaryName: beneficiary?.displayName || 'Componente',
      transaction,
    } satisfies ScheduledIncomeWithStatus;
  }), [incomeSources, members, selectedYear, transactions]);

  const sourcePlannedByMonth = useMemo(() => {
    const totalsByMonth: Record<number, number> = {};
    scheduledIncome.forEach(entry => {
      totalsByMonth[entry.month] = (totalsByMonth[entry.month] || 0) + entry.amount;
    });
    return totalsByMonth;
  }, [scheduledIncome]);

  const sourceCoverageByMonth = useMemo(() => {
    const covered: Record<number, boolean> = {};
    for (let month = 1; month <= 12; month += 1) {
      const start = `${selectedYear}-${String(month).padStart(2, '0')}-01`;
      const end = `${selectedYear}-${String(month).padStart(2, '0')}-${String(new Date(selectedYear, month, 0).getDate()).padStart(2, '0')}`;
      covered[month] = incomeSources.some(source => source.effective_from <= end && (!source.effective_to || source.effective_to >= start));
    }
    return covered;
  }, [incomeSources, selectedYear]);

  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = new Date().getMonth() + 1;
  const currentMonthPlanned = sourceCoverageByMonth[currentMonth]
    ? sourcePlannedByMonth[currentMonth] || 0
    : (selectedYear === currentYear ? incomeTargets[currentMonth]?.planned_income || 0 : 0);
  // This card must show only confirmed credits. `actualIncome` in the annual
  // forecast intentionally falls back to the planned amount when no income
  // has been recorded, which would be misleading for the “Ricevute” label.
  const currentMonthReceived = selectedYear === currentYear
    ? transactions
      .filter(transaction => (
        transaction.type === 'income'
        && transaction.transaction_date.startsWith(`${currentYear}-${String(currentMonth).padStart(2, '0')}-`)
      ))
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0)
    : 0;
  const currentMonthMemberIncomes = useMemo(() => members.map(member => {
    const planned = selectedYear === currentYear
      ? scheduledIncome.filter(entry => entry.month === currentMonth && entry.beneficiary_user_id === member.userId).reduce((sum, entry) => sum + entry.amount, 0)
      : 0;
    const actual = selectedYear === currentYear
      ? transactions.filter(transaction => (
        transaction.type === 'income'
        && transaction.transaction_date.startsWith(`${currentYear}-${String(currentMonth).padStart(2, '0')}-`)
        && transaction.income_beneficiary_user_id === member.userId
      )).reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0)
      : 0;
    return { userId: member.userId, name: member.displayName, planned, actual };
  }).filter(member => member.planned > 0 || member.actual > 0), [currentMonth, currentYear, members, scheduledIncome, selectedYear, transactions]);

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
      const date = new Date(`${tx.transaction_date}T00:00:00`);
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
      const date = new Date(`${tx.transaction_date}T00:00:00`);
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
      const date = new Date(`${transaction.transaction_date}T00:00:00`);
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

  const categoryHistogramRows = useMemo(
    () => [...annualCategoryRows]
      .filter(row => row.actualTotal > 0)
      .sort((a, b) => b.actualTotal - a.actualTotal),
    [annualCategoryRows],
  );
  const categoryHistogramTotal = useMemo(
    () => categoryHistogramRows.reduce((sum, row) => sum + row.actualTotal, 0),
    [categoryHistogramRows],
  );

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

  const blankIncomeSourceDraft = (beneficiaryId = user?.id || ''): IncomeSourceDraft => ({
    name: '', beneficiary_user_id: beneficiaryId, account_id: '', amount: '', payday: '1',
    cadence: 'monthly', effective_from: new Date().toISOString().slice(0, 8) + '01',
    thirteenth_amount: '', thirteenth_month: '', fourteenth_amount: '', fourteenth_month: '',
  });

  const openIncomeSourceForm = (source?: IncomeSourceRow) => {
    setEditingIncomeSource(source || null);
    if (!source) setIncomeSourceDraft(blankIncomeSourceDraft());
    else {
      const effectiveFrom = new Date();
      effectiveFrom.setDate(1);
      effectiveFrom.setMonth(effectiveFrom.getMonth() + 1);
      setIncomeSourceDraft({
        name: source.name,
        beneficiary_user_id: source.beneficiary_user_id,
        account_id: source.account_id || '',
        amount: String(source.amount),
        payday: String(source.payday),
        cadence: source.cadence,
        effective_from: effectiveFrom.toISOString().slice(0, 10),
        thirteenth_amount: source.thirteenth_amount ? String(source.thirteenth_amount) : '',
        thirteenth_month: source.thirteenth_month ? String(source.thirteenth_month) : '',
        fourteenth_amount: source.fourteenth_amount ? String(source.fourteenth_amount) : '',
        fourteenth_month: source.fourteenth_month ? String(source.fourteenth_month) : '',
      });
    }
    setIncomePanelOpen(true);
    setIncomeFormOpen(true);
  };

  const saveIncomeSource = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!householdId || !user?.id || !incomeSourceDraft) return;
    const amount = Number(incomeSourceDraft.amount.replace(',', '.'));
    const thirteenthAmount = Number(incomeSourceDraft.thirteenth_amount.replace(',', '.') || 0);
    const fourteenthAmount = Number(incomeSourceDraft.fourteenth_amount.replace(',', '.') || 0);
    const payday = Number(incomeSourceDraft.payday);
    if (!incomeSourceDraft.name.trim() || !incomeSourceDraft.beneficiary_user_id || !Number.isFinite(amount) || amount <= 0 || payday < 1 || payday > 31) {
      setError('Inserisci nome, beneficiario, importo mensile e giorno di accredito.');
      return;
    }
    if ((thirteenthAmount > 0 && !incomeSourceDraft.thirteenth_month) || (fourteenthAmount > 0 && !incomeSourceDraft.fourteenth_month)) {
      setError('Per tredicesima e quattordicesima indica anche il mese di accredito.');
      return;
    }
    if (!members.some(member => member.userId === incomeSourceDraft.beneficiary_user_id)) {
      setError('Il beneficiario deve appartenere al nucleo.');
      return;
    }
    setSavingIncome(true);
    setError(null);
    setMessage(null);
    try {
      const values = {
        household_id: householdId,
        name: incomeSourceDraft.name.trim(),
        beneficiary_user_id: incomeSourceDraft.beneficiary_user_id,
        account_id: incomeSourceDraft.account_id || null,
        amount,
        payday,
        cadence: incomeSourceDraft.cadence,
        effective_from: incomeSourceDraft.effective_from,
        effective_to: null,
        thirteenth_amount: thirteenthAmount,
        thirteenth_month: thirteenthAmount > 0 ? Number(incomeSourceDraft.thirteenth_month) : null,
        fourteenth_amount: fourteenthAmount,
        fourteenth_month: fourteenthAmount > 0 ? Number(incomeSourceDraft.fourteenth_month) : null,
        created_by: user.id,
      };

      if (editingIncomeSource) {
        const previousDay = new Date(`${incomeSourceDraft.effective_from}T00:00:00`);
        previousDay.setDate(previousDay.getDate() - 1);
        const { data: inserted, error: insertError } = await supabase.from('income_sources').insert(values).select('id').single();
        if (insertError) throw insertError;
        const { error: closeError } = await supabase.from('income_sources')
          .update({ effective_to: previousDay.toISOString().slice(0, 10), updated_at: new Date().toISOString() })
          .eq('id', editingIncomeSource.id).eq('household_id', householdId);
        if (closeError) {
          if (inserted?.id) await supabase.from('income_sources').delete().eq('id', inserted.id).eq('household_id', householdId);
          throw closeError;
        }
      } else {
        const { error: insertError } = await supabase.from('income_sources').insert(values);
        if (insertError) throw insertError;
      }
      setIncomeFormOpen(false);
      setEditingIncomeSource(null);
      setIncomeSourceDraft(null);
      setMessage('Fonte salvata. La modifica vale dalla data scelta e non riscrive gli accrediti passati.');
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile salvare la fonte di entrata.');
    } finally {
      setSavingIncome(false);
    }
  };

  const stopIncomeSource = async (source: IncomeSourceRow) => {
    if (!householdId) return;
    setSavingIncome(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.from('income_sources')
        .update({ effective_to: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() })
        .eq('id', source.id).eq('household_id', householdId).is('effective_to', null);
      if (updateError) throw updateError;
      setMessage(`La fonte “${source.name}” è stata terminata; le transazioni già registrate restano invariate.`);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile terminare la fonte.');
    } finally {
      setSavingIncome(false);
    }
  };

  const confirmScheduledIncome = async (entry: ScheduledIncomeWithStatus) => {
    if (!householdId || !user?.id || savingOccurrence) return;
    const actualAmount = Number((incomeActualDrafts[entry.key] ?? String(entry.amount)).replace(',', '.'));
    if (!Number.isFinite(actualAmount) || actualAmount <= 0) {
      setError('Inserisci l’importo effettivamente ricevuto.');
      return;
    }
    setSavingOccurrence(entry.key);
    setError(null);
    setMessage(null);
    try {
      const extraLabel = entry.kind === 'thirteenth' ? ' (tredicesima)' : entry.kind === 'fourteenth' ? ' (quattordicesima)' : '';
      const { error: insertError } = await supabase.from('transactions').insert({
        household_id: householdId,
        account_id: entry.account_id,
        type: 'income',
        status: 'confirmed',
        source: 'recurring_rule',
        transaction_date: entry.date,
        description: `${entry.name}${extraLabel}`,
        merchant: null,
        amount: actualAmount,
        category_id: null,
        subcategory_id: null,
        is_shared: true,
        inserted_by: user.id,
        income_source_id: entry.incomeSourceId,
        income_beneficiary_user_id: entry.beneficiary_user_id,
        income_occurrence_kind: entry.kind,
      });
      if (insertError) throw insertError;
      setMessage(`Accredito di ${entry.beneficiaryName} confermato e aggiunto alle entrate effettive.`);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile confermare l’accredito.');
    } finally {
      setSavingOccurrence(null);
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
          <div className={styles.kpiTrend}>Media mensile: {currency(totals.plannedIncome / 12, currencyCode)}</div>
        </Card>
        <Card>
          <div className={styles.kpiLabel}>Uscite previste anno</div>
          <p className={styles.kpiValue}>{currency(totals.plannedExpense, currencyCode)}</p>
          <div className={styles.kpiTrend}>Media mensile: {currency(totals.plannedExpense / 12, currencyCode)}</div>
          <div className={styles.kpiTrend}>Incidenza sull'entrata media: {plannedExpenseIncidence.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%</div>
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
          <div className={styles.kpiTrend}>
            Media su {actualExpenseMonthCount || 0} mesi: {currency(actualExpenseAverage, currencyCode)}
          </div>
          <div className={styles.kpiTrend}>Incidenza sulle entrate effettive: {actualExpenseIncidence.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%</div>
        </Card>
      </div>

      <Card title="Entrate del nucleo" icon={<TrendingUp size={20} />}>
        <div className={styles.incomeSummary}>
          <div><span>Previste questo mese</span><strong>{currency(currentMonthPlanned, currencyCode)}</strong></div>
          <div><span>Ricevute e confermate</span><strong>{currency(currentMonthReceived, currencyCode)}</strong></div>
          <div><span>Fonti configurate</span><strong>{incomeSources.filter(source => !source.effective_to).length}</strong></div>
          <button type="button" className={styles.incomeManageButton} onClick={() => setIncomePanelOpen(open => !open)}>
            {incomePanelOpen ? 'Chiudi gestione' : 'Gestisci entrate'}
          </button>
        </div>
        {currentMonthMemberIncomes.length > 0 && (
          <div className={styles.incomeMemberSummary} aria-label="Entrate per componente questo mese">
            {currentMonthMemberIncomes.map(member => (
              <div key={member.userId}>
                <strong>{member.name}</strong>
                <span>Previste {currency(member.planned, currencyCode)} · Ricevute {currency(member.actual, currencyCode)}</span>
              </div>
            ))}
          </div>
        )}
        {incomePanelOpen && (
          <div className={styles.incomePanel}>
            <p className="text-muted fs-sm">
              Le entrate programmate sono previsioni: diventano effettive solo quando confermi l’accredito.
              Importi, beneficiari e date già registrate restano nello storico.
            </p>
            {currentMembership && currentMembership.role !== 'viewer' && (
              <button type="button" className={styles.incomeAddButton} onClick={() => openIncomeSourceForm()}>
                <Plus size={16} /> Aggiungi fonte
              </button>
            )}
            {incomeSources.length === 0 ? (
              <div className={styles.empty}>Nessuna entrata ricorrente configurata. La previsione manuale annuale continua a funzionare.</div>
            ) : (
              <div className={styles.incomeSources}>
                {incomeSources.map(source => {
                  const beneficiary = members.find(member => member.userId === source.beneficiary_user_id);
                  const account = accounts.find(item => item.id === source.account_id);
                  return (
                    <article key={source.id} className={styles.incomeSource}>
                      <div className={styles.incomeSourceInfo}>
                        <strong>{source.name}</strong>
                        <span>{beneficiary?.displayName || 'Componente'} · {currency(source.amount, currencyCode)} · giorno {source.payday}</span>
                        <small>
                          {source.cadence === 'monthly' ? 'Ogni mese' : source.cadence === 'bimonthly' ? 'Ogni 2 mesi' : source.cadence === 'quarterly' ? 'Ogni 3 mesi' : source.cadence === 'semiannual' ? 'Ogni 6 mesi' : 'Ogni anno'}
                          {account ? ` · ${account.name}` : ''}
                          {source.thirteenth_amount > 0 ? ` · 13ª ${currency(source.thirteenth_amount, currencyCode)} a ${monthNames[(source.thirteenth_month || 1) - 1]}` : ''}
                          {source.fourteenth_amount > 0 ? ` · 14ª ${currency(source.fourteenth_amount, currencyCode)} a ${monthNames[(source.fourteenth_month || 1) - 1]}` : ''}
                          {source.effective_to ? ` · conclusa il ${new Date(`${source.effective_to}T00:00:00`).toLocaleDateString('it-IT')}` : ''}
                        </small>
                      </div>
                      {!source.effective_to && currentMembership && currentMembership.role !== 'viewer' && (
                        <div className={styles.incomeSourceActions}>
                          <button type="button" aria-label={`Modifica ${source.name} dal mese prossimo`} title="Modifica dal mese prossimo" onClick={() => openIncomeSourceForm(source)} disabled={savingIncome}><Pencil size={15} /></button>
                          <button type="button" aria-label={`Termina ${source.name}`} title="Termina fonte" onClick={() => void stopIncomeSource(source)} disabled={savingIncome}><X size={16} /></button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {incomeFormOpen && incomeSourceDraft && (
              <form className={styles.incomeForm} onSubmit={event => void saveIncomeSource(event)}>
                <div className={styles.incomeFormHeader}>
                  <strong>{editingIncomeSource ? `Nuova versione di ${editingIncomeSource.name}` : 'Nuova fonte di entrata'}</strong>
                  <button type="button" aria-label="Chiudi modulo" onClick={() => { setIncomeFormOpen(false); setEditingIncomeSource(null); }}><X size={17} /></button>
                </div>
                {editingIncomeSource && <p className="text-muted fs-sm">La versione modificata parte dal {new Date(`${incomeSourceDraft.effective_from}T00:00:00`).toLocaleDateString('it-IT')}; la regola precedente e gli accrediti passati restano conservati.</p>}
                <div className={styles.incomeFormGrid}>
                  <label>Nome fonte<input required value={incomeSourceDraft.name} onChange={event => setIncomeSourceDraft({ ...incomeSourceDraft, name: event.target.value })} placeholder="Es. Stipendio Giammario" /></label>
                  <label>Beneficiario<select required value={incomeSourceDraft.beneficiary_user_id} onChange={event => setIncomeSourceDraft({ ...incomeSourceDraft, beneficiary_user_id: event.target.value })}>
                    <option value="">Seleziona componente</option>{members.map(member => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
                  </select></label>
                  <label>Conto di accredito<select value={incomeSourceDraft.account_id} onChange={event => setIncomeSourceDraft({ ...incomeSourceDraft, account_id: event.target.value })}>
                    <option value="">Non specificato</option>{accounts.filter(account => account.is_active).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select></label>
                  <label>Importo ordinario (€)<input type="number" min="0.01" step="0.01" required value={incomeSourceDraft.amount} onChange={event => setIncomeSourceDraft({ ...incomeSourceDraft, amount: event.target.value })} /></label>
                  <label>Giorno di accredito<input type="number" min="1" max="31" required value={incomeSourceDraft.payday} onChange={event => setIncomeSourceDraft({ ...incomeSourceDraft, payday: event.target.value })} /></label>
                  <label>Periodicità<select value={incomeSourceDraft.cadence} onChange={event => setIncomeSourceDraft({ ...incomeSourceDraft, cadence: event.target.value as IncomeCadence })}>
                    <option value="monthly">Mensile</option><option value="bimonthly">Ogni 2 mesi</option><option value="quarterly">Trimestrale</option><option value="semiannual">Semestrale</option><option value="yearly">Annuale</option>
                  </select></label>
                  {!editingIncomeSource && <label>Inizio previsione<input type="date" required value={incomeSourceDraft.effective_from} onChange={event => setIncomeSourceDraft({ ...incomeSourceDraft, effective_from: event.target.value })} /></label>}
                  <label>Tredicesima (€)<input type="number" min="0" step="0.01" value={incomeSourceDraft.thirteenth_amount} onChange={event => setIncomeSourceDraft({ ...incomeSourceDraft, thirteenth_amount: event.target.value })} placeholder="Facoltativa" /></label>
                  <label>Mese tredicesima<select value={incomeSourceDraft.thirteenth_month} onChange={event => setIncomeSourceDraft({ ...incomeSourceDraft, thirteenth_month: event.target.value })}>
                    <option value="">Non prevista</option>{monthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
                  </select></label>
                  <label>Quattordicesima (€)<input type="number" min="0" step="0.01" value={incomeSourceDraft.fourteenth_amount} onChange={event => setIncomeSourceDraft({ ...incomeSourceDraft, fourteenth_amount: event.target.value })} placeholder="Facoltativa" /></label>
                  <label>Mese quattordicesima<select value={incomeSourceDraft.fourteenth_month} onChange={event => setIncomeSourceDraft({ ...incomeSourceDraft, fourteenth_month: event.target.value })}>
                    <option value="">Non prevista</option>{monthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
                  </select></label>
                </div>
                <button type="submit" className={styles.incomeSaveButton} disabled={savingIncome}>{savingIncome ? 'Salvataggio…' : 'Salva fonte'}</button>
              </form>
            )}

            <div className={styles.incomeScheduleSection}>
              <h3>Previsioni e accrediti {selectedYear}</h3>
              {scheduledIncome.length === 0 ? <div className={styles.empty}>Nessun accredito previsto per l’anno selezionato.</div> : (
                <div className={styles.incomeScheduleList}>
                  {scheduledIncome.map(entry => {
                    const accountName = accounts.find(account => account.id === entry.account_id)?.name;
                    const due = entry.date <= today;
                    const kindLabel = entry.kind === 'thirteenth' ? 'Tredicesima' : entry.kind === 'fourteenth' ? 'Quattordicesima' : 'Ordinario';
                    return (
                      <article className={styles.incomeScheduleRow} key={entry.key}>
                        <div className={styles.incomeScheduleInfo}>
                          <strong>{entry.name} <small>{kindLabel}</small></strong>
                          <span>{entry.beneficiaryName} · {new Date(`${entry.date}T00:00:00`).toLocaleDateString('it-IT')}{accountName ? ` · ${accountName}` : ''}</span>
                        </div>
                        {entry.transaction ? (
                          <strong className={styles.incomeConfirmed}>Ricevuto {currency(entry.transaction.amount, currencyCode)}</strong>
                        ) : due && currentMembership && currentMembership.role !== 'viewer' ? (
                          <div className={styles.incomeConfirmControl}>
                            <input aria-label={`Importo effettivamente ricevuto per ${entry.name}`} type="number" min="0.01" step="0.01" value={incomeActualDrafts[entry.key] ?? String(entry.amount)} onChange={event => setIncomeActualDrafts(prev => ({ ...prev, [entry.key]: event.target.value }))} />
                            <button type="button" onClick={() => void confirmScheduledIncome(entry)} disabled={savingOccurrence === entry.key} title="Conferma accredito"><Check size={16} /> Conferma</button>
                          </div>
                        ) : <span className={styles.incomePending}>Previsto {currency(entry.amount, currencyCode)}</span>}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card title="Previsione annuale" icon={<Wallet size={20} />}>
        <p className="text-muted fs-sm">
          Le spese con carta restano nel mese dell'acquisto. Nel Delta reale incidono una sola volta,
          come Anticipo carta di credito nel mese dell'addebito successivo. Le entrate effettive usano
          l'accredito confermato quando presente, altrimenti mantengono la previsione del mese.
        </p>
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
                  <th>Anticipo carta di credito</th>
                  <th>Entrate effettive</th>
                  <th>Uscite effettive</th>
                  <th>Delta reale</th>
                </tr>
              </thead>
              <tbody>
                {annualRows.map(row => {
                  const plannedDelta = row.plannedIncome - row.plannedExpense;
                  const actualDelta = row.actualIncome - row.immediateExpense;

                  return (
                    <tr key={row.month}>
                      <td data-label="Mese">{row.label}</td>
                      <td data-label="Entrate previste">
                        {sourceCoverageByMonth[row.month] ? (
                          <span>{currency(row.plannedIncome, currencyCode)}<small className={styles.incomeSourceHint}>Da fonti configurate</small></span>
                        ) : (
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
                        )}
                      </td>
                      <td data-label="Uscite previste">{currency(row.plannedExpense, currencyCode)}</td>
                      <td data-label="Delta previsto" className={plannedDelta >= 0 ? styles.positive : styles.negative}>
                        {currency(plannedDelta, currencyCode)}
                      </td>
                      <td data-label="Anticipo carta di credito">
                        <div className={styles.creditCardAdvance}>
                          <span>{currency(row.creditCardAdvance, currencyCode)}</span>
                          {row.creditCardAdvanceDetails.length > 0 && (
                            <details className={styles.creditCardDetails}>
                              <summary>Dettagli ({row.creditCardAdvanceDetails.length})</summary>
                              <ul>
                                {row.creditCardAdvanceDetails.map((detail, index) => (
                                  <li key={`${detail.purchaseDate}-${detail.description}-${index}`}>
                                    <span>{detail.description}</span>
                                    <small>
                                      Acquisto {new Date(`${detail.purchaseDate}T00:00:00`).toLocaleDateString('it-IT')}
                                      {' · '}{currency(detail.amount, currencyCode)}
                                    </small>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      </td>
                      <td data-label="Entrate effettive">{currency(row.actualIncome, currencyCode)}</td>
                      <td data-label="Uscite effettive">{currency(row.actualExpense, currencyCode)}</td>
                      <td data-label="Delta reale" className={actualDelta >= 0 ? styles.positive : styles.negative}>
                        {currency(actualDelta, currencyCode)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className={styles.averageRow}>
                  <td>Media mensile</td>
                  <td>{currency(plannedIncomeAverage, currencyCode)}</td>
                  <td>{currency(totals.plannedExpense / 12, currencyCode)}</td>
                  <td className={totals.plannedDelta >= 0 ? styles.positive : styles.negative}>
                    {currency(totals.plannedDelta / 12, currencyCode)}
                  </td>
                  <td>{currency(totals.creditCardAdvance / 12, currencyCode)}</td>
                  <td>{currency(actualIncomeAverage, currencyCode)}</td>
                  <td>{currency(actualExpenseAverage, currencyCode)}</td>
                  <td className={totals.actualDelta >= 0 ? styles.positive : styles.negative}>
                    {currency(totals.actualDelta / 12, currencyCode)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Spese annuali per categoria ${selectedYear}`}>
        <p className="text-muted fs-sm">
          Consuntivo ordinato automaticamente dalla categoria con la spesa maggiore a quella con la spesa minore.
        </p>
        {categoryHistogramRows.length === 0 ? (
          <div className={styles.empty}>Nessuna spesa categorizzata per l'anno selezionato.</div>
        ) : (
          <div className={styles.categoryHistogram} role="list" aria-label={`Spese per categoria ${selectedYear}`}>
            {categoryHistogramRows.map(row => {
              const maxValue = categoryHistogramRows[0]?.actualTotal || 1;
              const width = Math.max(2, (row.actualTotal / maxValue) * 100);
              const percentage = categoryHistogramTotal > 0
                ? (row.actualTotal / categoryHistogramTotal) * 100
                : 0;
              return (
                <div key={row.id} className={styles.histogramRow} role="listitem">
                  <div className={styles.histogramHeader}>
                    <span>{row.name}</span>
                    <strong>
                      {currency(row.actualTotal, currencyCode)}
                      <small>{formatPercentage(percentage, 1)}</small>
                    </strong>
                  </div>
                  <div className={styles.histogramTrack} aria-hidden="true">
                    <div className={styles.histogramBar} style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
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
                  {row.months.map(month => {
                    const isOverBudget = month.actual > month.planned;
                    return (
                      <div
                        key={month.month}
                        className={`${styles.categoryMonthCell} ${isOverBudget ? styles.categoryMonthOverBudget : ''}`}
                        aria-label={`${monthNames[month.month - 1]}: previsto ${currency(month.planned, currencyCode)}, consuntivo ${currency(month.actual, currencyCode)}${isOverBudget ? ', budget superato' : ''}`}
                      >
                        <span className={styles.categoryMonthName}>{monthNames[month.month - 1]}</span>
                        <span className={styles.plannedValue}>Prev. {currency(month.planned, currencyCode)}</span>
                        <span className={styles.actualValue}>Cons. {currency(month.actual, currencyCode)}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
