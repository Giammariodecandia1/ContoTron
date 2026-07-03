import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../components/ui/Card';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useHousehold, useTransactions } from '../hooks';
import { useBudget } from '../hooks/useBudget';
import { ensureMonthlyRecurringTransactions } from '../lib/recurringTransactions';
import styles from './MonthlyBudgetPage.module.css';

export const MonthlyBudgetPage: React.FC = () => {
  const { household, accounts, categories } = useHousehold();
  const { fetchTransactions } = useTransactions();
  const { fetchBudgetTargets, upsertBudgetTarget, loading: budgetLoading } = useBudget();

  const today = new Date();
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
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
      setTransactions(txs.filter(t => t.type === 'expense')); // Only expenses affect this budget view

      // 2. Fetch or auto-prefill budget targets
      const targets = await fetchBudgetTargets(year, month);
      if (loadRequestRef.current !== requestId) return;
      
      const budgetMap: Record<string, number> = {};
      targets.forEach(t => {
        if (t.category_id) {
          budgetMap[t.category_id] = t.planned_amount;
        }
      });
      setBudgets(budgetMap);
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
  }, [accounts, fetchBudgetTargets, fetchTransactions, householdId, month, year]);

  useEffect(() => {
    if (householdId) {
      loadData();
    }
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

  const handleBudgetChange = (categoryId: string, val: string) => {
    const num = parseFloat(val) || 0;
    setBudgets(prev => ({ ...prev, [categoryId]: num }));
  };

  const handleBudgetBlur = async (categoryId: string) => {
    const amount = budgets[categoryId] || 0;
    await upsertBudgetTarget(categoryId, amount, year, month);
  };

  // Calculate actuals
  const actualsByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.forEach(tx => {
      if (tx.category_id) {
        map[tx.category_id] = (map[tx.category_id] || 0) + tx.amount;
      }
    });
    return map;
  }, [transactions]);

  const expenseCategories = categories.filter(c => c.type === 'expense').sort((a, b) => a.name.localeCompare(b.name));

  const totalPlanned = expenseCategories.reduce((acc, cat) => acc + (budgets[cat.id] || 0), 0);
  const totalActual = Object.values(actualsByCategory).reduce((acc, val) => acc + val, 0);
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
                const planned = budgets[cat.id] || 0;
                const actual = actualsByCategory[cat.id] || 0;
                const diff = planned - actual;
                
                const percent = planned > 0 ? Math.min((actual / planned) * 100, 100) : (actual > 0 ? 100 : 0);
                const progressClass = percent > 90 ? styles.danger : percent > 75 ? styles.warning : '';

                return (
                  <tr key={cat.id}>
                    <td data-label="Categoria">
                      <div className={styles.categoryName}>{cat.name}</div>
                      <div className={styles.progressWrapper}>
                        <div className={`${styles.progressBar} ${progressClass}`} style={{ width: `${percent}%` }}></div>
                      </div>
                    </td>
                    <td data-label="Previsto" className={styles.amount}>
                      <input 
                        type="number" 
                        step="1"
                        className={styles.inputAmount} 
                        value={budgets[cat.id] === 0 && actual === 0 ? '' : budgets[cat.id]} 
                        onChange={(e) => handleBudgetChange(cat.id, e.target.value)}
                        onBlur={() => handleBudgetBlur(cat.id)}
                        placeholder="0"
                      /> €
                    </td>
                    <td data-label="Effettivo" className={styles.amount}>
                      {actual.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €
                    </td>
                    <td data-label="Differenza" className={`${styles.amount} ${diff >= 0 ? styles.diffPositive : styles.diffNegative}`}>
                      {diff > 0 ? '+' : ''}{diff.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €
                    </td>
                  </tr>
                );
              })}

              <tr className={styles.totalsRow}>
                <td data-label="Totale">TOTALE MESE</td>
                <td data-label="Totale Previsto" className={styles.amount}>{totalPlanned.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €</td>
                <td data-label="Totale Effettivo" className={styles.amount}>{totalActual.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €</td>
                <td data-label="Differenza Totale" className={`${styles.amount} ${totalDiff >= 0 ? styles.diffPositive : styles.diffNegative}`}>
                  {totalDiff > 0 ? '+' : ''}{totalDiff.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};
