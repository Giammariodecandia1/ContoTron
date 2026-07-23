import { supabase } from './supabaseClient';
import type { Account, RecurringRule, Transaction } from '../types/database';

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

const recurringMarker = (ruleId: string, year: number, month: number) => (
  `[RICORRENZA:${ruleId}:${monthKey(year, month)}]`
);

const dueDateForMonth = (startDate: string, year: number, month: number) => {
  const start = new Date(`${startDate}T00:00:00`);
  const day = Math.min(start.getDate(), lastDayOfMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const ruleAppliesToMonth = (rule: RecurringRule, year: number, month: number) => {
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
    const nextAmount = Math.max(existingAmount, group.amount);
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
    .eq('is_active', true)
    .eq('frequency', 'monthly');

  if (rulesError) throw rulesError;

  const activeRules = ((rules || []) as RecurringRule[])
    .filter(rule => ruleAppliesToMonth(rule, year, month));

  const now = new Date();
  const requestedMonth = new Date(year, month - 1, 1);
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (requestedMonth > currentMonth) {
    return { createdCount: 0, rulesCount: activeRules.length };
  }

  await syncFixedExpensesIntoBudget({
    householdId,
    activeRules,
    year,
    month,
  });

  let createdCount = 0;

  for (const rule of activeRules) {
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
    if (existing && existing.length > 0) continue;

    const accountId = rule.account_id || accounts[0]?.id || null;
    const transaction: Partial<Transaction> = {
      household_id: householdId,
      account_id: accountId,
      recurring_rule_id: rule.id,
      type: rule.type,
      status: 'confirmed',
      source: 'recurring_rule',
      payment_method: 'standard',
      cash_impact_date: dueDateForMonth(rule.start_date, year, month),
      frequency: 'monthly',
      transaction_date: dueDateForMonth(rule.start_date, year, month),
      description: rule.description,
      merchant: rule.merchant || null,
      amount: rule.amount,
      category_id: rule.category_id || null,
      subcategory_id: rule.subcategory_id || null,
      is_shared: true,
      notes: `Generata automaticamente da spesa fissa. ${marker}${rule.notes ? ` ${rule.notes}` : ''}`,
    };

    const { error: insertError } = await supabase
      .from('transactions')
      .insert([transaction]);

    if (insertError) throw insertError;
    createdCount += 1;
  }

  return { createdCount, rulesCount: activeRules.length };
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
