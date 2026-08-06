import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ListPlus, Pencil, Plus, RefreshCw, Users } from 'lucide-react';
import { useTransactions, useHousehold, useViewMode } from '../hooks';
import { Button } from '../components/ui/Button';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  summarizeTransactionsByMember,
  unattributedMemberId,
  type MemberIdentity,
} from '../lib/memberTransactionSummary';
import { formatCurrency } from '../lib/money';
import { paymentMethodLabels } from '../lib/paymentTiming';
import { supabase } from '../lib/supabaseClient';
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
  const { isSimple } = useViewMode();
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);
  const [members, setMembers] = useState<MemberIdentity[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('all');
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
    if (!isSimple || !household?.id) return;

    const loadMembers = async () => {
      const { data, error: memberError } = await supabase
        .from('household_members')
        .select(`
          user_id,
          profiles!household_members_user_id_fkey (
            display_name,
            email
          )
        `)
        .eq('household_id', household.id)
        .order('created_at', { ascending: true });

      if (memberError) {
        console.warn('Impossibile caricare tutti i componenti del nucleo:', memberError);
        return;
      }

      setMembers((data || []).map(row => {
        const profile = row.profiles as unknown as { display_name?: string | null; email?: string | null } | null;
        return {
          userId: row.user_id,
          displayName: profile?.display_name || profile?.email || 'Componente',
          email: profile?.email || null,
        };
      }));
    };

    const timer = window.setTimeout(() => void loadMembers(), 0);
    return () => window.clearTimeout(timer);
  }, [household?.id, isSimple]);

  useEffect(() => {
    if (!routeState.createdTransactionId || !createdTransactionRef.current) return;
    createdTransactionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [routeState.createdTransactionId, transactions]);

  const memberSummaries = useMemo(
    () => summarizeTransactionsByMember(members, transactions),
    [members, transactions],
  );

  const visibleTransactions = useMemo(() => {
    if (!isSimple || selectedMemberId === 'all') return transactions;
    if (selectedMemberId === unattributedMemberId) {
      return transactions.filter(transaction => !transaction.inserted_by);
    }
    return transactions.filter(transaction => transaction.inserted_by === selectedMemberId);
  }, [isSimple, selectedMemberId, transactions]);

  const { newlyCreatedTransaction, currentTransactions, futureTransactions } = useMemo(() => {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const created = routeState.createdTransactionId
      ? visibleTransactions.find(transaction => transaction.id === routeState.createdTransactionId)
      : undefined;
    const remaining = visibleTransactions.filter(transaction => transaction.id !== created?.id);

    return {
      newlyCreatedTransaction: created ? [created] : [],
      currentTransactions: remaining
        .filter(transaction => new Date(transaction.transaction_date).getTime() <= todayEnd.getTime())
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
      futureTransactions: remaining
        .filter(transaction => new Date(transaction.transaction_date).getTime() > todayEnd.getTime())
        .sort((left, right) => new Date(left.transaction_date).getTime() - new Date(right.transaction_date).getTime()),
    };
  }, [routeState.createdTransactionId, visibleTransactions]);

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

  const simpleUploaderLabel = (tx: TransactionListItem) => (
    tx.inserted_by_profile?.display_name
    || tx.inserted_by_profile?.email
    || members.find(member => member.userId === tx.inserted_by)?.displayName
    || (tx.inserted_by ? 'Componente del nucleo' : 'Non attribuita')
  );

  const renderTransaction = (tx: TransactionListItem) => (
    <div
      key={tx.id}
      ref={tx.id === routeState.createdTransactionId ? createdTransactionRef : undefined}
      className={tx.id === routeState.createdTransactionId ? styles.recentlyCreated : styles.transactionRow}
    >
      <div>
        <div className={styles.transactionTitle}>{tx.description}</div>
        {isSimple ? (
          <>
            <div className="text-muted fs-sm">{new Date(tx.transaction_date).toLocaleDateString('it-IT')}</div>
            <div className={styles.simpleUploader}>Fatta da: <strong>{simpleUploaderLabel(tx)}</strong></div>
          </>
        ) : (
          <>
            <div className="text-muted fs-sm">
              {new Date(tx.transaction_date).toLocaleDateString()} - {tx.categories?.name || (tx.source === 'receipt_ocr' ? 'Scontrino multi-categoria' : 'Non classificato')} - Conto: {tx.accounts?.name || 'Conto'} - Periodicita: {getTransactionFrequencyLabel(tx.frequency)}
            </div>
            <div className="text-muted fs-sm">Caricata da account: {uploaderLabel(tx)}</div>
          </>
        )}
        {!isSimple && tx.payment_method === 'credit_card' && (
          <div className="text-muted fs-sm">
            {paymentMethodLabels.credit_card}: impatto disponibilita {new Date(`${tx.cash_impact_date || tx.transaction_date}T00:00:00`).toLocaleDateString('it-IT')}
          </div>
        )}
        {!isSimple && tx.notes && <div className={styles.transactionNote}>Nota: {tx.notes}</div>}
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
          <p className="text-muted">{isSimple ? 'Controlla e modifica le spese che hai inserito.' : 'Gestisci entrate, uscite e trasferimenti.'}</p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="secondary" icon={<RefreshCw size={17} />} onClick={() => void loadTxs()} disabled={loading}>
            Aggiorna
          </Button>
          <Button icon={<Plus size={18} />} onClick={() => navigate('/transazioni/nuova')}>
            {isSimple ? 'Aggiungi spesa' : 'Nuova Transazione'}
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

      {isSimple && memberSummaries.length > 0 && (
        <Card title="Riepilogo per componente" icon={<Users size={20} />} className={styles.memberSummaryCard}>
          <div className={styles.memberSummaryToolbar}>
            <p>Seleziona una persona per vedere tutte le sue transazioni.</p>
            {selectedMemberId !== 'all' && (
              <button type="button" onClick={() => setSelectedMemberId('all')}>
                Mostra tutti
              </button>
            )}
          </div>
          <div className={styles.memberSummaryGrid}>
            {memberSummaries.map(summary => (
              <button
                key={summary.userId}
                type="button"
                className={`${styles.memberSummaryItem} ${selectedMemberId === summary.userId ? styles.memberSummaryActive : ''}`}
                aria-pressed={selectedMemberId === summary.userId}
                onClick={() => setSelectedMemberId(current => current === summary.userId ? 'all' : summary.userId)}
              >
                <div className={styles.memberIdentity}>
                  <span>{summary.displayName.charAt(0).toUpperCase() || '?'}</span>
                  <div>
                    <strong>{summary.displayName}</strong>
                    <small>{summary.transactionCount} {summary.transactionCount === 1 ? 'transazione' : 'transazioni'}</small>
                  </div>
                </div>
                <div className={styles.memberAmounts}>
                  <div><span>Uscite</span><strong>{formatCurrency(summary.expenses, household?.currency || 'EUR')}</strong></div>
                  <div><span>Entrate</span><strong>{formatCurrency(summary.income, household?.currency || 'EUR')}</strong></div>
                </div>
              </button>
            ))}
          </div>
        </Card>
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
        ) : visibleTransactions.length === 0 ? (
          <div className={styles.filteredEmpty}>
            Nessuna transazione per questo componente.
            <button type="button" onClick={() => setSelectedMemberId('all')}>Mostra tutti i movimenti</button>
          </div>
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
