import { supabase } from './supabaseClient';
import type { DocumentStorageProvider, DocumentStorageStatus, Household } from '../types/database';

export const DEFAULT_DOCUMENT_STORAGE_PROVIDER: DocumentStorageProvider = 'supabase';

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
  google_drive: 'Pensata per usare lo spazio Drive del creatore famiglia. Richiede il collegamento Google Drive prima degli upload reali.',
};

const storageKey = (householdId: string) => `contotron_document_storage_${householdId}`;

const readLocalState = (householdId: string): LocalDocumentStorageState | null => {
  const raw = localStorage.getItem(storageKey(householdId));
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

const writeLocalState = (householdId: string, state: LocalDocumentStorageState) => {
  localStorage.setItem(storageKey(householdId), JSON.stringify(state));
};

export const getDocumentStorageProvider = (household?: Household | null): DocumentStorageProvider => {
  if (!household) return DEFAULT_DOCUMENT_STORAGE_PROVIDER;
  if (household.document_storage_provider) return household.document_storage_provider;

  return readLocalState(household.id)?.provider || DEFAULT_DOCUMENT_STORAGE_PROVIDER;
};

export const getDocumentStorageStatus = (household?: Household | null): DocumentStorageStatus => {
  if (!household) return 'ready';
  if (household.document_storage_status) return household.document_storage_status;
  return readLocalState(household.id)?.status || (getDocumentStorageProvider(household) === 'google_drive' ? 'pending_connection' : 'ready');
};

export const getLocalGoogleDriveFolder = (householdId: string) => {
  const localState = readLocalState(householdId);
  if (!localState?.googleDriveFolderId) return null;

  return {
    id: localState.googleDriveFolderId,
    name: localState.googleDriveFolderName || 'Contotron',
  };
};

export const markLocalGoogleDriveConnected = (
  householdId: string,
  folder: { id: string; name: string },
) => {
  writeLocalState(householdId, {
    provider: 'google_drive',
    status: 'ready',
    googleDriveFolderId: folder.id,
    googleDriveFolderName: folder.name,
  });
};

export const saveDocumentStoragePreference = async (
  householdId: string,
  provider: DocumentStorageProvider,
) => {
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
