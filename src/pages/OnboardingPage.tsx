import React, { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks';
import {
  documentStorageDescriptions,
  documentStorageLabels,
  saveDocumentStoragePreference,
} from '../lib/documentStoragePreference';
import { requestGoogleDriveConnection } from '../lib/googleDriveStorage';
import type { DocumentStorageProvider } from '../types/database';
import styles from './OnboardingPage.module.css';

export const OnboardingPage: React.FC = () => {
  const [step, setStep] = useState(1);
  const [groupName, setGroupName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [initialBalance, setInitialBalance] = useState('');
  const [useTemplate, setUseTemplate] = useState(true);
  const [documentStorageProvider, setDocumentStorageProvider] = useState<DocumentStorageProvider>('supabase');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { user } = useAuth();

  const handleComplete = async () => {
    if (!user) {
      setError('Utente non autenticato');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Create Household
      const { data: household, error: householdError } = await supabase
        .from('households')
        .insert([{ name: groupName, currency, created_by: user.id }])
        .select()
        .single();

      if (householdError) throw householdError;

      // 2. Add member (owner)
      const { error: memberError } = await supabase
        .from('household_members')
        .insert([{ household_id: household.id, user_id: user.id, role: 'owner' }]);

      if (memberError) throw memberError;

      await saveDocumentStoragePreference(household.id, documentStorageProvider);

      // 3. Create single account automatically
      const { error: accountError } = await supabase
        .from('accounts')
        .insert([{
          household_id: household.id,
          name: 'Conto Principale',
          type: 'current_account',
          opening_balance: parseFloat(initialBalance) || 0
        }]);

      if (accountError) throw accountError;

      // 4. (Optional) Template Categories
      if (useTemplate) {
        await supabase.from('categories').insert([
          { household_id: household.id, name: 'Alimentari', type: 'expense', sort_order: 1 },
          { household_id: household.id, name: 'Abitazione', type: 'expense', sort_order: 2 },
          { household_id: household.id, name: 'Abitazione Numana', type: 'expense', sort_order: 3 },
          { household_id: household.id, name: 'Trasporti', type: 'expense', sort_order: 4 },
          { household_id: household.id, name: 'Abbigliamento', type: 'expense', sort_order: 5 },
          { household_id: household.id, name: 'Tempo libero', type: 'expense', sort_order: 6 },
          { household_id: household.id, name: 'Figli', type: 'expense', sort_order: 7 },
          { household_id: household.id, name: 'Cura della persona', type: 'expense', sort_order: 8 },
          { household_id: household.id, name: 'Assicurazione', type: 'expense', sort_order: 9 },
          { household_id: household.id, name: 'Imposte', type: 'expense', sort_order: 10 },
          { household_id: household.id, name: 'Regali e beneficenza', type: 'expense', sort_order: 11 },
          { household_id: household.id, name: 'Risparmi', type: 'expense', sort_order: 12 },
          { household_id: household.id, name: 'Prestiti', type: 'expense', sort_order: 13 }
        ]);
      }

      if (documentStorageProvider === 'google_drive') {
        const { error: driveOAuthError } = await requestGoogleDriveConnection(`${window.location.origin}/impostazioni?connectDrive=1`);
        if (driveOAuthError) throw driveOAuthError;
        return;
      }

      // Reload to let HouseholdProvider fetch data
      window.location.href = '/';

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Errore durante il salvataggio');
      setLoading(false);
    }
  };

  return (
    <div className={styles.onboardingContainer}>
      <Card className={styles.onboardingCard}>
        {error && <div className="error-banner mb-4" style={{color: 'red', textAlign: 'center'}}>{error}</div>}

        {/* Step indicator */}
        <div className={styles.stepIndicator}>
          <div className={`${styles.stepDot} ${step >= 1 ? styles.stepActive : ''}`}>1</div>
          <div className={styles.stepLine} />
          <div className={`${styles.stepDot} ${step >= 2 ? styles.stepActive : ''}`}>2</div>
          <div className={styles.stepLine} />
          <div className={`${styles.stepDot} ${step >= 3 ? styles.stepActive : ''}`}>3</div>
        </div>

        {step === 1 && (
          <div className={styles.stepContent}>
            <h2>Crea il tuo Gruppo</h2>
            <p className="text-muted">Dai un nome al tuo nucleo familiare o alla tua gestione personale.</p>
            <div className={styles.formGroup}>
              <label>Nome Gruppo</label>
              <input type="text" value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="es. Famiglia Rossi" className={styles.input} />
            </div>
            <div className={styles.formGroup}>
              <label>Valuta Predefinita</label>
              <select className={styles.input} value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="EUR">Euro (EUR)</option>
                <option value="USD">Dollaro ($)</option>
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Saldo Iniziale del Conto (opzionale)</label>
              <input type="number" step="0.01" value={initialBalance} onChange={e => setInitialBalance(e.target.value)} placeholder="0.00" className={styles.input} />
              <span className="text-muted fs-sm">Il saldo attuale del tuo conto corrente principale.</span>
            </div>
            <Button onClick={() => setStep(2)} className="mt-4" disabled={!groupName}>Continua</Button>
          </div>
        )}

        {step === 2 && (
          <div className={styles.stepContent}>
            <h2>Categorie di Spesa</h2>
            <p className="text-muted">Vuoi partire da un template generico?</p>
            <div className={styles.options}>
              <label className={styles.radioOption}>
                <input type="radio" name="categories" checked={useTemplate} onChange={() => setUseTemplate(true)} />
                <div>
                  <strong>Usa Template Generico</strong>
                  <div className="fs-sm text-muted">Alimentari, Abitazione, Trasporti, Abbigliamento, Tempo libero, ecc.</div>
                </div>
              </label>
              <label className={styles.radioOption}>
                <input type="radio" name="categories" checked={!useTemplate} onChange={() => setUseTemplate(false)} />
                <div>
                  <strong>Inizia da Zero</strong>
                  <div className="fs-sm text-muted">Aggiungero' le categorie manualmente.</div>
                </div>
              </label>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <Button variant="secondary" onClick={() => setStep(1)}>Indietro</Button>
              <Button onClick={() => setStep(3)} style={{ flex: 1 }}>
                Continua
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className={styles.stepContent}>
            <h2>Archivio documenti</h2>
            <p className="text-muted">Scegli dove salvare scontrini, bollette e foto della famiglia.</p>
            <div className={styles.options}>
              {(['supabase', 'google_drive'] as DocumentStorageProvider[]).map(provider => (
                <label key={provider} className={styles.radioOption}>
                  <input
                    type="radio"
                    name="documentStorage"
                    checked={documentStorageProvider === provider}
                    onChange={() => setDocumentStorageProvider(provider)}
                  />
                  <div>
                    <strong>{documentStorageLabels[provider]}</strong>
                    <div className="fs-sm text-muted">{documentStorageDescriptions[provider]}</div>
                    {provider === 'google_drive' && (
                      <div className={styles.optionNote}>Dopo il setup collegheremo Google Drive dal pannello impostazioni.</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <Button variant="secondary" onClick={() => setStep(2)}>Indietro</Button>
              <Button onClick={handleComplete} disabled={loading} style={{ flex: 1 }}>
                {loading ? 'Creazione in corso...' : 'Completa Setup'}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
