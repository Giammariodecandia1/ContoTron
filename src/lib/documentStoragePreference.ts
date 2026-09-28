import { supabase } from './supabaseClient';
import type { DocumentStorageProvider, DocumentStorageStatus, Household } from '../types/database';

export const DEFAULT_DOCUMENT_STORAGE_PROVIDER: DocumentStorageProvider = 'google_drive';

interface LocalDocumentStorageState {
  provider: DocumentStorageProvider;
  status: DocumentStorageStatus;
  googleDriveFolderId?: string | null;
  googleDriveFolderName?: string | null;
}

export const documentStorageLabels: Record<DocumentStorageProvider, string> = {
  supabase: 'Archivio interno Contotron',
  google_drive: 'Google Drive famiglia',
};

export const documentStorageDescriptions: Record<DocumentStorageProvider, string> = {
  supabase: 'Soluzione semplice e subito attiva. I documenti ottimizzati restano nello storage privato collegato al database.',
  google_drive: 'Ogni membro collega il proprio Google Drive personale. Contotron salva solo i file caricati da quell account.',
};

const storageKey = (householdId: string, userId?: string | null) => (
  `contotron_document_storage_${householdId}${userId ? `_${userId}` : ''}`
);

const readLocalState = (householdId: string, userId?: string | null): LocalDocumentStorageState | null => {
  const raw = localStorage.getItem(storageKey(householdId, userId))
    || localStorage.getItem(storageKey(householdId));
  if (!raw) return null;

  if (raw === 'google_drive' || raw === 'supabase') {
    return {
      provider: raw,
      status: raw === 'google_drive' ? 'pending_connection' : 'ready',
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalDocumentStorageState>;
    if (parsed.provider === 'google_drive' || parsed.provider === 'supabase') {
      return {
        provider: parsed.provider,
        status: parsed.status || (parsed.provider === 'google_drive' ? 'pending_connection' : 'ready'),
        googleDriveFolderId: parsed.googleDriveFolderId || null,
        googleDriveFolderName: parsed.googleDriveFolderName || null,
      };
    }
  } catch {
    return null;
  }

  return null;
};

const writeLocalState = (
  householdId: string,
  state: LocalDocumentStorageState,
  userId?: string | null,
) => {
  localStorage.setItem(storageKey(householdId, userId), JSON.stringify(state));
};

export const getDocumentStorageProvider = (household?: Household | null): DocumentStorageProvider => {
  if (!household) return DEFAULT_DOCUMENT_STORAGE_PROVIDER;
  // Legacy household preferences continue to describe old files, but never
  // determine the destination of new uploads during the Drive transition.
  return 'google_drive';
};

export const getDocumentStorageStatus = (household?: Household | null): DocumentStorageStatus => {
  if (!household) return 'pending_connection';
  if (household.document_storage_provider !== 'google_drive') return 'pending_connection';
  if (household.document_storage_status) return household.document_storage_status;
  return readLocalState(household.id)?.status || (getDocumentStorageProvider(household) === 'google_drive' ? 'pending_connection' : 'ready');
};

export const getLocalGoogleDriveFolder = (householdId: string, userId?: string | null) => {
  const localState = readLocalState(householdId, userId);
  if (!localState?.googleDriveFolderId) return null;

  return {
    id: localState.googleDriveFolderId,
    name: localState.googleDriveFolderName || 'Contotron',
  };
};

export const markLocalGoogleDriveConnected = (
  householdId: string,
  folder: { id: string; name: string },
  userId?: string | null,
) => {
  writeLocalState(householdId, {
    provider: 'google_drive',
    status: 'ready',
    googleDriveFolderId: folder.id,
    googleDriveFolderName: folder.name,
  }, userId);
};

export const saveDocumentStoragePreference = async (
  householdId: string,
  provider: DocumentStorageProvider,
) => {
  if (provider !== 'google_drive') {
    throw new Error('I nuovi documenti possono essere salvati soltanto su Google Drive.');
  }
  const status: DocumentStorageStatus = provider === 'google_drive' ? 'pending_connection' : 'ready';
  const nextData = {
    document_storage_provider: provider,
    document_storage_status: status,
    google_drive_folder_id: null,
    google_drive_folder_name: null,
    document_storage_connected_by: null,
    document_storage_connected_at: null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('households')
    .update(nextData)
    .eq('id', householdId);

  if (!error) {
    localStorage.removeItem(storageKey(householdId));
    return { savedInDatabase: true, status };
  }

  const schemaMissing = error.message?.toLowerCase().includes('document_storage_provider')
    || error.message?.toLowerCase().includes('google_drive_folder_id')
    || error.code === '42703';

  if (!schemaMissing) {
    throw error;
  }

  writeLocalState(householdId, { provider, status });
  return { savedInDatabase: false, status };
};
