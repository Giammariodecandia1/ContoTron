import React, { useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ListPlus, Pencil, Plus } from 'lucide-react';
import { useTransactions, useHousehold } from '../hooks';
import { Button } from '../components/ui/Button';
import { useNavigate } from 'react-router-dom';
import styles from './TransactionsPage.module.css';

export const TransactionsPage: React.FC = () => {
  const { fetchTransactions, loading, deleteTransaction } = useTransactions();
  const { household } = useHousehold();
  const [transactions, setTransactions] = useState<any[]>([]);
  const navigate = useNavigate();

  const loadTxs = async () => {
    const data = await fetchTransactions();
    setTransactions(data);
  };

  useEffect(() => {
    loadTxs();
  }, [fetchTransactions]);

  const handleDelete = async (id: string) => {
    if (window.confirm('Sei sicuro di voler eliminare questa transazione?')) {
      await deleteTransaction(id);
      loadTxs();
    }
  };

  const uploaderLabel = (tx: any) => {
    const profile = tx.inserted_by_profile;
    const name = profile?.display_name || profile?.email || 'Sconosciuto';
    return profile?.email && profile.email !== name ? `${name} (${profile.email})` : name;
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Transazioni</h1>
          <p className="text-muted">Gestisci entrate, uscite e trasferimenti.</p>
        </div>
        <Button icon={<Plus size={18} />} onClick={() => navigate('/transazioni/nuova')}>
          Nuova Transazione
        </Button>
      </header>

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
            {transactions.map(tx => (
              <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
                <div>
                  <div style={{ fontWeight: '600' }}>{tx.description}</div>
                  <div className="text-muted fs-sm">
                    {new Date(tx.transaction_date).toLocaleDateString()} - {tx.categories?.name || 'Non classificato'} - Conto: {tx.accounts?.name || 'Conto'}
                  </div>
                  <div className="text-muted fs-sm">
                    Caricata da account: {uploaderLabel(tx)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ color: tx.type === 'expense' ? 'red' : 'green', fontWeight: 'bold', fontSize: '1.1rem' }}>
                    {tx.type === 'expense' ? '-' : '+'}{tx.amount.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}
                  </div>
                  <button onClick={() => navigate(`/transazioni/${tx.id}/modifica`)} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Pencil size={14} /> Modifica
                  </button>
                  <button onClick={() => handleDelete(tx.id)} style={{ background: 'none', border: 'none', color: 'red', cursor: 'pointer', padding: '0.5rem' }}>Elimina</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
