import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, List, Plus, Scale, WalletCards } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useAuth, useHousehold, useTransactions } from '../hooks';
import { summarizeHouseholdSpending } from '../lib/memberTransactionSummary';
import { formatCurrency } from '../lib/money';
import type { Transaction } from '../types/database';
import styles from './SimpleDashboardPage.module.css';

export const SimpleDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { household } = useHousehold();
  const { fetchTransactions, loading } = useTransactions();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const today = useMemo(() => new Date(), []);
  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  const currency = household?.currency || 'EUR';

  const loadTransactions = useCallback(async () => {
    const rows = await fetchTransactions(month, year, undefined, 'cash_impact');
    setTransactions(rows.filter(row => row.status !== 'deleted' && row.status !== 'rejected'));
  }, [fetchTransactions, month, year]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTransactions(), 0);
    return () => window.clearTimeout(timer);
  }, [loadTransactions]);

  const summary = useMemo(() => {
    const spending = summarizeHouseholdSpending(transactions, user?.id);
    const income = transactions
      .filter(transaction => transaction.type === 'income')
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
    const elapsedDays = Math.max(1, today.getDate());
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyAverage = spending.householdExpenses / elapsedDays;

    return {
      ...spending,
      income,
      balance: income - spending.householdExpenses,
      dailyAverage,
      projectedExpenses: dailyAverage * daysInMonth,
    };
  }, [month, today, transactions, user?.id, year]);

  const recentExpenses = useMemo(() => (
    transactions
      .filter(transaction => transaction.type === 'expense')
      .sort((left, right) => (
        new Date(right.transaction_date).getTime() - new Date(left.transaction_date).getTime()
        || new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
      ))
      .slice(0, 6)
  ), [transactions]);

  const monthLabel = today.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.modeBadge}>Modalità semplice</span>
          <h1 className={styles.title}>Le tue spese di {monthLabel}</h1>
          <p className="text-muted">Solo le informazioni essenziali, senza classificazioni obbligatorie.</p>
        </div>
        <Button size="lg" icon={<Plus size={19} />} onClick={() => navigate('/transazioni/nuova')}>
          Aggiungi spesa
        </Button>
      </header>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <span>Spese del nucleo</span>
          <strong>{formatCurrency(summary.householdExpenses, currency)}</strong>
          <small>{summary.householdExpenseCount} movimenti del mese</small>
        </div>
        <div className={styles.summaryCard}>
          <span>Le mie spese</span>
          <strong>{formatCurrency(summary.myExpenses, currency)}</strong>
          <small>{summary.myExpenseCount} movimenti attribuiti a te</small>
        </div>
        <div className={styles.summaryCard}>
          <span>Entrate del mese</span>
          <strong>{formatCurrency(summary.income, currency)}</strong>
          <small>Totale registrato</small>
        </div>
        <div className={`${styles.summaryCard} ${summary.balance < 0 ? styles.negative : styles.positive}`}>
          <span>Differenza</span>
          <strong>{formatCurrency(summary.balance, currency)}</strong>
          <small>Entrate meno spese</small>
        </div>
      </div>

      <div className={styles.contentGrid}>
        <Card title="Controllo semplice" icon={<WalletCards size={20} />}>
          {loading ? (
            <div className={styles.empty}>Aggiornamento in corso...</div>
          ) : (
            <div className={styles.controlList}>
              <div>
                <span>Media spesa al giorno</span>
                <strong>{formatCurrency(summary.dailyAverage, currency)}</strong>
              </div>
              <div>
                <span>Stima a fine mese</span>
                <strong>{formatCurrency(summary.projectedExpenses, currency)}</strong>
              </div>
              <p>La stima usa soltanto le spese inserite finora e si aggiorna automaticamente.</p>
            </div>
          )}
        </Card>

        <Card title="Azioni rapide">
          <div className={styles.quickActions}>
            <button type="button" onClick={() => navigate('/transazioni/nuova')}>
              <Plus size={22} /><span><strong>Aggiungi una spesa</strong><small>Importo, data e descrizione</small></span><ArrowRight size={18} />
            </button>
            <button type="button" onClick={() => navigate('/transazioni')}>
              <List size={22} /><span><strong>Vedi i movimenti</strong><small>Controlla o modifica ciò che hai inserito</small></span><ArrowRight size={18} />
            </button>
            <button type="button" onClick={() => navigate('/split')}>
              <Scale size={22} /><span><strong>Apri Split</strong><small>Controlla chi deve dare quanto</small></span><ArrowRight size={18} />
            </button>
          </div>
        </Card>
      </div>

      <Card title="Ultime spese inserite" action={<Button size="sm" variant="secondary" onClick={() => navigate('/transazioni')}>Vedi tutte</Button>}>
        {recentExpenses.length === 0 ? (
          <div className={styles.empty}>Non hai ancora inserito spese questo mese.</div>
        ) : (
          <div className={styles.recentList}>
            {recentExpenses.map(transaction => (
              <button key={transaction.id} type="button" onClick={() => navigate(`/transazioni/${transaction.id}/modifica`)}>
                <span><strong>{transaction.description || 'Spesa'}</strong><small>{new Date(`${transaction.transaction_date}T00:00:00`).toLocaleDateString('it-IT')}</small></span>
                <b>{formatCurrency(Number(transaction.amount || 0), currency)}</b>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
