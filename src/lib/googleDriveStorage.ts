import { supabase } from './supabaseClient';
import {
  getLocalGoogleDriveFolder,
  markLocalGoogleDriveConnected,
} from './documentStoragePreference';
import type {
  DocumentStorageStatus,
  Household,
  MemberGoogleDriveConnection,
} from '../types/database';

export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export class GoogleDriveAuthError extends Error {
  constructor(message = 'Google Drive non collegato o autorizzazione scaduta.') {
    super(message);
    this.name = 'GoogleDriveAuthError';
  }
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType?: string;
  webViewLink?: string;
  webContentLink?: string;
  size?: string;
}

export interface PersonalDriveConnection {
  status: DocumentStorageStatus;
  folderId: string | null;
  folderName: string | null;
  connectedAt: string | null;
  source: 'database' | 'legacy' | 'local' | 'none';
}

const isConnectionSchemaMissing = (error: { code?: string; message?: string } | null) => (
  error?.code === '42P01'
  || error?.code === 'PGRST205'
  || Boolean(error?.message?.toLowerCase().includes('member_google_drive_connections'))
);

const escapeDriveQueryValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export const requestGoogleDriveConnection = async (redirectTo?: string) => {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectTo || `${window.location.origin}/impostazioni?connectDrive=1`,
      scopes: `openid email profile ${GOOGLE_DRIVE_FILE_SCOPE}`,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent select_account',
        include_granted_scopes: 'true',
      },
    },
  });
};

export const getGoogleDriveAccessToken = async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.provider_token;
};

const driveRequest = async (url: string, init: RequestInit = {}) => {
  const accessToken = await getGoogleDriveAccessToken();
  if (!accessToken) {
    throw new GoogleDriveAuthError();
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new GoogleDriveAuthError('Google Drive richiede una nuova autorizzazione.');
  }

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Errore Google Drive (${response.status}): ${details || response.statusText}`);
  }

  return response;
};

const findFolder = async (name: string, parentId?: string) => {
  const queryParts = [
    `name = '${escapeDriveQueryValue(name)}'`,
    `mimeType = '${FOLDER_MIME_TYPE}'`,
    'trashed = false',
  ];

  if (parentId) {
    queryParts.push(`'${escapeDriveQueryValue(parentId)}' in parents`);
  }

  const params = new URLSearchParams({
    q: queryParts.join(' and '),
    fields: 'files(id,name,mimeType,webViewLink)',
    spaces: 'drive',
    pageSize: '1',
  });

  const response = await driveRequest(`${DRIVE_API_BASE}/files?${params.toString()}`);
  const data = await response.json() as { files?: GoogleDriveFile[] };
  return data.files?.[0] || null;
};

const createFolder = async (name: string, parentId?: string) => {
  const response = await driveRequest(`${DRIVE_API_BASE}/files?fields=id,name,mimeType,webViewLink`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME_TYPE,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });

  return response.json() as Promise<GoogleDriveFile>;
};

const ensureFolder = async (name: string, parentId?: string) => {
  return await findFolder(name, parentId) || await createFolder(name, parentId);
};

export const verifyGoogleDriveFolder = async (folderId: string) => {
  const response = await driveRequest(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed`,
  );
  const folder = await response.json() as GoogleDriveFile & { trashed?: boolean };

  if (folder.trashed || folder.mimeType !== FOLDER_MIME_TYPE) {
    throw new Error('La cartella Contotron su Google Drive non e piu disponibile.');
  }

  return folder;
};

const folderNameForHousehold = (household: Household) => (
  household.google_drive_folder_name || `Contotron - ${household.name}`
);

export const getPersonalDriveConnection = async (
  household: Household,
  userId?: string | null,
): Promise<PersonalDriveConnection> => {
  if (!userId) {
    return {
      status: 'pending_connection',
      folderId: null,
      folderName: null,
      connectedAt: null,
      source: 'none',
    };
  }

  const { data, error } = await supabase
    .from('member_google_drive_connections')
    .select('*')
    .eq('household_id', household.id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error && !isConnectionSchemaMissing(error)) throw error;

  if (data) {
    const connection = data as MemberGoogleDriveConnection;
    return {
      status: connection.status,
      folderId: connection.folder_id,
      folderName: connection.folder_name,
      connectedAt: connection.connected_at,
      source: 'database',
    };
  }

  if (
    household.document_storage_connected_by === userId
    && household.google_drive_folder_id
  ) {
    return {
      status: household.document_storage_status || 'ready',
      folderId: household.google_drive_folder_id,
      folderName: household.google_drive_folder_name || folderNameForHousehold(household),
      connectedAt: household.document_storage_connected_at || null,
      source: 'legacy',
    };
  }

  const localFolder = getLocalGoogleDriveFolder(household.id, userId);
  if (localFolder) {
    return {
      status: 'ready',
      folderId: localFolder.id,
      folderName: localFolder.name,
      connectedAt: null,
      source: 'local',
    };
  }

  return {
    status: 'pending_connection',
    folderId: null,
    folderName: null,
    connectedAt: null,
    source: 'none',
  };
};

export const ensureHouseholdDriveFolder = async (household: Household, userId?: string | null) => {
  if (!userId) {
    throw new GoogleDriveAuthError('Account Contotron non disponibile per collegare Google Drive.');
  }

  const connection = await getPersonalDriveConnection(household, userId);
  if (connection.status === 'ready' && connection.folderId) {
    const verifiedFolder = await verifyGoogleDriveFolder(connection.folderId);
    return {
      id: verifiedFolder.id,
      name: verifiedFolder.name || connection.folderName || folderNameForHousehold(household),
    };
  }

  const folderName = folderNameForHousehold(household);
  const folder = await ensureFolder(folderName);
  const connectedAt = new Date().toISOString();

  const { error } = await supabase
    .from('member_google_drive_connections')
    .upsert({
      household_id: household.id,
      user_id: userId,
      status: 'ready',
      folder_id: folder.id,
      folder_name: folder.name,
      connected_at: connectedAt,
      updated_at: connectedAt,
    }, { onConflict: 'household_id,user_id' });

  if (error) {
    if (!isConnectionSchemaMissing(error)) throw error;
    markLocalGoogleDriveConnected(household.id, { id: folder.id, name: folder.name }, userId);
  }

  return folder;
};

const getYearMonthFolder = async (rootFolderId: string, documentDate: string) => {
  const [year, month] = documentDate.split('-');
  const yearFolder = await ensureFolder(year || String(new Date().getFullYear()), rootFolderId);
  return ensureFolder(month || String(new Date().getMonth() + 1).padStart(2, '0'), yearFolder.id);
};

export const uploadFileToGoogleDrive = async ({
  household,
  userId,
  file,
  documentDate,
  filename,
}: {
  household: Household;
  userId?: string | null;
  file: File;
  documentDate: string;
  filename: string;
}) => {
  const rootFolder = await ensureHouseholdDriveFolder(household, userId);
  const monthFolder = await getYearMonthFolder(rootFolder.id, documentDate);
  const boundary = `contotron_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name: filename,
    mimeType: file.type || 'application/octet-stream',
    parents: [monthFolder.id],
  };

  const multipartBody = new Blob([
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
    file,
    `\r\n--${boundary}--`,
  ], {
    type: `multipart/related; boundary=${boundary}`,
  });

  const response = await driveRequest(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,webContentLink,size`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  return response.json() as Promise<GoogleDriveFile>;
};

export const verifyGoogleDriveUploadCapability = async (
  household: Household,
  userId?: string | null,
) => {
  const testFile = new File(
    ['Contotron: verifica automatica del collegamento Google Drive.'],
    `contotron-test-${Date.now()}.txt`,
    { type: 'text/plain' },
  );
  const uploadedFile = await uploadFileToGoogleDrive({
    household,
    userId,
    file: testFile,
    documentDate: new Date().toISOString().slice(0, 10),
    filename: testFile.name,
  });

  try {
    await driveRequest(`${DRIVE_API_BASE}/files/${encodeURIComponent(uploadedFile.id)}`, {
      method: 'DELETE',
    });
  } catch (cleanupError) {
    console.warn('Il test di upload Google Drive e riuscito, ma il file tecnico non e stato eliminato.', cleanupError);
  }

  return uploadedFile;
};
