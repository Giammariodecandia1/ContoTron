import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../components/ui/Card';
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useHousehold, useTransactions } from '../hooks';
import { useBudget } from '../hooks/useBudget';
import { ensureMonthlyRecurringTransactions } from '../lib/recurringTransactions';
import { supabase } from '../lib/supabaseClient';
import type { Transaction } from '../types/database';
import styles from './MonthlyBudgetPage.module.css';

type BudgetTransactionItem = {
  transaction_id: string;
  amount: number;
  category_id: string | null;
  subcategory_id: string | null;
};

export const MonthlyBudgetPage: React.FC = () => {
  const { household, accounts, categories, subcategories } = useHousehold();
  const { fetchTransactions } = useTransactions();
  const { fetchBudgetTargets, upsertBudgetTarget, loading: budgetLoading } = useBudget();

  const today = new Date();
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionItems, setTransactionItems] = useState<BudgetTransactionItem[]>([]);
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({});
  const [subcategoryBudgets, setSubcategoryBudgets] = useState<Record<string, number>>({});
  const [categoryTotalDrafts, setCategoryTotalDrafts] = useState<Record<string, string>>({});
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [recurringMessage, setRecurringMessage] = useState<string | null>(null);
  const [recurringError, setRecurringError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null);
  const loadRequestRef = useRef(0);
  const householdId = household?.id || null;

  const year = selectedYear;
  const month = selectedMonth;

  const monthNames = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

  const loadData = useCallback(async () => {
    if (!householdId) {
      setLoading(false);
      return;
    }

    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;

    setLoading(true);
    setRecurringMessage(null);
    setRecurringError(null);
    setLoadError(null);
    setPrefillNotice(null);

    try {
      const result = await ensureMonthlyRecurringTransactions({
        householdId,
        accounts,
        year,
        month,
      });

      if (result.createdCount > 0) {
        setRecurringMessage(`${result.createdCount} spese fisse generate automaticamente per questo mese.`);
      }
    } catch (error) {
      console.error('Errore generazione spese fisse:', error);
      setRecurringError(error instanceof Error ? error.message : 'Non riesco a generare le spese fisse del mese.');
    }

    // 1. Fetch transactions for the current month
    try {
      const txs = await fetchTransactions(month, year);
      if (loadRequestRef.current !== requestId) return;
      const validTransactions = txs.filter(t => (
        t.type === 'expense'
        && t.status !== 'deleted'
        && t.status !== 'rejected'
      ));
      setTransactions(validTransactions);

      const transactionIds = validTransactions.map(transaction => transaction.id);
      if (transactionIds.length > 0) {
        const { data: itemData, error: itemError } = await supabase
          .from('transaction_items')
          .select('transaction_id, amount, category_id, subcategory_id')
          .eq('household_id', householdId)
          .in('transaction_id', transactionIds);
        if (itemError) throw itemError;
        if (loadRequestRef.current !== requestId) return;
        setTransactionItems((itemData || []) as BudgetTransactionItem[]);
      } else {
        setTransactionItems([]);
      }

      // 2. Fetch or auto-prefill budget targets
      const targets = await fetchBudgetTargets(year, month);
      if (loadRequestRef.current !== requestId) return;
      
      const categoryBudgetMap: Record<string, number> = {};
      const subcategoryBudgetMap: Record<string, number> = {};
      targets.forEach(t => {
        if (!t.category_id) return;
        if (t.subcategory_id) subcategoryBudgetMap[t.subcategory_id] = Number(t.planned_amount || 0);
        else categoryBudgetMap[t.category_id] = Number(t.planned_amount || 0);
      });
      setCategoryBudgets(categoryBudgetMap);
      setSubcategoryBudgets(subcategoryBudgetMap);
      const categoryTotalDraftMap: Record<string, string> = {};
      categories.filter(category => category.type === 'expense').forEach(category => {
        const allocated = subcategories
          .filter(subcategory => subcategory.category_id === category.id)
          .reduce((sum, subcategory) => sum + (subcategoryBudgetMap[subcategory.id] || 0), 0);
        const total = (categoryBudgetMap[category.id] || 0) + allocated;
        categoryTotalDraftMap[category.id] = total > 0 ? String(total) : '';
      });
      setCategoryTotalDrafts(categoryTotalDraftMap);
      const hasCategoryTargets = targets.some(target => !!target.category_id);
      if (!hasCategoryTargets) {
        setPrefillNotice('Nessun budget previsto salvato per questo mese.');
      }
    } catch (error) {
      console.error('Errore caricamento budget mensile:', error);
      if (loadRequestRef.current === requestId) {
        setLoadError(error instanceof Error ? error.message : 'Errore durante il caricamento del mese selezionato.');
      }
    } finally {
      if (loadRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [accounts, categories, fetchBudgetTargets, fetchTransactions, householdId, month, subcategories, year]);

  useEffect(() => {
    if (!householdId) return;
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [householdId, loadData]);

  const handlePrevMonth = () => {
    if (month === 1) {
      setSelectedMonth(12);
      setSelectedYear(prev => prev - 1);
      return;
    }
    setSelectedMonth(prev => prev - 1);
  };

  const handleNextMonth = () => {
    if (month === 12) {
      setSelectedMonth(1);
      setSelectedYear(prev => prev + 1);
      return;
    }
    setSelectedMonth(prev => prev + 1);
  };

  const subcategoryPlannedTotal = (categoryId: string, budgets = subcategoryBudgets) => (
    subcategories
      .filter(subcategory => subcategory.category_id === categoryId)
      .reduce((sum, subcategory) => sum + (budgets[subcategory.id] || 0), 0)
  );

  const handleCategoryTotalChange = (categoryId: string, val: string) => {
    setCategoryTotalDrafts(prev => ({ ...prev, [categoryId]: val }));
    if (!val.trim()) return;
    const requestedTotal = parseFloat(val) || 0;
    const allocated = subcategoryPlannedTotal(categoryId);
    setCategoryBudgets(prev => ({
      ...prev,
      [categoryId]: Math.max(0, requestedTotal - allocated),
    }));
  };

  const handleCategoryTotalBlur = async (categoryId: string, val: string) => {
    const allocated = subcategoryPlannedTotal(categoryId);
    const parsedTotal = parseFloat(val);
    const requestedTotal = Number.isFinite(parsedTotal) ? parsedTotal : allocated;
    const finalTotal = Math.max(allocated, requestedTotal);
    const unallocatedAmount = finalTotal - allocated;
    setCategoryBudgets(prev => ({ ...prev, [categoryId]: unallocatedAmount }));
    setCategoryTotalDrafts(prev => ({ ...prev, [categoryId]: finalTotal > 0 ? String(finalTotal) : '' }));
    const saved = await upsertBudgetTarget(categoryId, unallocatedAmount, year, month);
    if (!saved) setLoadError('Non riesco a salvare il totale della categoria. Riprova.');
  };

  const handleSubcategoryBudgetChange = (categoryId: string, subcategoryId: string, val: string) => {
    const num = parseFloat(val) || 0;
    const previousAmount = subcategoryBudgets[subcategoryId] || 0;
    const delta = num - previousAmount;
    const nextSubcategoryBudgets = { ...subcategoryBudgets, [subcategoryId]: num };
    setSubcategoryBudgets(nextSubcategoryBudgets);
    if (delta !== 0) {
      const nextUnallocated = Math.max(0, (categoryBudgets[categoryId] || 0) - delta);
      const nextTotal = nextUnallocated + subcategoryPlannedTotal(categoryId, nextSubcategoryBudgets);
      setCategoryBudgets(prev => ({ ...prev, [categoryId]: nextUnallocated }));
      setCategoryTotalDrafts(prev => ({ ...prev, [categoryId]: nextTotal > 0 ? String(nextTotal) : '' }));
    }
  };

  const handleSubcategoryBudgetBlur = async (categoryId: string, subcategoryId: string) => {
    const amount = subcategoryBudgets[subcategoryId] || 0;
    const saved = await Promise.all([
      upsertBudgetTarget(categoryId, amount, year, month, subcategoryId),
      upsertBudgetTarget(categoryId, categoryBudgets[categoryId] || 0, year, month),
    ]);
    if (saved.some(result => !result)) setLoadError('Non riesco a salvare la ripartizione della categoria. Riprova.');
  };

  const toggleCategory = (categoryId: string) => {
    setExpandedCategoryIds(previous => {
      const next = new Set(previous);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  // Calculate actuals
  const actuals = useMemo(() => {
    const byCategory: Record<string, number> = {};
    const bySubcategory: Record<string, number> = {};
    const unallocatedByCategory: Record<string, number> = {};
    const transactionById = new Map(transactions.map(transaction => [transaction.id, transaction]));
    const itemsByTransaction = new Map<string, BudgetTransactionItem[]>();
    transactionItems.forEach(item => {
      if (!transactionById.has(item.transaction_id)) return;
      const group = itemsByTransaction.get(item.transaction_id) || [];
      group.push(item);
      itemsByTransaction.set(item.transaction_id, group);
    });

    const addAmount = (categoryId: string | null, subcategoryId: string | null, amount: number) => {
      const resolvedCategoryId = categoryId || 'uncategorized';
      byCategory[resolvedCategoryId] = (byCategory[resolvedCategoryId] || 0) + amount;
      if (subcategoryId) {
        bySubcategory[subcategoryId] = (bySubcategory[subcategoryId] || 0) + amount;
      } else {
        unallocatedByCategory[resolvedCategoryId] = (unallocatedByCategory[resolvedCategoryId] || 0) + amount;
      }
    };

    transactions.forEach(transaction => {
      const itemGroup = itemsByTransaction.get(transaction.id) || [];
      const itemTotal = itemGroup.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      if (itemTotal <= 0) {
        addAmount(transaction.category_id, transaction.subcategory_id, Number(transaction.amount || 0));
        return;
      }

      itemGroup.forEach(item => {
        const allocatedAmount = Number(item.amount || 0) * Number(transaction.amount || 0) / itemTotal;
        addAmount(item.category_id, item.subcategory_id, allocatedAmount);
      });
    });
    return { byCategory, bySubcategory, unallocatedByCategory };
  }, [transactionItems, transactions]);

  const expenseCategories = categories.filter(c => c.type === 'expense').sort((a, b) => a.name.localeCompare(b.name));

  const subcategoriesByCategory = useMemo(() => {
    const map = new Map<string, typeof subcategories>();
    subcategories.forEach(subcategory => {
      const group = map.get(subcategory.category_id) || [];
      group.push(subcategory);
      map.set(subcategory.category_id, group);
    });
    map.forEach(group => group.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
    return map;
  }, [subcategories]);

  const plannedForCategory = (categoryId: string) => (
    (categoryBudgets[categoryId] || 0)
    + (subcategoriesByCategory.get(categoryId) || []).reduce(
      (sum, subcategory) => sum + (subcategoryBudgets[subcategory.id] || 0),
      0,
    )
  );

  const totalPlanned = expenseCategories.reduce((acc, cat) => acc + plannedForCategory(cat.id), 0);
  const totalActual = transactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const totalDiff = totalPlanned - totalActual;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Budget Mensile</h1>
        <p className="text-muted">Confronta le tue spese previste con quelle effettive.</p>
      </header>

      <div className={styles.controls}>
        <div className={styles.monthSelector}>
          <button className={styles.monthBtn} onClick={handlePrevMonth} aria-label="Mese precedente"><ChevronLeft size={20} /></button>
          <div className={styles.monthDisplay}>{monthNames[month - 1]} {year}</div>
          <button className={styles.monthBtn} onClick={handleNextMonth} aria-label="Mese successivo"><ChevronRight size={20} /></button>
        </div>

        <div className={styles.directSelectors}>
          <select
            className={styles.select}
            value={month}
            onChange={event => setSelectedMonth(Number(event.target.value))}
            aria-label="Seleziona mese budget"
          >
            {monthNames.map((label, index) => (
              <option key={label} value={index + 1}>{label}</option>
            ))}
          </select>
          <select
            className={styles.select}
            value={year}
            onChange={event => setSelectedYear(Number(event.target.value))}
            aria-label="Seleziona anno budget"
          >
            {Array.from({ length: 9 }, (_, index) => today.getFullYear() - 4 + index).map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <Button size="sm" variant="secondary" icon={<RefreshCw size={16} />} onClick={loadData} disabled={loading || budgetLoading}>
            Aggiorna
          </Button>
        </div>
      </div>

      <Card>
        <div className={styles.periodBanner}>
          Stai modificando il budget di <strong>{monthNames[month - 1]} {year}</strong>. I valori salvati qui non modificano gli altri mesi.
        </div>
        {recurringMessage && (
          <div className={`${styles.budgetNotice} ${styles.success}`}>{recurringMessage}</div>
        )}
        {recurringError && (
          <div className={`${styles.budgetNotice} ${styles.warning}`}>
            Spese fisse non generate: {recurringError}
          </div>
        )}
        {prefillNotice && (
          <div className={`${styles.budgetNotice} ${styles.warning}`}>
            {prefillNotice}
          </div>
        )}
        {loadError && (
          <div className={`${styles.budgetNotice} ${styles.error}`}>
            {loadError}
          </div>
        )}
        {loading || budgetLoading ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>Caricamento {monthNames[month - 1]} {year}...</div>
        ) : (
          <>
            <div className={styles.budgetSummary}>
              <div><span>Totale previsto</span><strong>{totalPlanned.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €</strong></div>
              <div><span>Totale effettivo</span><strong>{totalActual.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €</strong></div>
              <div><span>Differenza</span><strong className={totalDiff >= 0 ? styles.diffPositive : styles.diffNegative}>{totalDiff > 0 ? '+' : ''}{totalDiff.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €</strong></div>
            </div>

            <table className={styles.budgetTable}>
            <thead>
              <tr>
                <th>Categoria</th>
                <th style={{textAlign: 'right'}}>Previsto</th>
                <th style={{textAlign: 'right'}}>Effettivo</th>
                <th style={{textAlign: 'right'}}>Differenza</th>
              </tr>
            </thead>
            <tbody>
              {expenseCategories.map(cat => {
                const categorySubcategories = subcategoriesByCategory.get(cat.id) || [];
                const hasSubcategories = categorySubcategories.length > 0;
                const isExpanded = expandedCategoryIds.has(cat.id);
                const planned = plannedForCategory(cat.id);
                const actual = actuals.byCategory[cat.id] || 0;
                const diff = planned - actual;
                const percent = planned > 0 ? Math.min((actual / planned) * 100, 100) : (actual > 0 ? 100 : 0);
                const progressClass = percent > 90 ? styles.danger : percent > 75 ? styles.warning : '';

                return (
                  <React.Fragment key={cat.id}>
                    <tr className={styles.categoryRow}>
                      <td data-label="Categoria">
                        {hasSubcategories ? (
                          <button
                            type="button"
                            className={styles.categoryToggle}
                            onClick={() => toggleCategory(cat.id)}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                            <span>{cat.name}</span>
                            <small>{categorySubcategories.length} sottocategorie</small>
                          </button>
                        ) : (
                          <div className={styles.categoryName}>{cat.name}</div>
                        )}
                        <div className={styles.progressWrapper}>
                          <div className={`${styles.progressBar} ${progressClass}`} style={{ width: `${percent}%` }}></div>
                        </div>
                      </td>
                      <td data-label="Previsto" className={styles.amount}>
                        <><input
                          type="number"
                          min={subcategoryPlannedTotal(cat.id)}
                          step="0.01"
                          className={styles.inputAmount}
                          value={categoryTotalDrafts[cat.id] ?? (planned || '')}
                          onChange={event => handleCategoryTotalChange(cat.id, event.target.value)}
                          onBlur={event => handleCategoryTotalBlur(cat.id, event.currentTarget.value)}
                          aria-label={`Totale previsto ${cat.name}`}
                          placeholder="0"
                        /> €</>
                      </td>
                      <td data-label="Effettivo" className={styles.amount}>
                        {actual.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €
                      </td>
                      <td data-label="Differenza" className={`${styles.amount} ${diff >= 0 ? styles.diffPositive : styles.diffNegative}`}>
                        {diff > 0 ? '+' : ''}{diff.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €
                      </td>
                    </tr>

                    {hasSubcategories && isExpanded && (
                      <>
                        <tr className={`${styles.subcategoryRow} ${styles.unallocatedRow}`}>
                          <td data-label="Voce"><div className={styles.subcategoryName}>Non ripartito</div></td>
                          <td data-label="Previsto" className={styles.amount}>
                            <strong>{(categoryBudgets[cat.id] || 0).toLocaleString('it-IT', { minimumFractionDigits: 2 })} €</strong>
                            <small className={styles.calculatedLabel}>calcolato</small>
                          </td>
                          <td data-label="Effettivo" className={styles.amount}>{(actuals.unallocatedByCategory[cat.id] || 0).toLocaleString('it-IT', { minimumFractionDigits: 2 })} €</td>
                          <td data-label="Differenza" className={`${styles.amount} ${(categoryBudgets[cat.id] || 0) - (actuals.unallocatedByCategory[cat.id] || 0) >= 0 ? styles.diffPositive : styles.diffNegative}`}>
                            {((categoryBudgets[cat.id] || 0) - (actuals.unallocatedByCategory[cat.id] || 0)) > 0 ? '+' : ''}{((categoryBudgets[cat.id] || 0) - (actuals.unallocatedByCategory[cat.id] || 0)).toLocaleString('it-IT', { minimumFractionDigits: 2 })} €
                          </td>
                        </tr>
                        {categorySubcategories.map(subcategory => {
                          const subcategoryPlanned = subcategoryBudgets[subcategory.id] || 0;
                          const subcategoryActual = actuals.bySubcategory[subcategory.id] || 0;
                          const subcategoryDiff = subcategoryPlanned - subcategoryActual;
                          return (
                            <tr key={subcategory.id} className={styles.subcategoryRow}>
                              <td data-label="Sottocategoria"><div className={styles.subcategoryName}>{subcategory.name}</div></td>
                              <td data-label="Previsto" className={styles.amount}>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  className={styles.inputAmount}
                                  value={subcategoryBudgets[subcategory.id] || ''}
                                  onChange={event => handleSubcategoryBudgetChange(cat.id, subcategory.id, event.target.value)}
                                  onBlur={() => handleSubcategoryBudgetBlur(cat.id, subcategory.id)}
                                  placeholder="0"
                                /> €
                              </td>
                              <td data-label="Effettivo" className={styles.amount}>{subcategoryActual.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €</td>
                              <td data-label="Differenza" className={`${styles.amount} ${subcategoryDiff >= 0 ? styles.diffPositive : styles.diffNegative}`}>
                                {subcategoryDiff > 0 ? '+' : ''}{subcategoryDiff.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €
                              </td>
                            </tr>
                          );
                        })}
                      </>
                    )}
                  </React.Fragment>
                );
              })}

              {(actuals.byCategory.uncategorized || 0) > 0 && (
                <tr className={styles.uncategorizedRow}>
                  <td data-label="Categoria"><div className={styles.categoryName}>Non classificato</div></td>
                  <td data-label="Previsto" className={styles.amount}>0,00 €</td>
                  <td data-label="Effettivo" className={styles.amount}>{actuals.byCategory.uncategorized.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €</td>
                  <td data-label="Differenza" className={`${styles.amount} ${styles.diffNegative}`}>-{actuals.byCategory.uncategorized.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €</td>
                </tr>
              )}
            </tbody>
          </table>
          </>
        )}
      </Card>
    </div>
  );
};
