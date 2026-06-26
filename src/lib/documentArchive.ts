import { supabase } from './supabaseClient';
import { getDocumentStorageProvider, getDocumentStorageStatus } from './documentStoragePreference';
import { GoogleDriveAuthError, uploadFileToGoogleDrive } from './googleDriveStorage';
import type { Document, DocumentType, Household } from '../types/database';

export const DOCUMENT_BUCKET = 'documents';

interface UploadArchiveDocumentParams {
  householdId: string;
  household?: Household | null;
  uploadedBy?: string | null;
  file: File;
  type: DocumentType;
  documentDate: string;
  vendorName?: string | null;
  totalAmount?: number | null;
}

export interface DocumentWithUrl extends Document {
  url?: string;
  ocr_text?: string | null;
}

const extensionFromFile = (file: File) => {
  const nameParts = file.name.split('.');
  return nameParts.length > 1 ? nameParts.pop()?.toLowerCase() : undefined;
};

const safeFilename = (filename: string) => {
  const extension = extensionFromFile({ name: filename } as File);
  const basename = filename.replace(/\.[^.]+$/, '');
  const safeBase = basename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'documento';

  return extension ? `${safeBase}.${extension}` : safeBase;
};

const isSchemaMissingError = (error: any) => (
  error?.code === '42703'
  || String(error?.message || '').toLowerCase().includes('storage_provider')
  || String(error?.message || '').toLowerCase().includes('external_file_id')
  || String(error?.message || '').toLowerCase().includes('external_url')
);

const replaceExtension = (filename: string, extension: string) => {
  return `${filename.replace(/\.[^.]+$/, '')}.${extension}`;
};

const toDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number) => (
  new Promise<Blob | null>(resolve => {
    canvas.toBlob(resolve, type, quality);
  })
);

const loadImage = (file: File) => (
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Impossibile leggere immagine per ottimizzazione'));
    };
    image.src = url;
  })
);

export const optimizeArchiveFile = async (file: File): Promise<File> => {
  if (!file.type.startsWith('image/')) return file;

  try {
    const image = await loadImage(file);
    const maxLongSide = 1800;
    const longSide = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = longSide > maxLongSide ? maxLongSide / longSide : 1;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) return file;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.82);
    if (!blob) return file;

    if (blob.size >= file.size && longSide <= maxLongSide) {
      return file;
    }

    return new File([blob], replaceExtension(file.name, 'jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
};

export const getMonthRange = (year: number, month: number) => {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);

  return {
    start: toDateString(start),
    end: toDateString(end),
  };
};

export const getMonthKey = (date?: string | null) => {
  if (!date) return 'Senza data';
  return date.slice(0, 7);
};

export const formatMonthKey = (key: string) => {
  if (key === 'Senza data') return key;

  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('it-IT', {
    month: 'long',
    year: 'numeric',
  });
};

export const dataUrlToFile = async (dataUrl: string, filename: string): Promise<File> => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
};

export const uploadArchiveDocument = async ({
  householdId,
  household,
  uploadedBy,
  file,
  type,
  documentDate,
  vendorName,
  totalAmount,
}: UploadArchiveDocumentParams): Promise<Document> => {
  const date = documentDate || toDateString(new Date());
  const [year, month] = date.split('-');
  const storageFile = await optimizeArchiveFile(file);
  const storagePath = `${householdId}/${year}/${month}/${Date.now()}-${safeFilename(storageFile.name)}`;
  const desiredProvider = getDocumentStorageProvider(household);
  const storageStatus = getDocumentStorageStatus(household);
  const canUseGoogleDrive = desiredProvider === 'google_drive' && storageStatus === 'ready' && !!household;

  if (canUseGoogleDrive) {
    try {
      const driveFile = await uploadFileToGoogleDrive({
        household,
        userId: uploadedBy,
        file: storageFile,
        documentDate: date,
        filename: safeFilename(storageFile.name),
      });

      const payload = {
        household_id: householdId,
        uploaded_by: uploadedBy || null,
        type,
        original_filename: file.name,
        storage_path: `google_drive:${driveFile.id}`,
        storage_provider: 'google_drive',
        external_file_id: driveFile.id,
        external_url: driveFile.webViewLink || null,
        mime_type: storageFile.type || null,
        file_size_bytes: storageFile.size,
        document_date: date,
        vendor_name: vendorName?.trim() || null,
        total_amount: totalAmount ?? null,
        status: 'archived',
      };

      const { data, error } = await supabase
        .from('documents')
        .insert([payload])
        .select()
        .single();

      if (!error) return data as Document;

      if (!isSchemaMissingError(error)) throw error;

      const legacyPayload = { ...payload } as Record<string, unknown>;
      delete legacyPayload.storage_provider;
      delete legacyPayload.external_file_id;
      delete legacyPayload.external_url;
      const { data: legacyData, error: legacyError } = await supabase
        .from('documents')
        .insert([legacyPayload])
        .select()
        .single();

      if (legacyError) throw legacyError;
      return legacyData as Document;
    } catch (driveError) {
      if (!(driveError instanceof GoogleDriveAuthError)) {
        console.warn('Google Drive non disponibile, uso archivio interno:', driveError);
      }
    }
  }

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, storageFile, {
      contentType: storageFile.type || 'application/octet-stream',
      upsert: false,
    });

  if (uploadError) {
    throw new Error(
      `Upload non riuscito. Verifica che il bucket Supabase "${DOCUMENT_BUCKET}" esista e accetti upload dal client. Dettaglio: ${uploadError.message}`,
    );
  }

  const payload = {
    household_id: householdId,
    uploaded_by: uploadedBy || null,
    type,
    original_filename: file.name,
    storage_path: storagePath,
    storage_provider: 'supabase',
    external_file_id: null,
    external_url: null,
    mime_type: storageFile.type || null,
    file_size_bytes: storageFile.size,
    document_date: date,
    vendor_name: vendorName?.trim() || null,
    total_amount: totalAmount ?? null,
    status: canUseGoogleDrive ? 'archived_drive_fallback' : 'archived',
  };

  const { data, error } = await supabase
    .from('documents')
    .insert([payload])
    .select()
    .single();

  if (!error) return data as Document;

  if (!isSchemaMissingError(error)) throw error;

  const legacyPayload = { ...payload } as Record<string, unknown>;
  delete legacyPayload.storage_provider;
  delete legacyPayload.external_file_id;
  delete legacyPayload.external_url;
  const { data: legacyData, error: legacyError } = await supabase
    .from('documents')
    .insert([legacyPayload])
    .select()
    .single();

  if (legacyError) throw legacyError;
  return legacyData as Document;
};

export const getDocumentUrl = async (
  storagePath: string,
  storageProvider?: string | null,
  externalUrl?: string | null,
) => {
  if (storageProvider === 'google_drive' || storagePath.startsWith('google_drive:')) {
    if (externalUrl) return externalUrl;

    const fileId = storagePath.replace(/^google_drive:/, '');
    return fileId ? `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view` : '';
  }

  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);

  if (!error && data?.signedUrl) {
    return data.signedUrl;
  }

  return '';
};
