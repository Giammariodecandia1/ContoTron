import { supabase } from './supabaseClient';
import type { Account, RecurringRule, Transaction } from '../types/database';
import { getCashImpactDate } from './paymentTiming';

const AUTO_FIXED_BUDGET_NOTE = 'AUTO_SPESE_FISSE';

type RecurringSyncArgs = {
  householdId: string;
  accounts: Account[];
  year: number;
  month: number;
};

type RecurringSyncResult = {
  createdCount: number;
  rulesCount: number;
  rules: RecurringRule[];
};

type BudgetTargetRow = {
  id: string;
  category_id: string | null;
  subcategory_id: string | null;
  planned_amount: number;
  notes: string | null;
};

const recurringSyncInFlight = new Map<string, Promise<RecurringSyncResult>>();

const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

const lastDayOfMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

const frequencyMonthStep: Record<string, number> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  four_monthly: 4,
  semiannual: 6,
  yearly: 12,
};

const recurringMarker = (ruleId: string, year: number, month: number) => (
  `[RICORRENZA:${ruleId}:${monthKey(year, month)}]`
);

const dueDateForMonth = (startDate: string, year: number, month: number) => {
  const start = new Date(`${startDate}T00:00:00`);
  const day = Math.min(start.getDate(), lastDayOfMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export const recurringRuleDueDateForMonth = (rule: RecurringRule, year: number, month: number) => {
  if (!recurringRuleAppliesToMonth(rule, year, month)) return null;
  const step = frequencyMonthStep[rule.frequency];
  if (!step) return null;
  const [startYear, startMonth] = rule.start_date.split('-').map(Number);
  const monthDistance = (year - startYear) * 12 + (month - startMonth);
  if (monthDistance < 0 || monthDistance % step !== 0) return null;
  const dueDate = dueDateForMonth(rule.start_date, year, month);
  return rule.end_date && dueDate > rule.end_date ? null : dueDate;
};

const nextDueDateAfter = (rule: RecurringRule, dueDate: string) => {
  const step = frequencyMonthStep[rule.frequency];
  if (!step) return null;
  const [year, month] = dueDate.split('-').map(Number);
  const target = new Date(year, month - 1 + step, 1);
  const next = dueDateForMonth(rule.start_date, target.getFullYear(), target.getMonth() + 1);
  return rule.end_date && next > rule.end_date ? null : next;
};

export const recurringRuleAppliesToMonth = (rule: RecurringRule, year: number, month: number) => {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const start = new Date(`${rule.start_date}T00:00:00`);
  const end = rule.end_date ? new Date(`${rule.end_date}T00:00:00`) : null;

  return start <= monthEnd && (!end || end >= monthStart);
};

const budgetGroupKey = (categoryId: string, subcategoryId: string | null) => (
  `${categoryId}:${subcategoryId || 'category'}`
);

const syncFixedExpensesIntoBudget = async ({
  householdId,
  activeRules,
  year,
  month,
}: {
  householdId: string;
  activeRules: RecurringRule[];
  year: number;
  month: number;
}) => {
  const fixedByBudgetGroup = new Map<string, {
    categoryId: string;
    subcategoryId: string | null;
    amount: number;
  }>();

  activeRules.forEach(rule => {
    if (rule.type !== 'expense' || !rule.category_id) return;
    const subcategoryId = rule.subcategory_id || null;
    const key = budgetGroupKey(rule.category_id, subcategoryId);
    const existing = fixedByBudgetGroup.get(key);
    fixedByBudgetGroup.set(key, {
      categoryId: rule.category_id,
      subcategoryId,
      amount: (existing?.amount || 0) + Number(rule.amount || 0),
    });
  });

  const { data, error } = await supabase
    .from('budget_targets')
    .select('id, category_id, subcategory_id, planned_amount, notes')
    .eq('household_id', householdId)
    .eq('year', year)
    .eq('month', month);

  if (error) throw error;
  const existingTargets = (data || []) as BudgetTargetRow[];

  for (const target of existingTargets.filter(row => row.notes === AUTO_FIXED_BUDGET_NOTE)) {
    if (!target.category_id) continue;
    const key = budgetGroupKey(target.category_id, target.subcategory_id);
    if (fixedByBudgetGroup.has(key)) continue;

    const { error: deleteError } = await supabase
      .from('budget_targets')
      .delete()
      .eq('id', target.id)
      .eq('household_id', householdId);
    if (deleteError) throw deleteError;
  }

  for (const group of fixedByBudgetGroup.values()) {
    const existing = existingTargets.find(target => (
      target.category_id === group.categoryId
      && target.subcategory_id === group.subcategoryId
    ));

    if (!existing) {
      const { error: insertError } = await supabase
        .from('budget_targets')
        .insert([{
          household_id: householdId,
          year,
          month,
          category_id: group.categoryId,
          subcategory_id: group.subcategoryId,
          planned_amount: group.amount,
          notes: AUTO_FIXED_BUDGET_NOTE,
        }]);
      if (insertError) throw insertError;
      continue;
    }

    const existingAmount = Number(existing.planned_amount || 0);
    const nextAmount = existing.notes === AUTO_FIXED_BUDGET_NOTE
      ? group.amount
      : Math.max(existingAmount, group.amount);
    if (nextAmount === existingAmount) continue;

    const { error: updateError } = await supabase
      .from('budget_targets')
      .update({
        planned_amount: nextAmount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('household_id', householdId);
    if (updateError) throw updateError;
  }
};

const ensureMonthlyRecurringTransactionsInternal = async ({
  householdId,
  accounts,
  year,
  month,
}: RecurringSyncArgs): Promise<RecurringSyncResult> => {
  const { data: rules, error: rulesError } = await supabase
    .from('recurring_rules')
    .select('*')
    .eq('household_id', householdId)
    .eq('is_active', true);

  if (rulesError) throw rulesError;

  const activeRules = ((rules || []) as RecurringRule[])
    .filter(rule => recurringRuleDueDateForMonth(rule, year, month));

  const now = new Date();
  const requestedMonth = new Date(year, month - 1, 1);
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  await syncFixedExpensesIntoBudget({
    householdId,
    activeRules,
    year,
    month,
  });

  // Anche nei mesi futuri il budget deve mostrare le spese fisse. Soltanto le
  // transazioni contabili vengono create quando il mese e effettivamente iniziato.
  if (requestedMonth > currentMonth) {
    return { createdCount: 0, rulesCount: activeRules.length, rules: activeRules };
  }

  let createdCount = 0;

  for (const rule of activeRules) {
    const dueDate = recurringRuleDueDateForMonth(rule, year, month);
    if (!dueDate || dueDate > today) continue;
    const marker = recurringMarker(rule.id, year, month);
    const { data: existing, error: existingError } = await supabase
      .from('transactions')
      .select('id')
      .eq('household_id', householdId)
      .eq('source', 'recurring_rule')
      .or(`recurring_rule_id.eq.${rule.id},notes.ilike.%${marker}%`)
      .gte('transaction_date', `${monthKey(year, month)}-01`)
      .lte('transaction_date', `${monthKey(year, month)}-${String(lastDayOfMonth(year, month)).padStart(2, '0')}`)
      .limit(1);

    if (existingError) throw existingError;

    const accountId = rule.account_id || accounts[0]?.id || null;
    const transaction: Partial<Transaction> = {
      household_id: householdId,
      account_id: accountId,
      recurring_rule_id: rule.id,
      type: rule.type,
      status: 'confirmed',
      source: 'recurring_rule',
      payment_method: rule.payment_method || 'standard',
      cash_impact_date: getCashImpactDate(dueDate, rule.payment_method || 'standard'),
      frequency: rule.frequency as Transaction['frequency'],
      transaction_date: dueDate,
      description: rule.description,
      merchant: rule.merchant || null,
      amount: rule.amount,
      category_id: rule.category_id || null,
      subcategory_id: rule.subcategory_id || null,
      is_shared: rule.is_shared !== false,
      notes: `Generata automaticamente da spesa fissa. ${marker}${rule.notes ? ` ${rule.notes}` : ''}`,
    };

    if (existing && existing.length > 0) {
      const { household_id: _householdId, status: _status, source: _source, ...updates } = transaction;
      void _householdId;
      void _status;
      void _source;
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          ...updates,
          recurring_rule_id: rule.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing[0].id)
        .eq('household_id', householdId);
      if (updateError) throw updateError;
      const { error: existingDueUpdateError } = await supabase.from('recurring_rules').update({
        next_due_date: nextDueDateAfter(rule, dueDate),
        updated_at: new Date().toISOString(),
      }).eq('id', rule.id).eq('household_id', householdId);
      if (existingDueUpdateError) throw existingDueUpdateError;
      continue;
    }

    const { error: insertError } = await supabase
      .from('transactions')
      .insert([transaction]);

    if (insertError && insertError.code !== '23505') throw insertError;
    const { error: dueUpdateError } = await supabase.from('recurring_rules').update({
      next_due_date: nextDueDateAfter(rule, dueDate),
      updated_at: new Date().toISOString(),
    }).eq('id', rule.id).eq('household_id', householdId);
    if (dueUpdateError) throw dueUpdateError;
    if (!insertError) createdCount += 1;
  }

  return { createdCount, rulesCount: activeRules.length, rules: activeRules };
};

export const ensureMonthlyRecurringTransactions = (
  args: RecurringSyncArgs,
): Promise<RecurringSyncResult> => {
  const key = `${args.householdId}:${monthKey(args.year, args.month)}`;
  const existing = recurringSyncInFlight.get(key);
  if (existing) return existing;

  const request = ensureMonthlyRecurringTransactionsInternal(args)
    .finally(() => recurringSyncInFlight.delete(key));
  recurringSyncInFlight.set(key, request);
  return request;
};
