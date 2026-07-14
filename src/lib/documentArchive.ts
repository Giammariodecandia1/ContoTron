import { supabase } from './supabaseClient';
import { getDocumentStorageProvider, getDocumentStorageStatus } from './documentStoragePreference';
import { GoogleDriveAuthError, uploadFileToGoogleDrive } from './googleDriveStorage';
import type { Document, DocumentPage, DocumentType, Household } from '../types/database';

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

interface UploadArchiveDocumentPagesParams extends Omit<UploadArchiveDocumentParams, 'file'> {
  files: File[];
}

export interface DocumentPageWithUrl extends DocumentPage {
  url?: string;
}

export interface DocumentWithUrl extends Document {
  url?: string;
  ocr_text?: string | null;
  pages?: DocumentPageWithUrl[];
}

export interface DeleteArchiveDocumentResult {
  deletedDocument: boolean;
  deletedInternalFile: boolean;
  externalFileKept: boolean;
  storageError?: string | null;
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

const isSchemaMissingError = (error: unknown) => {
  const candidate = error as { code?: string; message?: string } | null;
  const message = String(candidate?.message || '').toLowerCase();
  return candidate?.code === '42703'
    || message.includes('storage_provider')
    || message.includes('external_file_id')
    || message.includes('external_url');
};

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

const uploadSupplementalDocumentPage = async ({
  householdId,
  household,
  uploadedBy,
  document,
  file,
  documentDate,
  pageNumber,
}: {
  householdId: string;
  household?: Household | null;
  uploadedBy?: string | null;
  document: Document;
  file: File;
  documentDate: string;
  pageNumber: number;
}) => {
  const storageFile = await optimizeArchiveFile(file);
  const pageFilename = `pagina-${String(pageNumber).padStart(2, '0')}-${safeFilename(storageFile.name)}`;
  const parentUsesDrive = document.storage_provider === 'google_drive' || document.storage_path.startsWith('google_drive:');

  if (parentUsesDrive && household) {
    try {
      const driveFile = await uploadFileToGoogleDrive({
        household,
        userId: uploadedBy,
        file: storageFile,
        documentDate,
        filename: pageFilename,
      });

      return {
        storage_path: `google_drive:${driveFile.id}`,
        storage_provider: 'google_drive' as const,
        external_file_id: driveFile.id,
        external_url: driveFile.webViewLink || null,
        mime_type: storageFile.type || null,
        file_size_bytes: storageFile.size,
      };
    } catch (error) {
      if (!(error instanceof GoogleDriveAuthError)) {
        console.warn(`Pagina ${pageNumber}: Google Drive non disponibile, uso archivio interno.`, error);
      }
    }
  }

  const [year, month] = documentDate.split('-');
  const storagePath = `${householdId}/${year}/${month}/${Date.now()}-${pageFilename}`;
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, storageFile, {
      contentType: storageFile.type || 'application/octet-stream',
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Upload pagina ${pageNumber} non riuscito: ${uploadError.message}`);
  }

  return {
    storage_path: storagePath,
    storage_provider: 'supabase' as const,
    external_file_id: null,
    external_url: null,
    mime_type: storageFile.type || null,
    file_size_bytes: storageFile.size,
  };
};

export const uploadArchiveDocumentPages = async ({
  householdId,
  household,
  uploadedBy,
  files,
  type,
  documentDate,
  vendorName,
  totalAmount,
}: UploadArchiveDocumentPagesParams): Promise<Document> => {
  if (files.length === 0) throw new Error('Nessuna pagina da archiviare.');

  const document = await uploadArchiveDocument({
    householdId,
    household,
    uploadedBy,
    file: files[0],
    type,
    documentDate,
    vendorName,
    totalAmount,
  });

  const pageRows: Array<Omit<DocumentPage, 'id' | 'created_at'>> = [{
    document_id: document.id,
    household_id: householdId,
    page_number: 1,
    original_filename: files[0].name,
    storage_path: document.storage_path,
    storage_provider: document.storage_provider || (document.storage_path.startsWith('google_drive:') ? 'google_drive' : 'supabase'),
    external_file_id: document.external_file_id || null,
    external_url: document.external_url || null,
    mime_type: document.mime_type,
    file_size_bytes: document.file_size_bytes,
  }];

  try {
    for (let index = 1; index < files.length; index += 1) {
      const pageNumber = index + 1;
      const storedPage = await uploadSupplementalDocumentPage({
        householdId,
        household,
        uploadedBy,
        document,
        file: files[index],
        documentDate,
        pageNumber,
      });

      pageRows.push({
        document_id: document.id,
        household_id: householdId,
        page_number: pageNumber,
        original_filename: files[index].name,
        ...storedPage,
      });
    }

    const { error: pagesError } = await supabase.from('document_pages').insert(pageRows);
    if (pagesError) throw new Error(`Impossibile collegare le pagine del documento: ${pagesError.message}`);

    const totalFileSize = pageRows.reduce((sum, page) => sum + (page.file_size_bytes || 0), 0);
    const { data: updatedDocument, error: updateError } = await supabase
      .from('documents')
      .update({
        file_size_bytes: totalFileSize || document.file_size_bytes,
        status: files.length > 1 ? 'archived_multipage' : 'archived',
        updated_at: new Date().toISOString(),
      })
      .eq('id', document.id)
      .select()
      .single();

    if (updateError) throw updateError;
    return updatedDocument as Document;
  } catch (error) {
    const supplementalInternalPaths = pageRows
      .slice(1)
      .filter(page => page.storage_provider !== 'google_drive' && !page.storage_path.startsWith('google_drive:'))
      .map(page => page.storage_path);
    if (supplementalInternalPaths.length > 0) {
      await supabase.storage.from(DOCUMENT_BUCKET).remove(supplementalInternalPaths).catch(cleanupError => {
        console.warn('Pulizia pagine interne incomplete non riuscita:', cleanupError);
      });
    }
    await deleteArchiveDocument(document).catch(cleanupError => {
      console.warn('Pulizia documento multipagina incompleto non riuscita:', cleanupError);
    });
    throw error;
  }
};

export const getDocumentPages = async (documents: Document[]): Promise<Record<string, DocumentPageWithUrl[]>> => {
  if (documents.length === 0) return {};

  const { data, error } = await supabase
    .from('document_pages')
    .select('*')
    .in('document_id', documents.map(document => document.id))
    .order('page_number', { ascending: true });

  if (error) console.warn('Pagine documento non disponibili, uso anteprima principale:', error.message);
  const rows = error ? [] : (data || []) as DocumentPage[];
  const pagesWithUrls = await Promise.all(rows.map(async page => ({
    ...page,
    url: await getDocumentUrl(page.storage_path, page.storage_provider, page.external_url),
  })));
  const byDocument = pagesWithUrls.reduce<Record<string, DocumentPageWithUrl[]>>((result, page) => {
    result[page.document_id] = [...(result[page.document_id] || []), page];
    return result;
  }, {});

  for (const document of documents) {
    if (byDocument[document.id]?.length) continue;

    byDocument[document.id] = [{
      id: `legacy-${document.id}`,
      document_id: document.id,
      household_id: document.household_id,
      page_number: 1,
      original_filename: document.original_filename,
      storage_path: document.storage_path,
      storage_provider: document.storage_provider || (document.storage_path.startsWith('google_drive:') ? 'google_drive' : 'supabase'),
      external_file_id: document.external_file_id || null,
      external_url: document.external_url || null,
      mime_type: document.mime_type,
      file_size_bytes: document.file_size_bytes,
      created_at: document.created_at,
      url: await getDocumentUrl(document.storage_path, document.storage_provider, document.external_url),
    }];
  }

  return byDocument;
};

export const deleteArchiveDocument = async (document: Document): Promise<DeleteArchiveDocumentResult> => {
  const { data: pageRows } = await supabase
    .from('document_pages')
    .select('storage_path, storage_provider')
    .eq('document_id', document.id);

  const storedFiles = [
    {
      storage_path: document.storage_path,
      storage_provider: document.storage_provider || (document.storage_path.startsWith('google_drive:') ? 'google_drive' : 'supabase'),
    },
    ...((pageRows || []) as Array<{ storage_path: string; storage_provider: string }>),
  ];
  const internalPaths = [...new Set(
    storedFiles
      .filter(file => file.storage_provider !== 'google_drive' && !file.storage_path.startsWith('google_drive:'))
      .map(file => file.storage_path)
      .filter(Boolean),
  )];
  const isGoogleDriveDocument = storedFiles.some(file => (
    file.storage_provider === 'google_drive' || file.storage_path.startsWith('google_drive:')
  ));
  let deletedInternalFile = false;
  let storageError: string | null = null;

  if (internalPaths.length > 0) {
    const { error } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove(internalPaths);

    if (error) {
      storageError = error.message;
    } else {
      deletedInternalFile = true;
    }
  }

  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', document.id)
    .eq('household_id', document.household_id);

  if (error) throw error;

  return {
    deletedDocument: true,
    deletedInternalFile,
    externalFileKept: isGoogleDriveDocument,
    storageError,
  };
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
