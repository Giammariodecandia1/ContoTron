import { supabase } from './supabaseClient';
import {
  getLocalGoogleDriveFolder,
  markLocalGoogleDriveConnected,
} from './documentStoragePreference';
import type { Household } from '../types/database';

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
  return (data.session as any)?.provider_token as string | undefined;
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

const folderNameForHousehold = (household: Household) => (
  household.google_drive_folder_name || `Contotron - ${household.name}`
);

export const ensureHouseholdDriveFolder = async (household: Household, userId?: string | null) => {
  const localFolder = getLocalGoogleDriveFolder(household.id);
  if (household.google_drive_folder_id) {
    return {
      id: household.google_drive_folder_id,
      name: household.google_drive_folder_name || folderNameForHousehold(household),
    };
  }

  if (localFolder) {
    return localFolder;
  }

  const folderName = folderNameForHousehold(household);
  const folder = await ensureFolder(folderName);

  const { error } = await supabase
    .from('households')
    .update({
      document_storage_provider: 'google_drive',
      document_storage_status: 'ready',
      google_drive_folder_id: folder.id,
      google_drive_folder_name: folder.name,
      document_storage_connected_by: userId || null,
      document_storage_connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', household.id);

  if (error) {
    const schemaMissing = error.message?.toLowerCase().includes('google_drive_folder_id')
      || error.message?.toLowerCase().includes('document_storage_provider')
      || error.code === '42703';

    if (!schemaMissing) throw error;
    markLocalGoogleDriveConnected(household.id, { id: folder.id, name: folder.name });
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
