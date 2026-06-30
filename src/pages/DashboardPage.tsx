import React, { useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Camera, PlusCircle, Wallet } from 'lucide-react';
import { useHousehold, useTransactions } from '../hooks';
import { ExpenseCharts } from '../components/dashboard/ExpenseCharts';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { Button } from '../components/ui/Button';
import styles from './DashboardPage.module.css';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { household, loading: hhLoading } = useHousehold();
  const { fetchTransactions } = useTransactions();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [monthlyExpense, setMonthlyExpense] = useState(0);
  const [monthlyBudget, setMonthlyBudget] = useState(0);
  const [budgetId, setBudgetId] = useState<string | null>(null);
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [newBudgetValue, setNewBudgetValue] = useState('');
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetSavedMessage, setBudgetSavedMessage] = useState<string | null>(null);

  const hasTransactions = transactions.length > 0;
  const today = new Date();
  const budgetYear = today.getFullYear();
  const budgetMonth = today.getMonth() + 1;
  const uploaderLabel = (tx: any) => {
    const profile = tx.inserted_by_profile;
    const name = profile?.display_name || profile?.email || 'Sconosciuto';
    return profile?.email && profile.email !== name ? `${name} (${profile.email})` : name;
  };

  useEffect(() => {
    if (household) {
      // Fetch latest transactions for the recent list
      fetchTransactions().then(data => {
        setTransactions(data.slice(0, 5));
        
        // Calculate basic monthly totals for the current month
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        
        let expense = 0;
        
        data.forEach(tx => {
          const txDate = new Date(tx.transaction_date);
          if (txDate.getMonth() === currentMonth && txDate.getFullYear() === currentYear) {
            if (tx.type === 'expense') expense += tx.amount;
          }
        });
        
        setMonthlyExpense(expense);
      });

      // Fetch global monthly budget. Global budget rows have no category/subcategory.
      supabase
        .from('budget_targets')
        .select('id, planned_amount')
        .eq('household_id', household.id)
        .eq('year', budgetYear)
        .eq('month', budgetMonth)
        .is('category_id', null)
        .is('subcategory_id', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .then(({ data, error }) => {
          if (error) {
            setBudgetError(error.message);
            return;
          }

          const budgetRow = data?.[0];
          if (budgetRow) {
            setMonthlyBudget(budgetRow.planned_amount);
            setBudgetId(budgetRow.id);
            setNewBudgetValue(String(budgetRow.planned_amount));
          } else {
            setMonthlyBudget(0);
            setBudgetId(null);
            setNewBudgetValue('');
          }
        });
    }
  }, [budgetMonth, budgetYear, household, fetchTransactions]);

  const handleSaveBudget = async () => {
    if (!household) return;
    const amount = parseFloat(newBudgetValue.replace(',', '.'));
    if (isNaN(amount) || amount < 0) {
      setBudgetError('Inserisci un importo valido.');
      return;
    }

    setBudgetError(null);
    setBudgetSavedMessage(null);

    if (budgetId) {
      const { error } = await supabase
        .from('budget_targets')
        .update({
          planned_amount: amount,
          updated_at: new Date().toISOString()
        })
        .eq('id', budgetId)
        .eq('household_id', household.id);

      if (error) {
        setBudgetError(error.message);
        return;
      }
    } else {
      const { data, error } = await supabase.from('budget_targets').insert([{
        household_id: household.id,
        year: budgetYear,
        month: budgetMonth,
        category_id: null,
        subcategory_id: null,
        planned_amount: amount
      }]).select('id').single();

      if (error) {
        setBudgetError(error.message);
        return;
      }

      if (data) setBudgetId(data.id);
    }

    setMonthlyBudget(amount);
    setNewBudgetValue(String(amount));
    setBudgetSavedMessage('Budget salvato.');
    setIsEditingBudget(false);
  };

  if (hhLoading && !household) return <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', padding: '2rem'}}>Caricamento dashboard...</div>;

  const remainingBudget = monthlyBudget - monthlyExpense;
  const budgetPercentage = monthlyBudget > 0 ? (monthlyExpense / monthlyBudget) * 100 : 0;
  
  // Colore in base alla % di utilizzo del budget
  let budgetColor = 'var(--color-success)';
  if (budgetPercentage > 90) budgetColor = 'var(--color-danger)';
  else if (budgetPercentage > 75) budgetColor = 'var(--color-warning)';

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <h1 className={styles.title}>Dashboard</h1>
        <p className="text-muted">Benvenuto in Contotron, {household?.name}!</p>
      </header>

      <Link to="/scan" className={styles.mobileScanCard}>
        <span className={styles.mobileScanIcon}>
          <Camera size={24} />
        </span>
        <span>
          <strong>Scansiona scontrino</strong>
          <small>Foto rapida, OCR e transazione automatica</small>
        </span>
      </Link>
      
      <div className={styles.mainGrid}>
        {/* Left Column */}
        <div className={styles.leftCol}>
          <Card className={styles.balanceCard}>
            <div className={styles.balanceHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-gray-500)' }}>
                <Wallet size={18} />
                <span>Budget Mensile {new Date().toLocaleString('it-IT', {month: 'long'})}</span>
              </div>
            </div>

            {budgetError && (
              <p style={{ color: 'var(--color-danger)', fontSize: '0.875rem', marginTop: '0.75rem' }}>
                Errore salvataggio budget: {budgetError}
              </p>
            )}
            {budgetSavedMessage && (
              <p style={{ color: 'var(--color-success)', fontSize: '0.875rem', marginTop: '0.75rem' }}>
                {budgetSavedMessage}
              </p>
            )}
            
            {isEditingBudget ? (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
                <input 
                  type="number" 
                  step="0.01"
                  value={newBudgetValue} 
                  onChange={e => setNewBudgetValue(e.target.value)}
                  style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--color-gray-300)', width: '120px' }}
                />
                <Button size="sm" onClick={handleSaveBudget}>Salva</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNewBudgetValue(monthlyBudget ? String(monthlyBudget) : '');
                    setIsEditingBudget(false);
                  }}
                >
                  Annulla
                </Button>
              </div>
            ) : (
              <>
                <div
                  className={styles.balanceAmount}
                  style={{ cursor: 'pointer', display: 'inline-block' }}
                  onClick={() => {
                    setBudgetError(null);
                    setBudgetSavedMessage(null);
                    setNewBudgetValue(monthlyBudget ? String(monthlyBudget) : '');
                    setIsEditingBudget(true);
                  }}
                  title="Clicca per modificare"
                >
                  {monthlyBudget.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}
                  <span style={{ fontSize: '1rem', color: 'var(--color-gray-400)', marginLeft: '0.5rem', fontWeight: 'normal' }}>Modifica</span>
                </div>
                
                {monthlyBudget > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                      <span className="text-muted">Rimanente: <strong style={{color: remainingBudget < 0 ? 'var(--color-danger)' : 'inherit'}}>{remainingBudget.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}</strong></span>
                      <span className="text-muted">{Math.round(budgetPercentage)}% speso</span>
                    </div>
                    <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--color-gray-200)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(budgetPercentage, 100)}%`, height: '100%', backgroundColor: budgetColor, transition: 'width 0.3s ease' }}></div>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
          
          <div className={styles.monthlyStats}>
            <Card className={styles.statCard}>
              <div className="fs-sm text-muted">Spese Totali (Mese in corso)</div>
              <div style={{ color: 'var(--color-danger)', fontWeight: 'bold', fontSize: '1.25rem', marginTop: '0.5rem' }}>
                {monthlyExpense.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}
              </div>
            </Card>
          </div>
          
          <Card title="Avvisi Intelligenti" className="mt-4">
            {budgetPercentage > 100 ? (
              <p style={{color: 'var(--color-danger)', fontSize: '0.9rem', margin: 0}}>Attenzione: hai superato il tuo budget mensile di {(monthlyExpense - monthlyBudget).toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}!</p>
            ) : budgetPercentage > 80 ? (
              <p style={{color: 'var(--color-warning)', fontSize: '0.9rem', margin: 0}}>Attenzione: stai per esaurire il budget. Ti restano solo {remainingBudget.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}.</p>
            ) : monthlyBudget > 0 ? (
              <p style={{color: 'var(--color-success)', fontSize: '0.9rem', margin: 0}}>OK: sei perfettamente in linea con il tuo budget per questo mese.</p>
            ) : (
              <p className="text-muted fs-sm">Clicca su Modifica per impostare un budget mensile.</p>
            )}
          </Card>
        </div>

        {/* Right Column */}
        <div className={styles.rightCol}>
          <Card title="Ultime Transazioni">
            {!hasTransactions ? (
              <EmptyState 
                icon={<PlusCircle />}
                title="Nessuna transazione"
                description="Non hai ancora inserito spese o entrate. Aggiungi il tuo primo movimento per iniziare."
                actionText="Nuova Transazione"
                onAction={() => navigate('/transazioni/nuova')}
              />
            ) : (
              <div>
                {transactions.map(tx => (
                  <div key={tx.id} style={{display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid var(--color-gray-100)'}}>
                    <div>
                      <div><strong>{tx.description}</strong></div>
                      <div className="text-muted fs-sm">{new Date(tx.transaction_date).toLocaleDateString()} - {tx.categories?.name || 'Non classificato'}</div>
                      <div className="text-muted fs-sm">Caricata da account: {uploaderLabel(tx)}</div>
                    </div>
                    <div style={{color: tx.type === 'expense' ? 'var(--color-danger)' : 'var(--color-success)', fontWeight: 'bold', display: 'flex', alignItems: 'center'}}>
                      {tx.type === 'expense' ? '-' : '+'}{tx.amount.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}
                    </div>
                  </div>
                ))}
                <div className="mt-4 text-center">
                  <Link to="/transazioni" className="text-sm fw-medium" style={{color: 'var(--color-primary)'}}>Vedi tutte le transazioni &rarr;</Link>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
      
      {/* Charts Section below the grid */}
      {hasTransactions && (
        <ExpenseCharts transactions={transactions} />
      )}
    </div>
  );
};
