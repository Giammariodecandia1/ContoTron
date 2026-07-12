import { supabase } from './supabaseClient';
import type { Account, RecurringRule, Transaction } from '../types/database';

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

export const ensureMonthlyRecurringTransactions = async ({
  householdId,
  accounts,
  year,
  month,
}: {
  householdId: string;
  accounts: Account[];
  year: number;
  month: number;
}) => {
  const { data: rules, error: rulesError } = await supabase
    .from('recurring_rules')
    .select('*')
    .eq('household_id', householdId)
    .eq('is_active', true)
    .eq('frequency', 'monthly');

  if (rulesError) throw rulesError;

  const activeRules = ((rules || []) as RecurringRule[])
    .filter(rule => ruleAppliesToMonth(rule, year, month));

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
