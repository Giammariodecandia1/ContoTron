import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, RefreshCw, Scale, Users } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useHousehold } from '../hooks';
import { formatCurrency } from '../lib/money';
import { calculateEqualSplit, transactionBelongsToSplit } from '../lib/splitCalculator';
import { supabase } from '../lib/supabaseClient';
import styles from './SplitPage.module.css';

interface SplitMember {
  userId: string;
  displayName: string;
  email: string | null;
}

interface SplitTransaction {
  id: string;
  account_id: string | null;
  amount: number;
  transaction_date: string;
  cash_impact_date: string | null;
  inserted_by: string | null;
  is_shared: boolean;
  status: string;
  type: string;
}

const localDateIso = (date: Date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');

const currentMonthStart = () => {
  const today = new Date();
  return localDateIso(new Date(today.getFullYear(), today.getMonth(), 1));
};

const currentMonthEnd = () => {
  const today = new Date();
  return localDateIso(new Date(today.getFullYear(), today.getMonth() + 1, 0));
};

const transactionImpactDate = (transaction: SplitTransaction) => (
  transaction.cash_impact_date || transaction.transaction_date
);

export const SplitPage: React.FC = () => {
  const { household, accounts } = useHousehold();
  const householdId = household?.id || null;
  const currency = household?.currency || 'EUR';
  const [fromDate, setFromDate] = useState(currentMonthStart);
  const [toDate, setToDate] = useState(currentMonthEnd);
  const [accountId, setAccountId] = useState('all');
  const [members, setMembers] = useState<SplitMember[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [transactions, setTransactions] = useState<SplitTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSplit = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    setError(null);

    try {
      const [memberResult, transactionResult] = await Promise.all([
        supabase
          .from('household_members')
          .select(`
            user_id,
            profiles!household_members_user_id_fkey (
              display_name,
              email
            )
          `)
          .eq('household_id', householdId)
          .order('created_at', { ascending: true }),
        supabase
          .from('transactions')
          .select('id, account_id, amount, transaction_date, cash_impact_date, inserted_by, is_shared, status, type')
          .eq('household_id', householdId)
          .eq('type', 'expense')
          .eq('is_shared', true)
          .neq('status', 'deleted')
          .or([
            `and(cash_impact_date.gte.${fromDate},cash_impact_date.lte.${toDate})`,
            `and(cash_impact_date.is.null,transaction_date.gte.${fromDate},transaction_date.lte.${toDate})`,
          ].join(','))
          .order('transaction_date', { ascending: true }),
      ]);

      if (memberResult.error) throw memberResult.error;
      if (transactionResult.error) throw transactionResult.error;

      const loadedMembers = (memberResult.data || []).map(row => {
        const profile = row.profiles as unknown as { display_name?: string | null; email?: string | null } | null;
        return {
          userId: row.user_id,
          displayName: profile?.display_name || profile?.email || 'Utente',
          email: profile?.email || null,
        };
      });
      const validMemberIds = new Set(loadedMembers.map(member => member.userId));

      setMembers(loadedMembers);
      setSelectedMemberIds(current => {
        const retained = current.filter(userId => validMemberIds.has(userId));
        return retained.length > 0 ? retained : loadedMembers.map(member => member.userId);
      });
      setTransactions((transactionResult.data || []) as SplitTransaction[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossibile calcolare lo split.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, householdId, toDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSplit(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSplit]);

  const split = useMemo(() => {
    const selectedSet = new Set(selectedMemberIds);
    const inPeriod = transactions.filter(transaction => {
      const date = transactionImpactDate(transaction);
      return transactionBelongsToSplit(transaction)
        && date >= fromDate
        && date <= toDate
        && (accountId === 'all' || transaction.account_id === accountId);
    });
    const unattributedCents = inPeriod
      .filter(transaction => !transaction.inserted_by)
      .reduce((sum, transaction) => sum + Math.round(Number(transaction.amount || 0) * 100), 0);
    const included = inPeriod.filter(transaction => (
      !!transaction.inserted_by && selectedSet.has(transaction.inserted_by)
    ));
    const selectedMembers = members
      .filter(member => selectedSet.has(member.userId))
      .map(member => ({ userId: member.userId, displayName: member.displayName }));
    const calculated = calculateEqualSplit(
      selectedMembers,
      included.map(transaction => ({
        userId: transaction.inserted_by || '',
        amountCents: Math.round(Number(transaction.amount || 0) * 100),
      })),
    );

    return {
      unattributedCents,
      transactionCount: included.length,
      totalCents: calculated.totalCents,
      memberBalances: calculated.balances,
      settlements: selectedMemberIds.length >= 2 ? calculated.settlements : [],
    };
  }, [accountId, fromDate, members, selectedMemberIds, toDate, transactions]);

  const toggleMember = (userId: string) => {
    setSelectedMemberIds(current => (
      current.includes(userId)
        ? current.filter(id => id !== userId)
        : [...current, userId]
    ));
  };

  const selectedAccountName = accountId === 'all'
    ? 'Tutti i conti'
    : accounts.find(account => account.id === accountId)?.name || 'Conto';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Split</h1>
          <p className="text-muted">Ripartizione paritaria delle spese condivise tra i membri del nucleo.</p>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw size={16} />} onClick={loadSplit} disabled={loading}>
          Aggiorna
        </Button>
      </header>

      <Card title="Conto, periodo e partecipanti" icon={<CalendarRange size={20} />}>
        <div className={styles.filters}>
          <label>
            Conto
            <select value={accountId} onChange={event => setAccountId(event.target.value)}>
              <option value="all">Tutti i conti</option>
              {accounts.filter(account => account.is_active).map(account => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
          <label>
            Dal
            <input type="date" value={fromDate} max={toDate} onChange={event => setFromDate(event.target.value)} />
          </label>
          <label>
            Al
            <input type="date" value={toDate} min={fromDate} onChange={event => setToDate(event.target.value)} />
          </label>
        </div>

        <div className={styles.participantHeader}>
          <div>
            <strong>Partecipanti allo split</strong>
            <span>Seleziona soltanto chi deve dividere queste spese.</span>
          </div>
          <div>
            <button type="button" onClick={() => setSelectedMemberIds(members.map(member => member.userId))}>Tutti</button>
            <button type="button" onClick={() => setSelectedMemberIds([])}>Nessuno</button>
          </div>
        </div>
        <div className={styles.participants}>
          {members.map(member => (
            <label key={member.userId} className={selectedMemberIds.includes(member.userId) ? styles.participantSelected : ''}>
              <input
                type="checkbox"
                checked={selectedMemberIds.includes(member.userId)}
                onChange={() => toggleMember(member.userId)}
              />
              <span><strong>{member.displayName}</strong>{member.email && <small>{member.email}</small>}</span>
            </label>
          ))}
        </div>
      </Card>

      {error && <div className={styles.error}>{error}</div>}
      {loading ? (
        <Card><div className={styles.loading}>Calcolo dello split in corso...</div></Card>
      ) : selectedMemberIds.length < 2 ? (
        <Card><div className={styles.notice}>Seleziona almeno due partecipanti per calcolare la ripartizione.</div></Card>
      ) : (
        <>
          <div className={styles.summary}>
            <div><span>Spese condivise</span><strong>{formatCurrency(split.totalCents / 100, currency)}</strong></div>
            <div><span>Movimenti</span><strong>{split.transactionCount}</strong></div>
            <div><span>Partecipanti</span><strong>{selectedMemberIds.length}</strong></div>
            <div><span>Quota media</span><strong>{formatCurrency(split.totalCents / selectedMemberIds.length / 100, currency)}</strong></div>
          </div>

          {split.unattributedCents > 0 && (
            <div className={styles.warning}>
              {formatCurrency(split.unattributedCents / 100, currency)} non sono inclusi perché i movimenti non indicano chi li ha inseriti.
            </div>
          )}

          <Card title={`Contributi su ${selectedAccountName}`} icon={<Users size={20} />}>
            <div className={styles.balanceTableWrap}>
              <table className={styles.balanceTable}>
                <thead>
                  <tr>
                    <th>Persona</th>
                    <th>Speso</th>
                    <th>% totale</th>
                    <th>Quota paritaria</th>
                    <th>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {split.memberBalances.map(member => (
                    <tr key={member.userId}>
                      <td><strong>{member.displayName}</strong><small>{member.transactionCount} movimenti</small></td>
                      <td>{formatCurrency(member.paidCents / 100, currency)}</td>
                      <td>{member.percentage.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
                      <td>{formatCurrency(member.shareCents / 100, currency)}</td>
                      <td className={member.balanceCents > 0 ? styles.credit : member.balanceCents < 0 ? styles.debt : styles.even}>
                        <strong>{member.balanceCents > 0 ? 'Deve ricevere' : member.balanceCents < 0 ? 'Deve versare' : 'In pari'}</strong>
                        <span>{formatCurrency(Math.abs(member.balanceCents) / 100, currency)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Come pareggiare le spese" icon={<Scale size={20} />}>
            {split.totalCents === 0 ? (
              <p className={styles.notice}>Non ci sono spese condivise nel periodo selezionato.</p>
            ) : split.settlements.length === 0 ? (
              <p className={styles.settled}>Le spese sono già ripartite in modo paritario.</p>
            ) : (
              <div className={styles.settlements}>
                {split.settlements.map((settlement, index) => (
                  <div key={`${settlement.from}-${settlement.to}-${index}`}>
                    <span><strong>{settlement.from}</strong> deve dare a <strong>{settlement.to}</strong></span>
                    <b>{formatCurrency(settlement.amountCents / 100, currency)}</b>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
};
