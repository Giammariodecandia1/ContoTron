import { supabase } from './supabaseClient';
import { DOCUMENT_BUCKET } from './documentArchive';
import {
  removeGoogleDriveFile,
  uploadFileToGoogleDrive,
  verifyGoogleDriveFileSize,
} from './googleDriveStorage';
import type { Document, DocumentPage, Household } from '../types/database';

export const isInternalDocument = (document: Pick<Document, 'storage_path' | 'storage_provider'>) => (
  document.storage_provider !== 'google_drive' && !document.storage_path.startsWith('google_drive:')
);

export const listInternalDocuments = async (householdId: string): Promise<Document[]> => {
  const documents: Document[] = [];
  const batchSize = 500;
  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true })
      .range(offset, offset + batchSize - 1);
    if (error) throw error;
    const rows = (data || []) as Document[];
    documents.push(...rows.filter(isInternalDocument));
    if (rows.length < batchSize) return documents;
  }
};

export interface MigrationProgress {
  completed: number;
  total: number;
  currentName: string;
  failed: Array<{ id: string; name: string; error: string }>;
}

const migrationFilesForDocument = async (document: Document) => {
  const { data, error } = await supabase
    .from('document_pages')
    .select('storage_path, original_filename, page_number, mime_type')
    .eq('document_id', document.id)
    .order('page_number', { ascending: true });
  if (error) throw error;
  const pages = (data || []) as Pick<DocumentPage, 'storage_path' | 'original_filename' | 'page_number' | 'mime_type'>[];
  if (pages.some(page => page.storage_path.startsWith('google_drive:'))) {
    throw new Error('Questo documento contiene pagine già migrate: è necessaria una verifica manuale.');
  }
  const distinct = new Map<string, { name: string; mimeType: string }>();
  distinct.set(document.storage_path, {
    name: document.original_filename || 'documento',
    mimeType: document.mime_type || 'application/octet-stream',
  });
  pages.forEach(page => distinct.set(page.storage_path, {
    name: page.original_filename || `pagina-${page.page_number}`,
    mimeType: page.mime_type || 'application/octet-stream',
  }));
  return distinct;
};

export const migrateInternalDocument = async (
  household: Household,
  userId: string,
  document: Document,
) => {
  if (!isInternalDocument(document)) return;
  const files = await migrationFilesForDocument(document);
  const uploadedIds: string[] = [];
  let commitAttempted = false;
  const transferred: Array<{
    old_storage_path: string;
    drive_file_id: string;
    external_url: string | null;
    file_size_bytes: number;
  }> = [];
  try {
    for (const [path, metadata] of files) {
      const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).download(path);
      if (error || !data) throw new Error(`Non riesco a leggere ${metadata.name}: ${error?.message || 'file assente'}`);
      const file = new File([data], metadata.name, { type: metadata.mimeType });
      const driveFile = await uploadFileToGoogleDrive({
        household,
        userId,
        file,
        documentDate: document.document_date || document.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
        filename: metadata.name,
      });
      uploadedIds.push(driveFile.id);
      await verifyGoogleDriveFileSize(driveFile.id, data.size);
      transferred.push({
        old_storage_path: path,
        drive_file_id: driveFile.id,
        external_url: driveFile.webViewLink || null,
        file_size_bytes: data.size,
      });
    }

    // One database transaction changes the document and all its pages together.
    // The originals remain recoverable for at least the transition week.
    commitAttempted = true;
    const { error } = await supabase.rpc('complete_internal_document_migration', {
      p_document_id: document.id,
      p_files: transferred,
    });
    if (error) throw error;
  } catch (error) {
    if (commitAttempted) {
      const { data: current, error: readError } = await supabase
        .from('documents')
        .select('storage_path, storage_provider')
        .eq('id', document.id)
        .maybeSingle();
      if (!readError && current && !isInternalDocument(current)) return;
      // If the read also fails, the commit outcome is unknown: keep the Drive
      // copies rather than risk deleting files now referenced by Contotron.
      if (readError) throw error;
    }
    await Promise.allSettled(uploadedIds.map(id => removeGoogleDriveFile(id)));
    throw error;
  }
};
