import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Cloud, Database, Info, LogOut, Monitor, Moon, Settings as SettingsIcon, Sun, Tag, Users } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useHousehold, useTheme } from '../hooks';
import {
  documentStorageDescriptions,
  documentStorageLabels,
  getDocumentStorageProvider,
  getDocumentStorageStatus,
  saveDocumentStoragePreference,
} from '../lib/documentStoragePreference';
import {
  ensureHouseholdDriveFolder,
  GoogleDriveAuthError,
  requestGoogleDriveConnection,
} from '../lib/googleDriveStorage';
import type { DocumentStorageProvider } from '../types/database';
import styles from './SettingsPage.module.css';

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, resolvedTheme, setMode } = useTheme();
  const { household, refreshData } = useHousehold();
  const { user, logout } = useAuth();
  const userId = user?.id || null;
  const [storageSaving, setStorageSaving] = useState(false);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  const documentStorageProvider = useMemo(() => getDocumentStorageProvider(household), [household]);
  const documentStorageStatus = useMemo(() => getDocumentStorageStatus(household), [household]);
  const fromDriveSetup = useMemo(() => new URLSearchParams(location.search).get('driveSetup') === '1', [location.search]);

  const handleStorageChange = async (provider: DocumentStorageProvider) => {
    if (!household || storageSaving || provider === documentStorageProvider) return;

    setStorageSaving(true);
    setStorageMessage(null);
    setStorageError(null);

    try {
      const result = await saveDocumentStoragePreference(household.id, provider);
      await refreshData();
      setStorageMessage(result.savedInDatabase
        ? `Archivio documenti impostato su ${documentStorageLabels[provider]}.`
        : 'Scelta salvata localmente. Applica la migrazione Supabase per renderla condivisa con tutta la famiglia.');
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Impossibile salvare la preferenza archivio.');
    } finally {
      setStorageSaving(false);
    }
  };

  const connectGoogleDrive = useCallback(async (requestConsentIfNeeded: boolean) => {
    if (!household || driveConnecting) return;

    setDriveConnecting(true);
    setStorageMessage(null);
    setStorageError(null);

    try {
      const folder = await ensureHouseholdDriveFolder(household, userId);
      await refreshData();
      setStorageMessage(`Google Drive collegato. Cartella famiglia: ${folder.name}.`);
      if (location.search.includes('connectDrive=1')) {
        navigate('/impostazioni', { replace: true });
      }
    } catch (error) {
      if (error instanceof GoogleDriveAuthError && requestConsentIfNeeded) {
        const { error: oauthError } = await requestGoogleDriveConnection(`${window.location.origin}/impostazioni?connectDrive=1`);
        if (oauthError) {
          setStorageError(oauthError.message);
          setDriveConnecting(false);
        }
        return;
      }

      setStorageError(error instanceof Error ? error.message : 'Impossibile collegare Google Drive.');
    } finally {
      setDriveConnecting(false);
    }
  }, [driveConnecting, household, location.search, navigate, refreshData, userId]);

  useEffect(() => {
    const shouldConnectDrive = new URLSearchParams(location.search).get('connectDrive') === '1';
    if (
      shouldConnectDrive
      && household
      && documentStorageProvider === 'google_drive'
      && documentStorageStatus !== 'ready'
      && !driveConnecting
    ) {
      const connectTimer = window.setTimeout(() => {
        void connectGoogleDrive(false);
      }, 0);

      return () => window.clearTimeout(connectTimer);
    }
  }, [connectGoogleDrive, documentStorageProvider, documentStorageStatus, driveConnecting, household, location.search]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Impostazioni</h1>
        <p className="text-muted">Configura il tuo nucleo familiare e le tue preferenze.</p>
      </header>

      <div className={styles.grid}>
        <Card title="Nucleo Familiare" icon={<Users size={20} />} action={<Button size="sm" onClick={() => navigate('/impostazioni/nucleo')}>Gestisci</Button>}>
          <div className={styles.nucleusPreview}>
            <strong>{household?.name || 'Nucleo Contotron'}</strong>
            <span>Codice invito: {household?.invite_code || 'da attivare'}</span>
          </div>
          <p className="text-muted fs-sm">
            Invita altri membri della tua famiglia per condividere spese e budget. Ogni account puo appartenere a un solo nucleo alla volta.
          </p>
        </Card>

        <Card title="Gestione Categorie" icon={<Tag size={20} />} action={<Button size="sm" onClick={() => navigate('/impostazioni/categorie')}>Gestisci</Button>}>
          <p className="text-muted fs-sm">Aggiungi, modifica o rimuovi categorie e sottocategorie di spesa.</p>
        </Card>

        <Card title="Archivio documenti" icon={<Cloud size={20} />}>
          <p className="text-muted fs-sm">
            Formula attiva: {documentStorageLabels[documentStorageProvider]}.
            {documentStorageStatus === 'pending_connection' && " Google Drive e' ancora da collegare."}
          </p>
          {fromDriveSetup && documentStorageProvider === 'google_drive' && (
            <div className={`${styles.feedback} ${styles.warning}`}>
              Hai scelto Google Drive per questa famiglia. Puoi usare Contotron subito; collega Drive da qui quando l'account e' abilitato come tester Google.
            </div>
          )}
          {storageMessage && <div className={`${styles.feedback} ${styles.success}`}>{storageMessage}</div>}
          {storageError && <div className={`${styles.feedback} ${styles.error}`}>{storageError}</div>}
          <div className={styles.storageOptions}>
            <button
              type="button"
              className={documentStorageProvider === 'supabase' ? styles.storageActive : ''}
              onClick={() => handleStorageChange('supabase')}
              disabled={storageSaving}
            >
              <Database size={18} />
              <span>
                <strong>{documentStorageLabels.supabase}</strong>
                <small>{documentStorageDescriptions.supabase}</small>
              </span>
            </button>
            <button
              type="button"
              className={documentStorageProvider === 'google_drive' ? styles.storageActive : ''}
              onClick={() => handleStorageChange('google_drive')}
              disabled={storageSaving}
            >
              <Cloud size={18} />
              <span>
                <strong>{documentStorageLabels.google_drive}</strong>
                <small>{documentStorageDescriptions.google_drive}</small>
              </span>
            </button>
          </div>
          {documentStorageProvider === 'google_drive' && (
            <div className={styles.driveActions}>
              <Button
                size="sm"
                onClick={() => connectGoogleDrive(true)}
                disabled={driveConnecting}
              >
                {driveConnecting
                  ? 'Collegamento...'
                  : documentStorageStatus === 'ready'
                    ? 'Ricollega Google Drive'
                    : 'Collega Google Drive'}
              </Button>
              {documentStorageStatus === 'ready' && (
                <span className="text-muted fs-sm">
                  Cartella: {household?.google_drive_folder_name || 'Contotron'}
                </span>
              )}
            </div>
          )}
          {documentStorageProvider === 'google_drive' && (
            <div className={`${styles.feedback} ${styles.warning}`}>
              Nota: per far salvare tutti direttamente nel Drive del proprietario servira una funzione backend sicura. Dal browser non conserveremo token Google di altri account.
            </div>
          )}
        </Card>

        <Card title="Preferenze" icon={<SettingsIcon size={20} />}>
          <p className="text-muted fs-sm">Tema attivo: {resolvedTheme === 'dark' ? 'scuro' : 'chiaro'}.</p>
          <div className={styles.themeToggle} role="group" aria-label="Tema applicazione">
            <button
              type="button"
              className={mode === 'light' ? styles.themeActive : ''}
              onClick={() => setMode('light')}
            >
              <Sun size={16} />
              Chiaro
            </button>
            <button
              type="button"
              className={mode === 'dark' ? styles.themeActive : ''}
              onClick={() => setMode('dark')}
            >
              <Moon size={16} />
              Scuro
            </button>
            <button
              type="button"
              className={mode === 'system' ? styles.themeActive : ''}
              onClick={() => setMode('system')}
            >
              <Monitor size={16} />
              Sistema
            </button>
          </div>
        </Card>

        <Card title="Account" icon={<LogOut size={20} />}>
          <div className={styles.accountBox}>
            <p className="text-muted fs-sm">
              Sei collegato come <strong>{user?.display_name || user?.email || 'utente Contotron'}</strong>.
            </p>
            <Button variant="secondary" onClick={logout}>
              Esci dall'account
            </Button>
          </div>
        </Card>

        <Card title="Info Contotron" icon={<Info size={20} />}>
          <div className={styles.infoList}>
            <div>
              <span>Creatore</span>
              <strong>Giammario de Candia</strong>
            </div>
            <div>
              <span>Versione</span>
              <strong>V1</strong>
            </div>
            <div>
              <span>Data rilascio</span>
              <strong>27/06/2026</strong>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
