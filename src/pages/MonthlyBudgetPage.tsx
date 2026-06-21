import React, { useEffect, useState, useMemo } from 'react';
import { Card } from '../components/ui/Card';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useHousehold, useTransactions } from '../hooks';
import { useBudget } from '../hooks/useBudget';
import styles from './MonthlyBudgetPage.module.css';

export const MonthlyBudgetPage: React.FC = () => {
  const { household, categories } = useHousehold();
  const { fetchTransactions } = useTransactions();
  const { fetchBudgetTargets, upsertBudgetTarget, loading: budgetLoading } = useBudget();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [transactions, setTransactions] = useState<any[]>([]);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  const monthNames = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

  const loadData = async () => {
    setLoading(true);
    // 1. Fetch transactions for the current month
    const txs = await fetchTransactions(month, year);
    setTransactions(txs.filter(t => t.type === 'expense')); // Only expenses affect this budget view

    // 2. Fetch or auto-prefill budget targets
    const targets = await fetchBudgetTargets(year, month);
    
    const budgetMap: Record<string, number> = {};
    targets.forEach(t => {
      if (t.category_id) {
        budgetMap[t.category_id] = t.planned_amount;
      }
    });
    setBudgets(budgetMap);
    setLoading(false);
  };

  useEffect(() => {
    if (household) {
      loadData();
    }
  }, [household, month, year]);

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 2, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month, 1));
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
          <button className={styles.monthBtn} onClick={handlePrevMonth}><ChevronLeft size={20} /></button>
          <div className={styles.monthDisplay}>{monthNames[month - 1]} {year}</div>
          <button className={styles.monthBtn} onClick={handleNextMonth}><ChevronRight size={20} /></button>
        </div>
      </div>

      <Card>
        {loading || budgetLoading ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>Caricamento e calcolo precompilazioni...</div>
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
