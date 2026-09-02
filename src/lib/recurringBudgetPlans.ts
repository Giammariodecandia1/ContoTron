import { supabase } from './supabaseClient';
import { roundMoney } from './money';
import type { RecurringBudgetPlan, RecurringBudgetPlanItem } from '../types/database';

const AUTO_PLAN_NOTE_PREFIX = 'AUTO_PIANO_BUDGET:';

export type WeeklyBudgetInput = {
  subcategoryId: string;
  weeklyAmount: number;
};

export type MonthlyBudgetAllocation = WeeklyBudgetInput & {
  monthlyAmount: number;
};

export type RecurringBudgetPlanWithItems = RecurringBudgetPlan & {
  items: RecurringBudgetPlanItem[];
};

const validAmount = (value: number) => Number.isFinite(value) && value >= 0 ? value : 0;

export const calculateMonthlyBudgetAllocations = (
  inputs: WeeklyBudgetInput[],
  weeksPerMonth: number,
  monthlyTarget: number | null,
): MonthlyBudgetAllocation[] => {
  const weeks = Number.isFinite(weeksPerMonth) && weeksPerMonth > 0 ? weeksPerMonth : 4.75;
  const raw = inputs.map(input => ({
    ...input,
    rawMonthly: validAmount(input.weeklyAmount) * weeks,
  }));
  const rawTotal = raw.reduce((sum, item) => sum + item.rawMonthly, 0);
  const requestedTarget = monthlyTarget !== null && Number.isFinite(monthlyTarget) && monthlyTarget >= 0
    ? roundMoney(monthlyTarget)
    : roundMoney(rawTotal);
  const scale = rawTotal > 0 ? requestedTarget / rawTotal : 0;
  const allocations = raw.map(item => ({
    subcategoryId: item.subcategoryId,
    weeklyAmount: roundMoney(validAmount(item.weeklyAmount)),
    monthlyAmount: roundMoney(item.rawMonthly * scale),
    remainder: item.rawMonthly * scale - roundMoney(item.rawMonthly * scale),
  }));

  let remainingCents = Math.round((requestedTarget - allocations.reduce((sum, item) => sum + item.monthlyAmount, 0)) * 100);
  const distributionOrder = allocations
    .map((item, index) => ({ index, remainder: item.remainder }))
    .sort((left, right) => remainingCents >= 0
      ? right.remainder - left.remainder
      : left.remainder - right.remainder);
  let cursor = 0;
  while (remainingCents !== 0 && distributionOrder.length > 0) {
    const allocation = allocations[distributionOrder[cursor % distributionOrder.length].index];
    const direction = remainingCents > 0 ? 1 : -1;
    if (allocation.monthlyAmount + direction / 100 >= 0) {
      allocation.monthlyAmount = roundMoney(allocation.monthlyAmount + direction / 100);
      remainingCents -= direction;
    }
    cursor += 1;
  }

  return allocations.map(allocation => ({
    subcategoryId: allocation.subcategoryId,
    weeklyAmount: allocation.weeklyAmount,
    monthlyAmount: allocation.monthlyAmount,
  }));
};

export const fetchRecurringBudgetPlans = async (householdId: string): Promise<RecurringBudgetPlanWithItems[]> => {
  const { data: plans, error: planError } = await supabase
    .from('recurring_budget_plans')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at');
  if (planError) throw planError;

  const planRows = (plans || []) as RecurringBudgetPlan[];
  if (planRows.length === 0) return [];
  const { data: items, error: itemError } = await supabase
    .from('recurring_budget_plan_items')
    .select('*')
    .eq('household_id', householdId)
    .in('plan_id', planRows.map(plan => plan.id));
  if (itemError) throw itemError;
  const itemRows = (items || []) as RecurringBudgetPlanItem[];
  return planRows.map(plan => ({ ...plan, items: itemRows.filter(item => item.plan_id === plan.id) }));
};

export const saveRecurringBudgetPlan = async ({
  householdId,
  categoryId,
  name,
  weeksPerMonth,
  monthlyTarget,
  items,
  userId,
}: {
  householdId: string;
  categoryId: string;
  name: string;
  weeksPerMonth: number;
  monthlyTarget: number | null;
  items: MonthlyBudgetAllocation[];
  userId: string | null;
}) => {
  const { data: plan, error: planError } = await supabase
    .from('recurring_budget_plans')
    .upsert({
      household_id: householdId,
      category_id: categoryId,
      name,
      weeks_per_month: weeksPerMonth,
      monthly_target: monthlyTarget,
      is_active: true,
      created_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'household_id,category_id' })
    .select()
    .single();
  if (planError) throw planError;

  const activeItems = items.filter(item => item.weeklyAmount > 0 || item.monthlyAmount > 0);
  if (activeItems.length > 0) {
    const { error: itemError } = await supabase.from('recurring_budget_plan_items').upsert(activeItems.map(item => ({
      plan_id: plan.id,
      household_id: householdId,
      category_id: categoryId,
      subcategory_id: item.subcategoryId,
      weekly_amount: item.weeklyAmount,
      monthly_amount: item.monthlyAmount,
      updated_at: new Date().toISOString(),
    })), { onConflict: 'plan_id,subcategory_id' });
    if (itemError) throw itemError;
  }

  const activeSubcategoryIds = new Set(activeItems.map(item => item.subcategoryId));
  const { data: savedItems, error: savedItemsError } = await supabase
    .from('recurring_budget_plan_items')
    .select('id, subcategory_id')
    .eq('plan_id', plan.id)
    .eq('household_id', householdId);
  if (savedItemsError) throw savedItemsError;
  const obsoleteIds = (savedItems || [])
    .filter(item => !activeSubcategoryIds.has(item.subcategory_id))
    .map(item => item.id);
  if (obsoleteIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('recurring_budget_plan_items')
      .delete()
      .eq('plan_id', plan.id)
      .eq('household_id', householdId)
      .in('id', obsoleteIds);
    if (deleteError) throw deleteError;
  }
  return plan as RecurringBudgetPlan;
};

export const setRecurringBudgetPlanActive = async (householdId: string, planId: string, isActive: boolean) => {
  const { error } = await supabase
    .from('recurring_budget_plans')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', planId)
    .eq('household_id', householdId);
  if (error) throw error;
};

const applyPlanItems = async ({
  householdId,
  plan,
  items,
  year,
  month,
  overwriteManual,
}: {
  householdId: string;
  plan: RecurringBudgetPlan;
  items: RecurringBudgetPlanItem[];
  year: number;
  month: number;
  overwriteManual: boolean;
}) => {
  const { data: existingRows, error: existingError } = await supabase
    .from('budget_targets')
    .select('id, subcategory_id, notes, planned_amount')
    .eq('household_id', householdId)
    .eq('year', year)
    .eq('month', month)
    .eq('category_id', plan.category_id)
    .not('subcategory_id', 'is', null);
  if (existingError) throw existingError;

  const currentSubcategoryIds = new Set(items.map(item => item.subcategory_id));
  for (const existing of existingRows || []) {
    if (
      existing.notes === `${AUTO_PLAN_NOTE_PREFIX}${plan.id}`
      && !currentSubcategoryIds.has(existing.subcategory_id)
    ) {
      const { error } = await supabase
        .from('budget_targets')
        .delete()
        .eq('id', existing.id)
        .eq('household_id', householdId);
      if (error) throw error;
    }
  }

  for (const item of items) {
    const existing = (existingRows || []).find(row => row.subcategory_id === item.subcategory_id);
    const automaticForThisPlan = existing?.notes === `${AUTO_PLAN_NOTE_PREFIX}${plan.id}`;
    if (existing && !overwriteManual && !automaticForThisPlan) continue;
    const payload = {
      household_id: householdId,
      year,
      month,
      category_id: plan.category_id,
      subcategory_id: item.subcategory_id,
      planned_amount: Number(item.monthly_amount || 0),
      notes: `${AUTO_PLAN_NOTE_PREFIX}${plan.id}`,
      updated_at: new Date().toISOString(),
    };
    if (existing) {
      const { error } = await supabase.from('budget_targets').update(payload).eq('id', existing.id).eq('household_id', householdId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('budget_targets').insert(payload);
      if (error) throw error;
    }
  }
};

export const syncRecurringBudgetPlans = async (householdId: string, year: number, month: number) => {
  const plans = await fetchRecurringBudgetPlans(householdId);
  for (const plan of plans.filter(item => item.is_active)) {
    await applyPlanItems({ householdId, plan, items: plan.items, year, month, overwriteManual: false });
  }
  return plans;
};

export const applyRecurringBudgetPlanNow = async (
  householdId: string,
  planId: string,
  year: number,
  month: number,
) => {
  const plans = await fetchRecurringBudgetPlans(householdId);
  const plan = plans.find(item => item.id === planId);
  if (!plan) throw new Error('Piano budget non trovato.');
  await applyPlanItems({ householdId, plan, items: plan.items, year, month, overwriteManual: true });
};
