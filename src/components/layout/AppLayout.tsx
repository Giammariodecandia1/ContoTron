import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus, Sparkles, Upload, X } from 'lucide-react';
import { ContotronBrand } from '../brand/ContotronBrand';
import { MobileNavigation, Sidebar } from './Sidebar';
import { useAuth, useHousehold, useViewMode } from '../../hooks';
import { ensureMonthlyRecurringTransactions } from '../../lib/recurringTransactions';
import { supabase } from '../../lib/supabaseClient';
import styles from './AppLayout.module.css';

interface AppLayoutProps {
  children: React.ReactNode;
}

// Change this identifier only when publishing a new user-facing change note.
// It keeps the notice independent for every account and never blocks the app.
const releaseNoteId = '2026-09-drive-only-transition';

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { user } = useAuth();
  const { isSimple } = useViewMode();
  const { household, accounts } = useHousehold();
  const householdId = household?.id || null;
  const userId = user?.id || null;
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const storageKey = `contotron_release_note:${releaseNoteId}:${userId}`;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (window.localStorage.getItem(storageKey) === 'seen') return;
        } catch { /* Continue with the server-side check. */ }
        const { data, error } = await supabase.from('release_note_receipts')
          .select('seen_at')
          .eq('user_id', userId)
          .eq('release_id', releaseNoteId)
          .maybeSingle();
        if (!error && data) {
          try { window.localStorage.setItem(storageKey, 'seen'); } catch { /* Optional cache. */ }
          return;
        }
        if (!cancelled) setShowReleaseNotes(true);
      })();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [userId]);

  const dismissReleaseNotes = () => {
    if (user?.id) {
      try {
        window.localStorage.setItem(`contotron_release_note:${releaseNoteId}:${user.id}`, 'seen');
      } catch {
        // The dialog may reappear only if browser storage is unavailable.
      }
      void supabase.from('release_note_receipts').upsert({
        user_id: user.id,
        release_id: releaseNoteId,
        seen_at: new Date().toISOString(),
      }, { onConflict: 'user_id,release_id' });
    }
    setShowReleaseNotes(false);
  };

  useEffect(() => {
    if (!householdId) return;
    const now = new Date();
    void ensureMonthlyRecurringTransactions({
      householdId,
      accounts,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    }).catch(error => {
      console.error('Impossibile sincronizzare le spese fisse del mese:', error);
    });
  }, [accounts, householdId]);

  return (
    <div className={styles.appContainer}>
      <Sidebar />
      <main className={styles.mainContent}>
        <header className={styles.mobileTopBar}>
          <div>
            <ContotronBrand size="small" />
            {user?.display_name && <div className={styles.mobileUser}>{user.display_name}</div>}
          </div>
          <Link to={isSimple ? '/transazioni/nuova' : '/scan'} className={styles.mobileScanButton}>
            {isSimple ? <Plus size={18} /> : <Upload size={18} />}
            <span>{isSimple ? 'Aggiungi' : 'Scan'}</span>
          </Link>
        </header>
        <div className={styles.contentInner}>
          {children}
        </div>
      </main>
      <MobileNavigation />
      {showReleaseNotes && (
        <div className={styles.releaseNotesBackdrop} role="presentation" onMouseDown={dismissReleaseNotes}>
          <section
            className={styles.releaseNotesDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-notes-title"
            onMouseDown={event => event.stopPropagation()}
          >
            <button type="button" className={styles.releaseNotesClose} onClick={dismissReleaseNotes} aria-label="Chiudi novità">
              <X size={18} />
            </button>
            <div className={styles.releaseNotesIcon}><Sparkles size={22} /></div>
            <h2 id="release-notes-title">Novità in Contotron</h2>
            <p>I nuovi scontrini e documenti vengono salvati nel tuo Google Drive personale.</p>
            <ul>
              <li><Check size={16} /> Il filtro per tipo di spesa mostra ora solo le voci corrispondenti.</li>
              <li><Check size={16} /> In Dashboard le entrate previste restano visibili finché non confermi un accredito reale.</li>
              <li><Check size={16} /> Le nuove fonti di entrata permettono di distinguere persona, conto, cadenza, tredicesima e quattordicesima.</li>
              <li><Check size={16} /> Se hai file nel vecchio archivio, trasferiscili in blocco dalle Impostazioni entro una settimana. I file non trasferiti resteranno consultabili e potrai migrarli anche dopo.</li>
            </ul>
            <div className={styles.releaseNotesActions}>
              <Link to="/impostazioni" className={styles.releaseNotesConfirm} onClick={dismissReleaseNotes}>Vai alle Impostazioni</Link>
              <button type="button" className={styles.releaseNotesSecondary} onClick={dismissReleaseNotes}>Più tardi</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
