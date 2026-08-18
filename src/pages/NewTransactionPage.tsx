import React, { useEffect, useRef, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth, useHousehold, useTransactions, useViewMode } from '../hooks';
import { supabase } from '../lib/supabaseClient';
import { getCashImpactDate, paymentMethodOptions } from '../lib/paymentTiming';
import { transactionFrequencyOptions } from '../lib/transactionFrequencies';
import { saveProductClassificationRules } from '../lib/productLearning';
import { toIsoDate } from '../lib/dates';
import type { PaymentMethod, Transaction, TransactionFrequency, TransactionType } from '../types/database';
import styles from './NewTransactionPage.module.css';

interface TransactionFormState {
  type?: TransactionType;
  amount?: string;
  date?: string;
  categoryId?: string;
  subcategoryId?: string;
  merchant?: string;
  description?: string;
  notes?: string;
  paymentMethod?: PaymentMethod;
  frequency?: TransactionFrequency;
  isShared?: boolean;
  documentId?: string;
  items?: Array<{
    description: string;
    amount: number;
    categoryId?: string;
    subcategoryId?: string;
  }>;
}

export const NewTransactionPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { transactionId } = useParams();
  const { household, accounts, categories, subcategories } = useHousehold();
  const { user } = useAuth();
  const { isSimple } = useViewMode();
  const { addTransaction, addTransactionWithItems, updateTransaction, loading } = useTransactions();
  const initialState = (location.state || {}) as TransactionFormState;
  const isEditMode = Boolean(transactionId);
  const householdId = household?.id || null;

  const [amount, setAmount] = useState(initialState.amount || '');
  const [transactionType, setTransactionType] = useState<TransactionType>(initialState.type || 'expense');
  const [date, setDate] = useState(initialState.date || toIsoDate(new Date()));
  const [categoryId, setCategoryId] = useState(initialState.categoryId || '');
  const [subcategoryId, setSubcategoryId] = useState(initialState.subcategoryId || '');
  const [merchant, setMerchant] = useState(initialState.merchant || '');
  const [description, setDescription] = useState(initialState.description || '');
  const [notes, setNotes] = useState(initialState.notes || '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initialState.paymentMethod || 'standard');
  const [frequency, setFrequency] = useState<TransactionFrequency | ''>(initialState.frequency || 'other');
  const [isShared, setIsShared] = useState(initialState.isShared ?? true);
  const [accountId, setAccountId] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submissionInFlightRef = useRef(false);

  const filteredCategories = categories.filter(c => c.type === transactionType);
  const filteredSubcategories = subcategories.filter(s => s.category_id === categoryId);

  const changeTransactionType = (nextType: TransactionType) => {
    if (nextType === transactionType) return;

    setTransactionType(nextType);
    setCategoryId('');
    setSubcategoryId('');
    if (nextType === 'income') setPaymentMethod('standard');
  };

  useEffect(() => {
    if (!isEditMode || !transactionId || !householdId) return;

    const loadTransaction = async () => {
      setEditLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', transactionId)
        .eq('household_id', householdId)
        .single();

      if (fetchError || !data) {
        setError(fetchError?.message || 'Transazione non trovata');
        setEditLoading(false);
        return;
      }

      setAmount(String(data.amount || ''));
      setTransactionType(data.type || 'expense');
      setDate(data.transaction_date || toIsoDate(new Date()));
      setCategoryId(data.category_id || '');
      setSubcategoryId(data.subcategory_id || '');
      setMerchant(data.merchant || '');
      setDescription(data.description || '');
      setNotes(data.notes || '');
      setPaymentMethod(data.payment_method || 'standard');
      setFrequency(data.frequency || 'other');
      setIsShared(data.is_shared !== false);
      setAccountId(data.account_id || '');
      setEditLoading(false);
    };

    loadTransaction();
  }, [householdId, isEditMode, transactionId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submissionInFlightRef.current) return;
    setError(null);

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Inserire un importo valido');
      return;
    }

    const selectedAccountId = accountId || accounts[0]?.id;
    if (!selectedAccountId) {
      setError("Nessun conto disponibile. Si e' verificato un errore di sistema.");
      return;
    }

    const effectiveFrequency = frequency || 'other';

    const txData: Partial<Transaction> = {
      type: transactionType,
      amount: amountNum,
      transaction_date: date,
      account_id: selectedAccountId,
      category_id: categoryId || null,
      subcategory_id: subcategoryId || null,
      merchant: merchant || null,
      description,
      notes: notes.trim() || null,
      payment_method: transactionType === 'expense' ? paymentMethod : 'standard',
      cash_impact_date: transactionType === 'expense' ? getCashImpactDate(date, paymentMethod) : date,
      frequency: effectiveFrequency,
      is_shared: transactionType === 'expense' ? isShared : true,
    };

    const itemRows = !isEditMode && initialState.items?.length && household
      ? initialState.items
        .filter(item => item.description && Number.isFinite(item.amount) && item.amount > 0)
        .map(item => ({
          description: item.description,
          amount: item.amount,
          category_id: item.categoryId || categoryId || null,
          subcategory_id: item.subcategoryId || null,
          is_confirmed: true,
        }))
      : [];

    const createPayload = {
      ...txData,
      document_id: initialState.documentId || null,
      source: initialState.documentId ? 'receipt_ocr' as const : 'manual' as const,
    };

    submissionInFlightRef.current = true;
    const res = isEditMode && transactionId
      ? await updateTransaction(transactionId, txData)
      : itemRows.length > 0
        ? await addTransactionWithItems(createPayload, itemRows)
        : await addTransaction(createPayload);

    if (res && itemRows.length > 0 && household) {
      await saveProductClassificationRules({
        householdId: household.id,
        userId: user?.id || null,
        products: itemRows.map(item => ({
          description: item.description,
          categoryId: item.category_id,
          subcategoryId: item.subcategory_id,
        })),
      }).catch(classificationError => console.warn('Apprendimento prodotti non completato:', classificationError));
    }

    if (res) {
      navigate('/transazioni', {
        state: {
          createdTransactionId: res.id,
          notice: isEditMode ? 'Modifiche salvate correttamente.' : 'Transazione salvata correttamente.',
        },
      });
    } else {
      setError(isEditMode ? 'Errore durante il salvataggio delle modifiche' : 'Errore durante il salvataggio');
    }
    submissionInFlightRef.current = false;
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Button variant="ghost" icon={<ArrowLeft size={18} />} onClick={() => navigate(-1)}>
          Indietro
        </Button>
        <h1 className={styles.title}>{isEditMode ? 'Modifica Transazione' : 'Nuova Transazione'}</h1>
      </header>

      <Card className={styles.formCard}>
        {error && <div style={{ color: 'red', marginBottom: '1rem', textAlign: 'center' }}>{error}</div>}
        {editLoading ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>Caricamento transazione...</div>
        ) : (
          <form onSubmit={handleSubmit} className={styles.form}>
            {isSimple && (
              <div className={styles.simpleNotice}>
                <strong>Inserimento semplice</strong>
                <span>Categoria e sottocategoria non sono obbligatorie. Potrai aggiungerle passando alla modalità completa.</span>
              </div>
            )}
            <div className={styles.typeSelector} role="group" aria-label="Tipo transazione">
              <button
                type="button"
                className={`${styles.typeButton} ${transactionType === 'expense' ? styles.activeExpense : ''}`}
                onClick={() => changeTransactionType('expense')}
              >
                Uscita
              </button>
              <button
                type="button"
                className={`${styles.typeButton} ${transactionType === 'income' ? styles.activeIncome : ''}`}
                onClick={() => changeTransactionType('income')}
              >
                Entrata
              </button>
            </div>

            <div className={styles.formGroup}>
              <label>{transactionType === 'expense' ? 'Importo spesa' : 'Importo entrata'}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="number" step="0.01" required className={styles.inputLg} placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
                <span style={{ fontSize: '1.25rem', color: 'var(--text-muted)' }}>{household?.currency === 'USD' ? '$' : 'EUR'}</span>
              </div>
            </div>

            <div className={styles.formGroup}>
              <label>Data</label>
              <input type="date" required className={styles.input} value={date} onChange={e => setDate(e.target.value)} />
            </div>

            {transactionType === 'expense' && !isSimple && (
              <div className={styles.formGroup}>
                <label>Tipologia pagamento</label>
                <select className={styles.input} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}>
                  {paymentMethodOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {paymentMethod === 'credit_card' && (
                  <small className={styles.helpText}>
                    La spesa resta datata {date}, ma riduce la disponibilita dal {getCashImpactDate(date, paymentMethod)}.
                  </small>
                )}
              </div>
            )}

            {!isSimple && (
              <div className={styles.formGroup}>
                <label>Frequenza dell'operazione (facoltativa)</label>
                <select
                  className={styles.input}
                  value={frequency}
                  onChange={event => setFrequency(event.target.value as TransactionFrequency)}
                >
                  <option value="">Seleziona frequenza...</option>
                  {transactionFrequencyOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <small className={styles.helpText}>Facoltativa: se non la modifichi, la transazione resta classificata come occasionale.</small>
              </div>
            )}

            {accounts.length > 1 && (
              <div className={styles.formGroup}>
                <label>Conto</label>
                <select required className={styles.input} value={accountId || accounts[0]?.id || ''} onChange={e => setAccountId(e.target.value)}>
                  {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </div>
            )}

            {!isSimple && (
              <>
                <div className={styles.formGroup}>
                  <label>Categoria</label>
                  <select required={transactionType === 'expense'} className={styles.input} value={categoryId} onChange={e => {
                    setCategoryId(e.target.value);
                    setSubcategoryId('');
                  }}>
                    <option value="">{transactionType === 'expense' ? 'Seleziona categoria...' : 'Nessuna categoria entrata'}</option>
                    {filteredCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                {filteredSubcategories.length > 0 && (
                  <div className={styles.formGroup}>
                    <label>Sottocategoria (Opzionale)</label>
                    <select className={styles.input} value={subcategoryId} onChange={e => setSubcategoryId(e.target.value)}>
                      <option value="">Nessuna sottocategoria</option>
                      {filteredSubcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}

                <div className={styles.formGroup}>
                  <label>Esercente (Negozio, Sito web...)</label>
                  <input type="text" className={styles.input} placeholder="es. Conad, Amazon..." value={merchant} onChange={e => setMerchant(e.target.value)} />
                </div>
              </>
            )}

            <div className={styles.formGroup}>
              <label>{isSimple ? 'Descrizione breve' : 'Descrizione'}</label>
              <input type="text" required className={styles.input} placeholder="es. Spesa settimanale..." value={description} onChange={e => setDescription(e.target.value)} />
            </div>

            {transactionType === 'expense' && (
              <label className={`${styles.personalToggle} ${!isShared ? styles.personalToggleActive : ''}`}>
                <input
                  type="checkbox"
                  checked={!isShared}
                  onChange={event => setIsShared(!event.target.checked)}
                />
                <span>
                  <strong>Acquisto personale</strong>
                  <small>Non inserire questa spesa nello Split familiare</small>
                </span>
              </label>
            )}

            {!isSimple && (
              <div className={styles.formGroup}>
                <label>Commento / promemoria</label>
                <textarea
                  className={styles.textarea}
                  placeholder="es. Da ricordare, dettaglio non previsto, motivo della spesa..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                />
              </div>
            )}

            <Button type="submit" size="lg" className="mt-4" disabled={loading}>
              {loading ? 'Salvataggio...' : isEditMode ? 'Salva Modifiche' : 'Salva Transazione'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
};
