import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ListPlus, Pencil, Plus, RefreshCw } from 'lucide-react';
import { useTransactions, useHousehold } from '../hooks';
import { Button } from '../components/ui/Button';
import { useLocation, useNavigate } from 'react-router-dom';
import { paymentMethodLabels } from '../lib/paymentTiming';
import { getTransactionFrequencyLabel } from '../lib/transactionFrequencies';
import type { Transaction } from '../types/database';
import styles from './TransactionsPage.module.css';

type TransactionListItem = Transaction & {
  accounts?: { name?: string | null } | null;
  categories?: { name?: string | null } | null;
  inserted_by_profile?: { display_name?: string | null; email?: string | null } | null;
};

export const TransactionsPage: React.FC = () => {
  const { fetchTransactions, loading, error, deleteTransaction } = useTransactions();
  const { household } = useHousehold();
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);
  const createdTransactionRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = (location.state || {}) as {
    createdTransactionId?: string;
    notice?: string;
    warning?: string;
  };

  const loadTxs = useCallback(async () => {
    const data = await fetchTransactions();
    setTransactions(data as TransactionListItem[]);
  }, [fetchTransactions]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTxs(), 0);
    return () => window.clearTimeout(timer);
  }, [loadTxs]);

  useEffect(() => {
    if (!routeState.createdTransactionId || !createdTransactionRef.current) return;
    createdTransactionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [routeState.createdTransactionId, transactions]);

  const { newlyCreatedTransaction, currentTransactions, futureTransactions } = useMemo(() => {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const created = routeState.createdTransactionId
      ? transactions.find(transaction => transaction.id === routeState.createdTransactionId)
      : undefined;
    const remaining = transactions.filter(transaction => transaction.id !== created?.id);

    return {
      newlyCreatedTransaction: created ? [created] : [],
      currentTransactions: remaining
        .filter(transaction => new Date(transaction.transaction_date).getTime() <= todayEnd.getTime())
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
      futureTransactions: remaining
        .filter(transaction => new Date(transaction.transaction_date).getTime() > todayEnd.getTime())
        .sort((left, right) => new Date(left.transaction_date).getTime() - new Date(right.transaction_date).getTime()),
    };
  }, [routeState.createdTransactionId, transactions]);

  const handleDelete = async (id: string) => {
    if (window.confirm('Sei sicuro di voler eliminare questa transazione?')) {
      await deleteTransaction(id);
      loadTxs();
    }
  };

  const uploaderLabel = (tx: TransactionListItem) => {
    const profile = tx.inserted_by_profile;
    const name = profile?.display_name || profile?.email || 'Sconosciuto';
    return profile?.email && profile.email !== name ? `${name} (${profile.email})` : name;
  };

  const renderTransaction = (tx: TransactionListItem) => (
    <div
      key={tx.id}
      ref={tx.id === routeState.createdTransactionId ? createdTransactionRef : undefined}
      className={tx.id === routeState.createdTransactionId ? styles.recentlyCreated : styles.transactionRow}
    >
      <div>
        <div className={styles.transactionTitle}>{tx.description}</div>
        <div className="text-muted fs-sm">
          {new Date(tx.transaction_date).toLocaleDateString()} - {tx.categories?.name || (tx.source === 'receipt_ocr' ? 'Scontrino multi-categoria' : 'Non classificato')} - Conto: {tx.accounts?.name || 'Conto'} - Periodicita: {getTransactionFrequencyLabel(tx.frequency)}
        </div>
        <div className="text-muted fs-sm">
          Caricata da account: {uploaderLabel(tx)}
        </div>
        {tx.payment_method === 'credit_card' && (
          <div className="text-muted fs-sm">
            {paymentMethodLabels.credit_card}: impatto disponibilita {new Date(`${tx.cash_impact_date || tx.transaction_date}T00:00:00`).toLocaleDateString('it-IT')}
          </div>
        )}
        {tx.notes && <div className={styles.transactionNote}>Nota: {tx.notes}</div>}
      </div>
      <div className={styles.transactionActions}>
        <div className={tx.type === 'expense' ? styles.expenseAmount : styles.incomeAmount}>
          {tx.type === 'expense' ? '-' : '+'}{tx.amount.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}
        </div>
        <button onClick={() => navigate(`/transazioni/${tx.id}/modifica`)} className={styles.editButton}>
          <Pencil size={14} /> Modifica
        </button>
        <button onClick={() => handleDelete(tx.id)} className={styles.deleteButton}>Elimina</button>
      </div>
    </div>
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Transazioni</h1>
          <p className="text-muted">Gestisci entrate, uscite e trasferimenti.</p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="secondary" icon={<RefreshCw size={17} />} onClick={() => void loadTxs()} disabled={loading}>
            Aggiorna
          </Button>
          <Button icon={<Plus size={18} />} onClick={() => navigate('/transazioni/nuova')}>
            Nuova Transazione
          </Button>
        </div>
      </header>

      {routeState.notice && <div className={`${styles.message} ${styles.success}`}>{routeState.notice}</div>}
      {routeState.warning && <div className={`${styles.message} ${styles.warning}`}>{routeState.warning}</div>}
      {error && (
        <div className={`${styles.message} ${styles.error}`}>
          Non riesco a caricare l'elenco completo: {error}
        </div>
      )}

      <Card>
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>Caricamento in corso...</div>
        ) : transactions.length === 0 ? (
          <EmptyState
            icon={<ListPlus />}
            title="Nessun movimento registrato"
            description="Il tuo registro e' vuoto. Inizia inserendo la tua prima transazione manuale oppure scansiona uno scontrino."
            actionText="Aggiungi Transazione"
            onAction={() => navigate('/transazioni/nuova')}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {newlyCreatedTransaction.length > 0 && (
              <section>
                <h2 className={styles.sectionTitle}>Appena salvata</h2>
                {newlyCreatedTransaction.map(renderTransaction)}
              </section>
            )}
            {currentTransactions.length > 0 && (
              <section>
                <h2 className={styles.sectionTitle}>Movimenti recenti</h2>
                {currentTransactions.map(renderTransaction)}
              </section>
            )}
            {futureTransactions.length > 0 && (
              <section className={styles.futureSection}>
                <h2 className={styles.sectionTitle}>Movimenti futuri gia programmati</h2>
                <p className="text-muted fs-sm">Questi movimenti hanno una data successiva a oggi.</p>
                {futureTransactions.map(renderTransaction)}
              </section>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};
