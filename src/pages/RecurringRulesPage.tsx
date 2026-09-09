import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useHousehold } from '../hooks';
import { ensureMonthlyRecurringTransactions } from '../lib/recurringTransactions';
import { formatCurrency } from '../lib/money';
import { toIsoDate } from '../lib/dates';
import { supabase } from '../lib/supabaseClient';
import { getTransactionFrequencyLabel, transactionFrequencyOptions } from '../lib/transactionFrequencies';
import { paymentMethodOptions } from '../lib/paymentTiming';
import type { PaymentMethod, RecurringRule, TransactionFrequency } from '../types/database';
import styles from './RecurringRulesPage.module.css';

const todayString = () => toIsoDate(new Date());

const endDateFromDuration = (startDate: string, durationMonths: number) => {
  if (!startDate || !Number.isInteger(durationMonths) || durationMonths <= 0) return null;
  const start = new Date(`${startDate}T00:00:00`);
  const targetMonth = start.getMonth() + durationMonths - 1;
  const lastDay = new Date(start.getFullYear(), targetMonth + 1, 0).getDate();
  const end = new Date(start.getFullYear(), targetMonth, Math.min(start.getDate(), lastDay));
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
};

const fixedExpenseReasons = [
  { value: 'financing', label: 'Finanziamento' },
  { value: 'tv_fee', label: 'Canone TV' },
  { value: 'phone_fee', label: 'Canone telefono' },
  { value: 'life_insurance', label: 'Assicurazione vita' },
  { value: 'rent', label: 'Affitto / locazione' },
  { value: 'mortgage', label: 'Mutuo' },
  { value: 'utilities', label: 'Utenza' },
  { value: 'subscription', label: 'Canone / abbonamento' },
  { value: 'other', label: 'Altro' },
];

export const RecurringRulesPage: React.FC = () => {
  const navigate = useNavigate();
  const { household, accounts, categories, subcategories } = useHousehold();
  const householdId = household?.id || null;
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('subscription');
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [startDate, setStartDate] = useState(todayString());
  const [frequency, setFrequency] = useState<TransactionFrequency>('monthly');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('standard');
  const [isShared, setIsShared] = useState(true);
  const [durationMonths, setDurationMonths] = useState('');
  const [notes, setNotes] = useState('');

  const expenseCategories = useMemo(
    () => categories.filter(category => category.type === 'expense').sort((a, b) => a.name.localeCompare(b.name)),
    [categories],
  );

  const availableSubcategories = useMemo(
    () => subcategories.filter(subcategory => subcategory.category_id === categoryId).sort((a, b) => a.name.localeCompare(b.name)),
    [categoryId, subcategories],
  );

  const categoryName = (id?: string | null) => categories.find(category => category.id === id)?.name || 'Non classificata';
  const subcategoryName = (id?: string | null) => subcategories.find(subcategory => subcategory.id === id)?.name || '';
  const accountName = (id?: string | null) => accounts.find(account => account.id === id)?.name || 'Conto principale';
  const reasonName = (code?: string | null) => fixedExpenseReasons.find(option => option.value === code)?.label || null;
  const calculatedEndDate = useMemo(() => {
    const months = Number(durationMonths);
    return Number.isInteger(months) && months > 0 ? endDateFromDuration(startDate, months) : null;
  }, [durationMonths, startDate]);

  const syncCurrentMonth = useCallback(async () => {
    if (!householdId) return;
    const now = new Date();
    await ensureMonthlyRecurringTransactions({
      householdId,
      accounts,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    });
  }, [accounts, householdId]);

  const fetchRules = useCallback(async () => {
    if (!householdId) return;

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('recurring_rules')
        .select('*')
        .eq('household_id', householdId)
        .order('is_active', { ascending: false })
        .order('description');

      if (fetchError) throw fetchError;
      setRules((data || []) as RecurringRule[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare le spese fisse.');
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchRules(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchRules]);

  const resetForm = () => {
    setEditingRuleId(null);
    setDescription('');
    setReason('subscription');
    setMerchant('');
    setAmount('');
    setCategoryId('');
    setSubcategoryId('');
    setStartDate(todayString());
    setFrequency('monthly');
    setPaymentMethod('standard');
    setIsShared(true);
    setDurationMonths('');
    setNotes('');
  };

  const handleEditRule = (rule: RecurringRule) => {
    setEditingRuleId(rule.id);
    setDescription(rule.description || '');
    setReason(rule.reason_code || 'other');
    setMerchant(rule.merchant || '');
    setAmount(String(Number(rule.amount || 0)));
    setAccountId(rule.account_id || accounts[0]?.id || '');
    setCategoryId(rule.category_id || '');
    setSubcategoryId(rule.subcategory_id || '');
    setStartDate(rule.start_date);
    setFrequency((rule.frequency || 'monthly') as TransactionFrequency);
    setPaymentMethod(rule.payment_method || 'standard');
    setIsShared(rule.is_shared !== false);
    setDurationMonths(rule.duration_months ? String(rule.duration_months) : '');
    setNotes(rule.notes || '');
    setMessage(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveRule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!householdId) return;

    const parsedAmount = Number(amount.replace(',', '.'));
    const reasonLabel = fixedExpenseReasons.find(option => option.value === reason)?.label || '';
    const finalDescription = description.trim() || reasonLabel;
    const parsedDuration = durationMonths ? Number(durationMonths) : null;

    if (!reason || !categoryId || !description.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Inserisci nome, tipo, categoria e importo dell abbonamento.');
      return;
    }
    if (parsedDuration !== null && (!Number.isInteger(parsedDuration) || parsedDuration <= 0)) {
      setError('La durata deve essere espressa con un numero intero di mesi maggiore di zero.');
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const payload = {
        account_id: accountId || accounts[0]?.id || null,
        type: 'expense' as const,
        description: finalDescription,
        merchant: merchant.trim() || null,
        amount: parsedAmount,
        category_id: categoryId || null,
        subcategory_id: subcategoryId || null,
        frequency,
        payment_method: paymentMethod,
        is_shared: isShared,
        reason_code: reason,
        duration_months: parsedDuration,
        start_date: startDate,
        end_date: calculatedEndDate,
        next_due_date: startDate,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (editingRuleId) {
        const { error: updateError } = await supabase
          .from('recurring_rules')
          .update(payload)
          .eq('id', editingRuleId)
          .eq('household_id', householdId);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('recurring_rules')
          .insert([{
            ...payload,
            household_id: householdId,
            is_active: true,
          }]);
        if (insertError) throw insertError;
      }

      const wasEditing = Boolean(editingRuleId);
      resetForm();
      await syncCurrentMonth();
      await fetchRules();
      setMessage(wasEditing
        ? 'Abbonamento modificato. Le prossime scadenze useranno i nuovi dati.'
        : 'Abbonamento salvato. La spesa verrà aggiunta automaticamente alla data prevista.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile salvare la spesa fissa.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (rule: RecurringRule) => {
    if (!householdId) return;

    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const { error: updateError } = await supabase
        .from('recurring_rules')
        .update({ is_active: !rule.is_active, updated_at: new Date().toISOString() })
        .eq('id', rule.id)
        .eq('household_id', householdId);

      if (updateError) throw updateError;
      await syncCurrentMonth();
      await fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile aggiornare la spesa fissa.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (rule: RecurringRule) => {
    if (!householdId) return;
    if (!window.confirm(`Eliminare la spesa fissa "${rule.description}"?\n\nLe transazioni gia generate resteranno salvate.`)) return;

    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('recurring_rules')
        .delete()
        .eq('id', rule.id)
        .eq('household_id', householdId);

      if (deleteError) throw deleteError;
      if (editingRuleId === rule.id) resetForm();
      await syncCurrentMonth();
      await fetchRules();
      setMessage('Regola eliminata. Le transazioni gia generate restano nello storico.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile eliminare la spesa fissa.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Button variant="ghost" icon={<ArrowLeft size={18} />} onClick={() => navigate('/impostazioni')}>
          Indietro
        </Button>
        <div>
          <h1 className={styles.title}>Abbonamenti</h1>
          <p className="text-muted">Netflix, internet, palestra e altre spese che Contotron registra automaticamente alla data prevista.</p>
        </div>
      </header>

      <div className={styles.grid}>
        <Card title={editingRuleId ? 'Modifica abbonamento' : 'Nuovo abbonamento'} icon={editingRuleId ? <Pencil size={20} /> : <Plus size={20} />}>
          <form
            className={styles.form}
            onSubmit={handleSaveRule}
            onKeyDown={event => {
              const target = event.target as HTMLElement;
              if (event.key === 'Enter' && target.tagName !== 'TEXTAREA' && target.tagName !== 'BUTTON') {
                event.preventDefault();
              }
            }}
          >
            {message && <div className={`${styles.message} ${styles.success}`}>{message}</div>}
            {error && <div className={`${styles.message} ${styles.error}`}>{error}</div>}

            <div className={styles.monthlyTagInfo}>
              <strong>INSERIMENTO AUTOMATICO</strong>
              <span>La voce entra nelle transazioni soltanto quando arriva la scadenza impostata e non viene mai duplicata.</span>
            </div>

            <div className={styles.formGroup}>
              <label>Tipo di abbonamento o spesa</label>
              <select className={styles.select} value={reason} onChange={event => setReason(event.target.value)} required>
                <option value="">Seleziona tipo...</option>
                {fixedExpenseReasons.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label>Nome / descrizione</label>
              <input
                className={styles.input}
                value={description}
                onChange={event => setDescription(event.target.value)}
                placeholder="es. Netflix, fibra internet, palestra..."
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label>Esercente / riferimento</label>
              <input className={styles.input} value={merchant} onChange={event => setMerchant(event.target.value)} placeholder="es. Banca, palestra, abbonamento" />
            </div>

            <div className={styles.formGroup}>
              <label>Importo mensile</label>
              <input className={styles.input} type="number" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" required />
            </div>

            <div className={styles.formGroup}>
              <label>Conto</label>
              <select className={styles.select} value={accountId || accounts[0]?.id || ''} onChange={event => setAccountId(event.target.value)}>
                {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label>Categoria</label>
              <select className={styles.select} value={categoryId} onChange={event => {
                setCategoryId(event.target.value);
                setSubcategoryId('');
              }} required>
                <option value="">Seleziona categoria...</option>
                {expenseCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </div>

            {availableSubcategories.length > 0 && (
              <div className={styles.formGroup}>
                <label>Sottocategoria</label>
                <select className={styles.select} value={subcategoryId} onChange={event => setSubcategoryId(event.target.value)}>
                  <option value="">Nessuna sottocategoria</option>
                  {availableSubcategories.map(subcategory => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}
                </select>
              </div>
            )}

            <div className={styles.formGroup}>
              <label>Prima data di competenza</label>
              <input className={styles.input} type="date" value={startDate} onChange={event => setStartDate(event.target.value)} required />
            </div>

            <div className={styles.formGroup}>
              <label>Cadenza</label>
              <select className={styles.select} value={frequency} onChange={event => setFrequency(event.target.value as TransactionFrequency)}>
                {transactionFrequencyOptions
                  .filter(option => option.value !== 'other')
                  .map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label>Tipologia pagamento</label>
              <select className={styles.select} value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as PaymentMethod)}>
                {paymentMethodOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>

            <label className={`${styles.personalToggle} ${!isShared ? styles.personalToggleActive : ''}`}>
              <input type="checkbox" checked={!isShared} onChange={event => setIsShared(!event.target.checked)} />
              <span>
                <strong>Abbonamento personale</strong>
                <small>Non inserire le spese generate nello Split familiare</small>
              </span>
            </label>

            <div className={styles.formGroup}>
              <label>Durata in mesi (opzionale)</label>
              <input
                className={styles.input}
                type="number"
                min="1"
                step="1"
                value={durationMonths}
                onChange={event => setDurationMonths(event.target.value)}
                placeholder="es. 36"
              />
              <small className="text-muted">
                {calculatedEndDate
                  ? `Ultima scadenza: ${new Date(`${calculatedEndDate}T00:00:00`).toLocaleDateString('it-IT')}`
                  : 'Lascia vuoto per una spesa senza scadenza.'}
              </small>
            </div>

            <div className={styles.formGroup}>
              <label>Note</label>
              <textarea className={styles.textarea} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Promemoria interno opzionale" />
            </div>

            <div className={styles.formActions}>
              <Button type="submit" disabled={saving}>
                {saving ? 'Salvataggio...' : editingRuleId ? 'Salva modifiche' : 'Salva abbonamento'}
              </Button>
              {editingRuleId && (
                <Button type="button" variant="secondary" onClick={resetForm} disabled={saving}>
                  Annulla modifica
                </Button>
              )}
            </div>
          </form>
        </Card>

        <Card title="Abbonamenti salvati">
          {loading ? (
            <div className={styles.empty}>Caricamento...</div>
          ) : rules.length === 0 ? (
            <div className={styles.empty}>Nessun abbonamento configurato.</div>
          ) : (
            <div className={styles.rulesList}>
              {rules.map(rule => (
                <article key={rule.id} className={styles.ruleCard}>
                  <div className={styles.ruleHeader}>
                    <div>
                      <span className={styles.monthlyTag}>{getTransactionFrequencyLabel(rule.frequency).toUpperCase()}</span>
                      <div className={styles.ruleTitle}>{rule.description}</div>
                      <div className={styles.ruleMeta}>
                        {getTransactionFrequencyLabel(rule.frequency)} dal {new Date(`${rule.start_date}T00:00:00`).toLocaleDateString('it-IT')}
                        {rule.end_date ? ` al ${new Date(`${rule.end_date}T00:00:00`).toLocaleDateString('it-IT')}` : ' senza scadenza'}
                        {' - '}
                        {categoryName(rule.category_id)}
                        {rule.subcategory_id ? ` / ${subcategoryName(rule.subcategory_id)}` : ''}
                        {' - '}
                        {accountName(rule.account_id)}
                      </div>
                      {reasonName(rule.reason_code) && (
                        <div className={styles.ruleMeta}>Tipo: {reasonName(rule.reason_code)}</div>
                      )}
                      {rule.notes && <div className={styles.ruleMeta}>{rule.notes}</div>}
                      <div className={styles.ruleMeta}>{rule.is_shared === false ? 'Personale · escluso dallo Split' : 'Familiare · incluso nello Split'}</div>
                      {rule.next_due_date && rule.is_active && <div className={styles.ruleMeta}>Prossima scadenza: {new Date(`${rule.next_due_date}T00:00:00`).toLocaleDateString('it-IT')}</div>}
                      {!rule.is_active && <div className={styles.ruleMeta}>Disattivata</div>}
                    </div>
                    <div className={styles.ruleAmount}>
                      {formatCurrency(rule.amount, household?.currency || 'EUR')}
                    </div>
                  </div>
                  <div className={styles.ruleActions}>
                    <Button variant="secondary" size="sm" icon={<Pencil size={14} />} onClick={() => handleEditRule(rule)} disabled={saving}>
                      Modifica
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleToggleActive(rule)} disabled={saving}>
                      {rule.is_active ? 'Disattiva' : 'Riattiva'}
                    </Button>
                    <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => handleDeleteRule(rule)} disabled={saving}>
                      Elimina
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
