import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Cloud,
  Database,
  Info,
  LayoutDashboard,
  Layers3,
  LogOut,
  Monitor,
  Moon,
  Settings as SettingsIcon,
  Sun,
  Tag,
  Users,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  useAuth,
  useHousehold,
  usePersonalDriveConnection,
  useTheme,
  useViewMode,
} from '../hooks';
import {
  documentStorageDescriptions,
  documentStorageLabels,
  getDocumentStorageProvider,
  saveDocumentStoragePreference,
} from '../lib/documentStoragePreference';
import {
  ensureHouseholdDriveFolder,
  GoogleDriveAuthError,
  requestGoogleDriveConnection,
} from '../lib/googleDriveStorage';
import {
  getFontScale,
  saveFontScale,
  type FontScale,
} from '../lib/fontScalePreference';
import type { DocumentStorageProvider } from '../types/database';
import styles from './SettingsPage.module.css';

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, resolvedTheme, setMode } = useTheme();
  const { mode: viewMode, isSimple, setMode: setViewMode } = useViewMode();
  const { household, refreshData } = useHousehold();
  const { user, logout } = useAuth();
  const userId = user?.id || null;
  const [storageSaving, setStorageSaving] = useState(false);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [fontScale, setFontScale] = useState<FontScale>(() => getFontScale());

  const documentStorageProvider = useMemo(() => getDocumentStorageProvider(household), [household]);
  const {
    connection: personalDriveConnection,
    loading: driveStatusLoading,
    error: driveStatusError,
    refresh: refreshPersonalDriveConnection,
    setConnection: setPersonalDriveConnection,
  } = usePersonalDriveConnection(household, userId);
  const personalDriveReady = personalDriveConnection?.status === 'ready'
    && Boolean(personalDriveConnection.folderId);
  const fromDriveSetup = useMemo(() => new URLSearchParams(location.search).get('driveSetup') === '1', [location.search]);

  const handleFontScaleChange = (nextScale: FontScale) => {
    setFontScale(nextScale);
    saveFontScale(nextScale);
  };

  const handleViewModeChange = (nextMode: 'simple' | 'complete') => {
    setViewMode(nextMode);
    if (nextMode === 'simple') navigate('/dashboard');
  };

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
      setPersonalDriveConnection({
        status: 'ready',
        folderId: folder.id,
        folderName: folder.name,
        connectedAt: new Date().toISOString(),
        source: 'database',
      });
      await refreshData();
      await refreshPersonalDriveConnection();
      setStorageMessage(`Google Drive personale collegato. I tuoi nuovi scontrini andranno nella cartella ${folder.name}.`);
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
  }, [
    driveConnecting,
    household,
    location.search,
    navigate,
    refreshData,
    refreshPersonalDriveConnection,
    setPersonalDriveConnection,
    userId,
  ]);

  useEffect(() => {
    const shouldConnectDrive = new URLSearchParams(location.search).get('connectDrive') === '1';
    if (
      shouldConnectDrive
      && household
      && documentStorageProvider === 'google_drive'
      && !driveConnecting
    ) {
      const connectTimer = window.setTimeout(() => {
        void connectGoogleDrive(false);
      }, 0);

      return () => window.clearTimeout(connectTimer);
    }
  }, [connectGoogleDrive, documentStorageProvider, driveConnecting, household, location.search]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Impostazioni</h1>
        <p className="text-muted">Configura il tuo nucleo familiare e le tue preferenze.</p>
      </header>

      <div className={styles.grid}>
        <Card className={styles.viewModeCard} title="Visualizzazione" icon={<LayoutDashboard size={20} />}>
          <div className={styles.preferenceHeader}>
            <strong>Scegli quante funzioni vedere</strong>
            <span className="text-muted fs-sm">La scelta riguarda soltanto il tuo account e non modifica né elimina alcun dato.</span>
          </div>
          <div className={styles.viewModeToggle} role="group" aria-label="Modalità di visualizzazione">
            <button
              type="button"
              className={viewMode === 'simple' ? styles.viewModeActive : ''}
              aria-pressed={viewMode === 'simple'}
              onClick={() => handleViewModeChange('simple')}
            >
              <LayoutDashboard size={22} />
              <span><strong>Semplice</strong><small>Spese del mese, movimenti, Split e controlli essenziali</small></span>
            </button>
            <button
              type="button"
              className={viewMode === 'complete' ? styles.viewModeActive : ''}
              aria-pressed={viewMode === 'complete'}
              onClick={() => handleViewModeChange('complete')}
            >
              <Layers3 size={22} />
              <span><strong>Completa</strong><small>Budget, categorie, report, analisi, documenti e OCR</small></span>
            </button>
          </div>
          {isSimple && (
            <p className={styles.simpleModeMessage}>Modalità semplice attiva. Tornando a Completa ritroverai tutte le informazioni e classificazioni già salvate.</p>
          )}
        </Card>

        <Card title="Nucleo Familiare" icon={<Users size={20} />} action={<Button size="sm" onClick={() => navigate('/impostazioni/nucleo')}>Gestisci</Button>}>
          <div className={styles.nucleusPreview}>
            <strong>{household?.name || 'Nucleo Contotron'}</strong>
            <span>Codice invito: {household?.invite_code || 'da attivare'}</span>
          </div>
          <p className="text-muted fs-sm">
            Invita altri membri della tua famiglia per condividere spese e budget. Ogni account puo appartenere a un solo nucleo alla volta.
          </p>
        </Card>

        {!isSimple && (
          <>
            <Card title="Gestione Categorie" icon={<Tag size={20} />} action={<Button size="sm" onClick={() => navigate('/impostazioni/categorie')}>Gestisci</Button>}>
              <p className="text-muted fs-sm">Aggiungi, modifica o rimuovi categorie e sottocategorie di spesa.</p>
            </Card>

            <Card title="Spese fisse" icon={<CalendarClock size={20} />} action={<Button size="sm" onClick={() => navigate('/impostazioni/spese-fisse')}>Gestisci</Button>}>
              <p className="text-muted fs-sm">
                Configura canoni, finanziamenti e uscite mensili che devono risultare gia impegnate all'apertura del mese.
              </p>
            </Card>

            <Card title="Archivio documenti" icon={<Cloud size={20} />}>
          <p className="text-muted fs-sm">
            Formula attiva: {documentStorageLabels[documentStorageProvider]}.
          </p>
          {fromDriveSetup && documentStorageProvider === 'google_drive' && (
            <div className={`${styles.feedback} ${styles.warning}`}>
              Hai scelto Google Drive per questa famiglia. Puoi usare Contotron subito; collega Drive da qui quando l'account e' abilitato come tester Google.
            </div>
          )}
          {storageMessage && <div className={`${styles.feedback} ${styles.success}`}>{storageMessage}</div>}
          {storageError && <div className={`${styles.feedback} ${styles.error}`}>{storageError}</div>}
          {driveStatusError && <div className={`${styles.feedback} ${styles.error}`}>{driveStatusError}</div>}

          <div className={`${styles.storageStatus} ${
            documentStorageProvider === 'google_drive' && !personalDriveReady
              ? styles.storageStatusWarning
              : styles.storageStatusReady
          }`}>
            {documentStorageProvider === 'google_drive' && !personalDriveReady
              ? <AlertTriangle size={22} />
              : <CheckCircle2 size={22} />}
            <div>
              <strong>
                {documentStorageProvider === 'supabase'
                  ? 'Archivio interno attivo'
                  : driveStatusLoading
                    ? 'Verifica del tuo Google Drive...'
                    : personalDriveReady
                      ? 'Google Drive personale attivo'
                      : 'Google Drive scelto ma non collegato'}
              </strong>
              <p>
                {documentStorageProvider === 'supabase'
                  ? 'I nuovi scontrini vengono salvati nello storage privato Contotron del nucleo.'
                  : personalDriveReady
                    ? `I file caricati da ${user?.email || 'questo account'} vengono salvati nel suo Drive, cartella ${personalDriveConnection?.folderName || 'Contotron'}.`
                    : `L account ${user?.email || 'corrente'} deve ancora autorizzare Google Drive. Fino ad allora useremo l archivio interno provvisorio.`}
              </p>
            </div>
          </div>

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
                  : personalDriveReady
                    ? 'Ricollega Google Drive'
                    : 'Collega Google Drive'}
              </Button>
              {personalDriveReady && (
                <span className="text-muted fs-sm">
                  Account: {user?.email || 'Google corrente'} · Cartella: {personalDriveConnection?.folderName || 'Contotron'}
                </span>
              )}
            </div>
          )}
          {documentStorageProvider === 'google_drive' && (
            <div className={styles.privacyNote}>
              Ogni membro autorizza separatamente il proprio Drive. Contotron non condivide token Google e puo gestire soltanto i file creati dall app.
            </div>
          )}
            </Card>
          </>
        )}

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
          <div className={styles.preferenceDivider} />
          <div className={styles.preferenceHeader}>
            <strong>Dimensione caratteri</strong>
            <span className="text-muted fs-sm">La scelta viene applicata subito a tutta l'app.</span>
          </div>
          <div className={styles.fontScaleToggle} role="group" aria-label="Dimensione caratteri applicazione">
            {([
              ['normal', 'Normale', '100%'],
              ['large', 'Grande', '112%'],
              ['xlarge', 'Molto grande', '125%'],
            ] as const).map(([value, label, percentage]) => (
              <button
                key={value}
                type="button"
                className={fontScale === value ? styles.fontScaleActive : ''}
                aria-pressed={fontScale === value}
                onClick={() => handleFontScaleChange(value)}
              >
                <span>{label}</span>
                <small>{percentage}</small>
              </button>
            ))}
          </div>
          <p className={styles.fontPreview}>Anteprima: entrate, uscite e budget familiare.</p>
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
