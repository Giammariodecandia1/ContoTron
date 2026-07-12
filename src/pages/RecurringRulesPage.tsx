import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useHousehold } from '../hooks';
import { supabase } from '../lib/supabaseClient';
import type { RecurringRule } from '../types/database';
import styles from './RecurringRulesPage.module.css';

const todayString = () => new Date().toISOString().split('T')[0];

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

  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [startDate, setStartDate] = useState(todayString());
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
    setDescription('');
    setReason('');
    setMerchant('');
    setAmount('');
    setCategoryId('');
    setSubcategoryId('');
    setStartDate(todayString());
    setNotes('');
  };

  const handleCreateRule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!householdId) return;

    const parsedAmount = Number(amount.replace(',', '.'));
    const reasonLabel = fixedExpenseReasons.find(option => option.value === reason)?.label || '';
    const finalDescription = reason === 'other'
      ? description.trim()
      : [reasonLabel, description.trim()].filter(Boolean).join(' - ');

    if (!reason || !finalDescription || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Seleziona una motivazione e inserisci un importo valido. Per Altro specifica il dettaglio.');
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const { error: insertError } = await supabase
        .from('recurring_rules')
        .insert([{
          household_id: householdId,
          account_id: accountId || accounts[0]?.id || null,
          type: 'expense',
          description: finalDescription,
          merchant: merchant.trim() || null,
          amount: parsedAmount,
          category_id: categoryId || null,
          subcategory_id: subcategoryId || null,
          frequency: 'monthly',
          start_date: startDate,
          next_due_date: startDate,
          is_active: true,
          notes: notes.trim() || null,
        }]);

      if (insertError) throw insertError;
      resetForm();
      await fetchRules();
      setMessage('Spesa fissa salvata. Dal prossimo caricamento del budget mensile verra generata automaticamente.');
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
          <h1 className={styles.title}>Spese fisse</h1>
          <p className="text-muted">Canoni, finanziamenti e uscite mensili che devono risultare gia impegnate a inizio mese.</p>
        </div>
      </header>

      <div className={styles.grid}>
        <Card title="Nuova spesa fissa" icon={<Plus size={20} />}>
          <form className={styles.form} onSubmit={handleCreateRule}>
            {message && <div className={`${styles.message} ${styles.success}`}>{message}</div>}
            {error && <div className={`${styles.message} ${styles.error}`}>{error}</div>}

            <div className={styles.formGroup}>
              <label>Motivazione</label>
              <select className={styles.select} value={reason} onChange={event => setReason(event.target.value)} required>
                <option value="">Seleziona motivazione...</option>
                {fixedExpenseReasons.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label>{reason === 'other' ? 'Descrizione obbligatoria' : 'Dettaglio opzionale'}</label>
              <input
                className={styles.input}
                value={description}
                onChange={event => setDescription(event.target.value)}
                placeholder={reason === 'other' ? 'Descrivi la spesa fissa' : 'es. Auto, operatore, numero polizza...'}
                required={reason === 'other'}
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
              }}>
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
              <label>Note</label>
              <textarea className={styles.textarea} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Promemoria interno opzionale" />
            </div>

            <Button type="submit" disabled={saving}>
              {saving ? 'Salvataggio...' : 'Salva spesa fissa'}
            </Button>
          </form>
        </Card>

        <Card title="Spese fisse salvate">
          {loading ? (
            <div className={styles.empty}>Caricamento...</div>
          ) : rules.length === 0 ? (
            <div className={styles.empty}>Nessuna spesa fissa configurata.</div>
          ) : (
            <div className={styles.rulesList}>
              {rules.map(rule => (
                <article key={rule.id} className={styles.ruleCard}>
                  <div className={styles.ruleHeader}>
                    <div>
                      <div className={styles.ruleTitle}>{rule.description}</div>
                      <div className={styles.ruleMeta}>
                        Mensile dal {new Date(`${rule.start_date}T00:00:00`).toLocaleDateString('it-IT')}
                        {' - '}
                        {categoryName(rule.category_id)}
                        {rule.subcategory_id ? ` / ${subcategoryName(rule.subcategory_id)}` : ''}
                        {' - '}
                        {accountName(rule.account_id)}
                      </div>
                      {rule.notes && <div className={styles.ruleMeta}>{rule.notes}</div>}
                      {!rule.is_active && <div className={styles.ruleMeta}>Disattivata</div>}
                    </div>
                    <div className={styles.ruleAmount}>
                      {rule.amount.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}
                    </div>
                  </div>
                  <div className={styles.ruleActions}>
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
