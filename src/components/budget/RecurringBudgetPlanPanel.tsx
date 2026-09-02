import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../ui/Button';
import {
  applyRecurringBudgetPlanNow,
  calculateMonthlyBudgetAllocations,
  fetchRecurringBudgetPlans,
  saveRecurringBudgetPlan,
  setRecurringBudgetPlanActive,
  type RecurringBudgetPlanWithItems,
} from '../../lib/recurringBudgetPlans';
import { formatCurrency } from '../../lib/money';
import type { Category, Subcategory } from '../../types/database';
import styles from './RecurringBudgetPlanPanel.module.css';

type Props = {
  householdId: string;
  userId: string | null;
  categories: Category[];
  subcategories: Subcategory[];
  currency: string;
  year: number;
  month: number;
  monthLabel: string;
  onApplied: () => Promise<void>;
};

export const RecurringBudgetPlanPanel: React.FC<Props> = ({
  householdId,
  userId,
  categories,
  subcategories,
  currency,
  year,
  month,
  monthLabel,
  onApplied,
}) => {
  const eligibleCategories = useMemo(() => categories
    .filter(category => category.type === 'expense' && subcategories.some(item => item.category_id === category.id))
    .sort((left, right) => left.name.localeCompare(right.name)), [categories, subcategories]);
  const alimentari = eligibleCategories.find(category => category.name.toLocaleLowerCase('it-IT') === 'alimentari');
  const [expanded, setExpanded] = useState(false);
  const [plans, setPlans] = useState<RecurringBudgetPlanWithItems[]>([]);
  const [categoryId, setCategoryId] = useState(alimentari?.id || eligibleCategories[0]?.id || '');
  const [weeksPerMonth, setWeeksPerMonth] = useState('4.75');
  const [monthlyTarget, setMonthlyTarget] = useState('');
  const [weeklyAmounts, setWeeklyAmounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveCategoryId = categoryId || alimentari?.id || eligibleCategories[0]?.id || '';
  const selectedCategory = eligibleCategories.find(category => category.id === effectiveCategoryId) || null;
  const selectedSubcategories = useMemo(() => subcategories
    .filter(item => item.category_id === effectiveCategoryId)
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name)), [effectiveCategoryId, subcategories]);
  const selectedPlan = plans.find(plan => plan.category_id === effectiveCategoryId) || null;
  const weeks = Number(weeksPerMonth.replace(',', '.')) || 4.75;
  const target = monthlyTarget.trim() ? Number(monthlyTarget.replace(',', '.')) : null;
  const allocations = useMemo(() => calculateMonthlyBudgetAllocations(
    selectedSubcategories.map(subcategory => ({
      subcategoryId: subcategory.id,
      weeklyAmount: Number((weeklyAmounts[subcategory.id] || '').replace(',', '.')) || 0,
    })),
    weeks,
    target,
  ), [selectedSubcategories, target, weeklyAmounts, weeks]);
  const monthlyTotal = allocations.reduce((sum, item) => sum + item.monthlyAmount, 0);

  const hydrateDraft = useCallback((plan: RecurringBudgetPlanWithItems | null) => {
    if (!plan) {
      setWeeksPerMonth('4.75');
      setMonthlyTarget('');
      setWeeklyAmounts({});
      return;
    }
    setWeeksPerMonth(String(plan.weeks_per_month));
    setMonthlyTarget(plan.monthly_target === null ? '' : String(plan.monthly_target));
    setWeeklyAmounts(plan.items.reduce<Record<string, string>>((result, item) => {
      result[item.subcategory_id] = String(item.weekly_amount);
      return result;
    }, {}));
  }, []);

  const loadPlans = useCallback(async (initializeDraft = false) => {
    try {
      const nextPlans = await fetchRecurringBudgetPlans(householdId);
      setPlans(nextPlans);
      if (initializeDraft) {
        const initialCategoryId = effectiveCategoryId;
        setCategoryId(initialCategoryId);
        hydrateDraft(nextPlans.find(plan => plan.category_id === initialCategoryId) || null);
      }
    } catch (loadError) {
      const text = loadError instanceof Error ? loadError.message : '';
      if (!text.toLowerCase().includes('recurring_budget_plans')) {
        setError(text || 'Non riesco a caricare i piani ricorrenti.');
      }
    }
  }, [effectiveCategoryId, householdId, hydrateDraft]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPlans(true), 0);
    return () => window.clearTimeout(timer);
  }, [loadPlans]);

  const handleCategoryChange = (nextCategoryId: string) => {
    setCategoryId(nextCategoryId);
    hydrateDraft(plans.find(plan => plan.category_id === nextCategoryId) || null);
    setMessage(null);
    setError(null);
  };

  const handleSave = async () => {
    if (!selectedCategory || allocations.every(item => item.weeklyAmount <= 0)) {
      setError('Inserisci almeno una media settimanale maggiore di zero.');
      return;
    }
    if (target !== null && (!Number.isFinite(target) || target < 0)) {
      setError('Controlla il totale mensile desiderato.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const plan = await saveRecurringBudgetPlan({
        householdId,
        categoryId: selectedCategory.id,
        name: `Piano ${selectedCategory.name}`,
        weeksPerMonth: weeks,
        monthlyTarget: target === null ? monthlyTotal : target,
        items: allocations,
        userId,
      });
      await applyRecurringBudgetPlanNow(householdId, plan.id, year, month);
      await loadPlans();
      await onApplied();
      setMessage(`Piano salvato e applicato a ${monthLabel}. Sara proposto automaticamente nei nuovi mesi.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Non riesco a salvare il piano.');
    } finally {
      setSaving(false);
    }
  };

  const handleActiveChange = async () => {
    if (!selectedPlan) return;
    setSaving(true);
    setError(null);
    try {
      await setRecurringBudgetPlanActive(householdId, selectedPlan.id, !selectedPlan.is_active);
      await loadPlans();
      setMessage(selectedPlan.is_active
        ? 'Compilazione automatica sospesa. I budget gia salvati restano invariati.'
        : 'Compilazione automatica riattivata per i nuovi mesi.');
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Non riesco ad aggiornare il piano.');
    } finally {
      setSaving(false);
    }
  };

  if (eligibleCategories.length === 0) return null;

  return (
    <section className={styles.panel}>
      <button type="button" className={styles.header} onClick={() => setExpanded(current => !current)} aria-expanded={expanded}>
        <CalendarRange size={22} />
        <span>
          <strong>Piano settimanale facoltativo</strong>
          <small>Trasforma medie settimanali in budget mensili, soltanto per questo nucleo.</small>
        </span>
        {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </button>

      {expanded && (
        <div className={styles.content}>
          <p className={styles.explanation}>
            I nuovi mesi ricevono questi valori come proposta iniziale. Un mese corretto manualmente non viene sovrascritto.
          </p>
          <div className={styles.controls}>
            <label>Categoria
              <select value={effectiveCategoryId} onChange={event => handleCategoryChange(event.target.value)}>
                {eligibleCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label>Settimane medie al mese
              <input type="number" min="1" max="6" step="0.01" value={weeksPerMonth} onChange={event => setWeeksPerMonth(event.target.value)} />
            </label>
            <label>Totale mensile desiderato
              <input type="number" min="0" step="0.01" value={monthlyTarget} onChange={event => setMonthlyTarget(event.target.value)} placeholder="calcolato automaticamente" />
            </label>
          </div>

          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Sottocategoria</th><th>Media settimanale</th><th>Budget mensile</th></tr></thead>
              <tbody>
                {selectedSubcategories.map(subcategory => {
                  const allocation = allocations.find(item => item.subcategoryId === subcategory.id);
                  return (
                    <tr key={subcategory.id}>
                      <td>{subcategory.name}</td>
                      <td><input type="number" min="0" step="0.01" value={weeklyAmounts[subcategory.id] || ''} onChange={event => setWeeklyAmounts(current => ({ ...current, [subcategory.id]: event.target.value }))} placeholder="0" /> €</td>
                      <td>{formatCurrency(allocation?.monthlyAmount || 0, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><th>Totale</th><th></th><th>{formatCurrency(monthlyTotal, currency)}</th></tr></tfoot>
            </table>
          </div>
          <p className={styles.roundingNote}>Se indichi un totale mensile, Contotron ripartisce automaticamente anche i centesimi di arrotondamento per raggiungerlo esattamente.</p>
          {message && <p className={styles.success}>{message}</p>}
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <Button type="button" onClick={handleSave} disabled={saving}>{saving ? 'Salvataggio...' : `Salva e applica a ${monthLabel}`}</Button>
            {selectedPlan && <Button type="button" variant="secondary" onClick={handleActiveChange} disabled={saving}>{selectedPlan.is_active ? 'Sospendi automatismo' : 'Riattiva automatismo'}</Button>}
          </div>
        </div>
      )}
    </section>
  );
};
