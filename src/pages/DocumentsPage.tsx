import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Tesseract from 'tesseract.js';
import { ExternalLink, FileText, Images, ListPlus, Trash2, UploadCloud, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { supabase } from '../lib/supabaseClient';
import { useAuth, useHousehold } from '../hooks';
import {
  formatMonthKey,
  deleteArchiveDocument,
  getDocumentPages,
  getMonthKey,
  getMonthRange,
  uploadArchiveDocument,
  type DocumentWithUrl,
} from '../lib/documentArchive';
import {
  documentStorageLabels,
  getDocumentStorageProvider,
  getDocumentStorageStatus,
} from '../lib/documentStoragePreference';
import type { Document, DocumentType, OcrJob } from '../types/database';
import styles from './DocumentsPage.module.css';

type DocumentUploaderProfile = {
  display_name: string | null;
  email: string | null;
};

type ArchiveDocument = DocumentWithUrl & {
  uploaded_by_profile?: DocumentUploaderProfile | null;
  transaction_id?: string | null;
  ocr_data?: {
    items?: Array<{
      description?: string;
      amount?: number;
      category_id?: string | null;
      subcategory_id?: string | null;
    }>;
  } | null;
};

const documentTypes: Array<{ value: DocumentType; label: string }> = [
  { value: 'receipt', label: 'Scontrino' },
  { value: 'bill', label: 'Bolletta' },
  { value: 'invoice', label: 'Fattura' },
  { value: 'bank_statement', label: 'Estratto conto' },
  { value: 'contract', label: 'Contratto' },
  { value: 'other', label: 'Altro' },
];

const getTypeLabel = (type: DocumentType) => {
  return documentTypes.find(item => item.value === type)?.label || type;
};

const monthOptions = Array.from({ length: 12 }, (_, index) => {
  const month = index + 1;
  return {
    value: month,
    label: new Date(2026, index, 1).toLocaleDateString('it-IT', { month: 'long' }),
  };
});

export const DocumentsPage: React.FC = () => {
  const navigate = useNavigate();
  const { household } = useHousehold();
  const { user } = useAuth();
  const today = new Date();
  const householdId = household?.id || null;

  const [documents, setDocuments] = useState<ArchiveDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingDocument, setViewingDocument] = useState<ArchiveDocument | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<DocumentType>('receipt');
  const [documentDate, setDocumentDate] = useState(today.toISOString().split('T')[0]);
  const [vendorName, setVendorName] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [runOcr, setRunOcr] = useState(true);

  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | 'all'>(today.getMonth() + 1);
  const [selectedType, setSelectedType] = useState<DocumentType | 'all'>('all');
  const [searchText, setSearchText] = useState('');

  const documentStorageProvider = useMemo(() => getDocumentStorageProvider(household), [household]);
  const documentStorageStatus = useMemo(() => getDocumentStorageStatus(household), [household]);
  const drivePending = documentStorageProvider === 'google_drive' && documentStorageStatus !== 'ready';
  const uploaderLabel = (doc: ArchiveDocument) => {
    const profile = doc.uploaded_by_profile;
    const name = profile?.display_name || profile?.email || 'Sconosciuto';
    return profile?.email && profile.email !== name ? `${name} (${profile.email})` : name;
  };
  const isGoogleDriveDocument = (doc: ArchiveDocument) => (
    doc.storage_provider === 'google_drive' || doc.storage_path.startsWith('google_drive:')
  );

  const fetchDocuments = useCallback(async () => {
    if (!householdId) return;

    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('documents')
        .select(`
          *,
          uploaded_by_profile:profiles!documents_uploaded_by_fkey (
            display_name,
            email
          )
        `)
        .eq('household_id', householdId)
        .order('document_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (selectedMonth !== 'all') {
        const range = getMonthRange(selectedYear, selectedMonth);
        query = query.gte('document_date', range.start).lte('document_date', range.end);
      } else {
        query = query.gte('document_date', `${selectedYear}-01-01`).lte('document_date', `${selectedYear}-12-31`);
      }

      if (selectedType !== 'all') {
        query = query.eq('type', selectedType);
      }

      const { data, error: documentsError } = await query;
      if (documentsError) throw documentsError;

      const documentRows = data || [];
      const documentIds = documentRows.map(doc => doc.id);
      let ocrByDocumentId: Record<string, string | null> = {};
      let ocrDataByDocumentId: Record<string, ArchiveDocument['ocr_data']> = {};
      let transactionByDocumentId: Record<string, string> = {};

      if (documentIds.length > 0) {
        const { data: ocrRows } = await supabase
          .from('ocr_jobs')
          .select('document_id, extracted_text, extracted_json')
          .in('document_id', documentIds);

        ocrByDocumentId = (ocrRows || []).reduce<Record<string, string | null>>((acc, row) => {
          acc[row.document_id] = row.extracted_text || null;
          return acc;
        }, {});
        ocrDataByDocumentId = (ocrRows || []).reduce<Record<string, ArchiveDocument['ocr_data']>>((acc, row) => {
          acc[row.document_id] = (row.extracted_json || null) as ArchiveDocument['ocr_data'];
          return acc;
        }, {});

        const { data: transactionRows, error: transactionError } = await supabase
          .from('transactions')
          .select('id, document_id')
          .eq('household_id', householdId)
          .in('document_id', documentIds);
        if (transactionError) throw transactionError;
        transactionByDocumentId = (transactionRows || []).reduce<Record<string, string>>((acc, row) => {
          if (row.document_id) acc[row.document_id] = row.id;
          return acc;
        }, {});
      }

      const pagesByDocumentId = await getDocumentPages(documentRows as Document[]);
      const withUrls = documentRows.map(doc => ({
        ...doc,
        pages: pagesByDocumentId[doc.id] || [],
        url: pagesByDocumentId[doc.id]?.[0]?.url
          || '',
        ocr_text: ocrByDocumentId[doc.id] || null,
        ocr_data: ocrDataByDocumentId[doc.id] || null,
        transaction_id: transactionByDocumentId[doc.id] || null,
      }));

      setDocuments(withUrls as ArchiveDocument[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Errore durante il caricamento documenti';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [householdId, selectedMonth, selectedType, selectedYear]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void fetchDocuments();
    }, 0);

    return () => window.clearTimeout(loadTimer);
  }, [fetchDocuments]);

  const filteredDocuments = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return documents;

    return documents.filter(doc => {
      const haystack = [
        doc.original_filename,
        doc.vendor_name,
        doc.type,
        doc.status,
        doc.uploaded_by_profile?.display_name,
        doc.uploaded_by_profile?.email,
        doc.storage_provider === 'google_drive' ? 'google drive' : 'archivio interno',
        doc.ocr_text,
      ].filter(Boolean).join(' ').toLowerCase();

      return haystack.includes(query);
    });
  }, [documents, searchText]);

  const groupedDocuments = useMemo(() => {
    return filteredDocuments.reduce<Record<string, ArchiveDocument[]>>((acc, doc) => {
      const key = getMonthKey(doc.document_date);
      acc[key] = acc[key] || [];
      acc[key].push(doc);
      return acc;
    }, {});
  }, [filteredDocuments]);

  const totalAmountVisible = filteredDocuments.reduce((acc, doc) => acc + (doc.total_amount || 0), 0);
  const imageCount = filteredDocuments.reduce((count, doc) => (
    count + (doc.pages?.filter(page => page.mime_type?.startsWith('image/')).length || 0)
  ), 0);

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!household || !file) return;

    setUploading(true);
    setError(null);
    setMessage(null);
    setOcrProgress('');

    try {
      const parsedAmount = totalAmount ? Number(totalAmount.replace(',', '.')) : null;
      const document = await uploadArchiveDocument({
        householdId: household.id,
        household,
        uploadedBy: user?.id || null,
        file,
        type: documentType,
        documentDate,
        vendorName,
        totalAmount: Number.isFinite(parsedAmount) ? parsedAmount : null,
      });

      if (runOcr && file.type.startsWith('image/')) {
        setOcrProgress('OCR in corso...');
        const startedAt = new Date().toISOString();

        try {
          const result = await Tesseract.recognize(file, 'ita');
          const completedAt = new Date().toISOString();

          await supabase.from('ocr_jobs').insert([{
            household_id: household.id,
            document_id: document.id,
            provider: 'tesseract',
            status: 'completed',
            extracted_text: result.data.text,
            extracted_json: { source: 'documents_archive' },
            confidence: result.data.confidence,
            started_at: startedAt,
            completed_at: completedAt,
          } satisfies Partial<OcrJob>]);
        } catch (ocrError) {
          await supabase.from('ocr_jobs').insert([{
            household_id: household.id,
            document_id: document.id,
            provider: 'tesseract',
            status: 'failed',
            error_message: ocrError instanceof Error ? ocrError.message : 'OCR fallito',
            started_at: startedAt,
            completed_at: new Date().toISOString(),
          }]);
        }
      }

      const usedGoogleDrive = document.storage_provider === 'google_drive' || document.storage_path.startsWith('google_drive:');
      let uploadMessage = 'Documento archiviato correttamente.';
      if (drivePending) {
        uploadMessage = "Documento archiviato nell'archivio interno provvisorio. Google Drive e' ancora da collegare.";
      } else if (documentStorageProvider === 'google_drive' && !usedGoogleDrive) {
        uploadMessage = "Google Drive non e' disponibile ora: documento salvato nell'archivio interno provvisorio.";
      } else if (usedGoogleDrive) {
        uploadMessage = 'Documento archiviato nel tuo Google Drive. Gli altri membri vedranno dati, OCR e chi lo ha caricato.';
      }

      setMessage(uploadMessage);
      setFile(null);
      setVendorName('');
      setTotalAmount('');
      setOcrProgress('');
      await fetchDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload non riuscito');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (doc: ArchiveDocument) => {
    const label = doc.vendor_name || doc.original_filename || 'questo documento';
    const confirmed = window.confirm(
      `Vuoi eliminare "${label}" dall'archivio documenti?\n\nLe transazioni gia create resteranno salvate.`,
    );

    if (!confirmed) return;

    setDeletingId(doc.id);
    setError(null);
    setMessage(null);

    try {
      const result = await deleteArchiveDocument(doc);
      if (result.externalFileKept) {
        setMessage('Documento rimosso da Contotron. Il file originale su Google Drive resta nel Drive del membro che lo ha caricato.');
      } else if (result.storageError) {
        setMessage(`Scheda documento eliminata. Attenzione: non sono riuscito a rimuovere il file interno (${result.storageError}).`);
      } else {
        setMessage("Documento eliminato dall'archivio. Le transazioni collegate restano salvate.");
      }
      await fetchDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eliminazione documento non riuscita');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateTransaction = (doc: ArchiveDocument) => {
    const ocrItems = (doc.ocr_data?.items || [])
      .map(item => ({
        description: item.description?.trim() || '',
        amount: Number(item.amount || 0),
        categoryId: item.category_id || undefined,
        subcategoryId: item.subcategory_id || undefined,
      }))
      .filter(item => item.description && Number.isFinite(item.amount) && item.amount > 0);

    navigate('/transazioni/nuova', {
      state: {
        type: 'expense',
        amount: doc.total_amount ? String(doc.total_amount) : '',
        date: doc.document_date || new Date().toISOString().split('T')[0],
        merchant: doc.vendor_name || '',
        description: `Acquisto ${doc.vendor_name || 'da scontrino'}`,
        frequency: 'other',
        documentId: doc.id,
        items: ocrItems,
      },
    });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Archivio Documenti</h1>
          <p className="text-muted">Scontrini, bollette e ricevute ordinati per mese e ricercabili nel tempo.</p>
          <p className="text-muted fs-sm">
            Con Google Drive ogni membro salva i file nel proprio Drive; il nucleo vede sempre scheda, importo, OCR e autore del caricamento.
          </p>
        </div>
      </header>

      <div className={styles.grid}>
        <Card title="Carica documento" icon={<UploadCloud size={20} />}>
          <form onSubmit={handleUpload} className={styles.form}>
            {message && <div className={`${styles.message} ${styles.success}`}>{message}</div>}
            {error && <div className={`${styles.message} ${styles.error}`}>{error}</div>}
            {drivePending && (
              <div className={`${styles.message} ${styles.warning}`}>
                Formula scelta: {documentStorageLabels.google_drive}. Il collegamento Drive non e' ancora attivo, quindi i nuovi file vengono salvati temporaneamente nell'archivio interno.
              </div>
            )}

            <div className={styles.formGroup}>
              <label>File</label>
              <input
                className={styles.fileInput}
                type="file"
                accept="image/*,.pdf,application/pdf"
                onChange={event => setFile(event.target.files?.[0] || null)}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label>Tipo</label>
              <select className={styles.select} value={documentType} onChange={event => setDocumentType(event.target.value as DocumentType)}>
                {documentTypes.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label>Data documento</label>
              <input className={styles.input} type="date" value={documentDate} onChange={event => setDocumentDate(event.target.value)} required />
            </div>

            <div className={styles.formGroup}>
              <label>Argomento / fornitore / negozio</label>
              <input className={styles.input} value={vendorName} onChange={event => setVendorName(event.target.value)} placeholder="es. Conad, Enel, pane, assicurazione" />
            </div>

            <div className={styles.formGroup}>
              <label>Importo totale</label>
              <input className={styles.input} type="number" step="0.01" value={totalAmount} onChange={event => setTotalAmount(event.target.value)} placeholder="0.00" />
            </div>

            <label className="fs-sm text-muted">
              <input type="checkbox" checked={runOcr} onChange={event => setRunOcr(event.target.checked)} /> Leggi il testo con OCR se e' un'immagine
            </label>

            {ocrProgress && <p className="fs-sm text-muted">{ocrProgress}</p>}

            <Button type="submit" disabled={uploading || !file}>
              {uploading ? 'Archiviazione...' : 'Archivia documento'}
            </Button>
          </form>
        </Card>

        <Card title="Documenti salvati" icon={<FileText size={20} />}>
          <div className={styles.filters}>
            <input
              className={styles.input}
              value={searchText}
              onChange={event => setSearchText(event.target.value)}
              placeholder="Cerca fornitore, file, testo OCR..."
            />
            <select className={styles.select} value={selectedYear} onChange={event => setSelectedYear(Number(event.target.value))}>
              {Array.from({ length: 8 }, (_, index) => today.getFullYear() - index).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <select
              className={styles.select}
              value={selectedMonth}
              onChange={event => setSelectedMonth(event.target.value === 'all' ? 'all' : Number(event.target.value))}
            >
              <option value="all">Tutti i mesi</option>
              {monthOptions.map(month => (
                <option key={month.value} value={month.value}>{month.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.filters}>
            <select className={styles.select} value={selectedType} onChange={event => setSelectedType(event.target.value as DocumentType | 'all')}>
              <option value="all">Tutti i tipi</option>
              {documentTypes.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.stats}>
            <div className={styles.statBox}>
              <div className="fs-sm text-muted">Documenti</div>
              <div className={styles.statValue}>{filteredDocuments.length}</div>
            </div>
            <div className={styles.statBox}>
              <div className="fs-sm text-muted">Immagini</div>
              <div className={styles.statValue}>{imageCount}</div>
            </div>
            <div className={styles.statBox}>
              <div className="fs-sm text-muted">Importi tracciati</div>
              <div className={styles.statValue}>{totalAmountVisible.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}</div>
            </div>
          </div>

          {loading ? (
            <div className={styles.empty}>Caricamento documenti...</div>
          ) : filteredDocuments.length === 0 ? (
            <div className={styles.empty}>Nessun documento trovato per i filtri selezionati.</div>
          ) : (
            Object.entries(groupedDocuments).map(([monthKey, docs]) => (
              <section key={monthKey} className={styles.monthSection}>
                <h2 className={styles.monthTitle}>{formatMonthKey(monthKey)}</h2>
                <div className={styles.documentGrid}>
                  {docs.map(doc => (
                    <article key={doc.id} className={styles.documentCard}>
                      <div className={styles.preview}>
                        {doc.mime_type?.startsWith('image/') && doc.url ? (
                          <img src={doc.url} alt={doc.vendor_name || doc.original_filename} />
                        ) : (
                          <FileText size={42} />
                        )}
                      </div>
                      <div className={styles.documentBody}>
                        <span className={styles.typePill}>{getTypeLabel(doc.type)}</span>
                        {(doc.pages?.length || 1) > 1 && (
                          <span className={styles.pagePill}><Images size={13} /> {doc.pages?.length} pagine</span>
                        )}
                        <div className={styles.documentTitle}>{doc.vendor_name || doc.original_filename}</div>
                        <div className={styles.meta}>{doc.document_date || 'Senza data'} - {doc.original_filename}</div>
                        <div className={styles.uploaderMeta}>
                          Caricato da: <strong>{uploaderLabel(doc)}</strong>
                        </div>
                        <div className={styles.storageMeta}>
                          {isGoogleDriveDocument(doc) ? 'Google Drive personale' : 'Archivio interno Contotron'}
                        </div>
                        {doc.type === 'receipt' && !doc.transaction_id && (
                          <div className={styles.orphanWarning}>
                            Questo scontrino non ha ancora una transazione collegata.
                          </div>
                        )}
                        {isGoogleDriveDocument(doc) && doc.uploaded_by !== user?.id && (
                          <div className={styles.accessNote}>
                            File nel Drive di un altro membro: puoi vedere dati e OCR; il link potrebbe richiedere permessi Google.
                          </div>
                        )}
                        {doc.total_amount !== null && doc.total_amount !== undefined && (
                          <div className="fw-bold">{doc.total_amount.toLocaleString('it-IT', { style: 'currency', currency: household?.currency || 'EUR' })}</div>
                        )}
                        {doc.ocr_text && (
                          <div className={styles.meta}>{doc.ocr_text.slice(0, 120)}...</div>
                        )}
                        {(doc.pages?.length || 0) > 1 ? (
                          <button type="button" className={styles.openDocumentButton} onClick={() => setViewingDocument(doc)}>
                            <Images size={14} /> Apri tutte le pagine
                          </button>
                        ) : doc.url && (
                          <a href={doc.url} target="_blank" rel="noreferrer">
                            <ExternalLink size={14} /> Apri documento
                          </a>
                        )}
                        {doc.type === 'receipt' && !doc.transaction_id && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            icon={<ListPlus size={14} />}
                            onClick={() => handleCreateTransaction(doc)}
                          >
                            Crea transazione
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          icon={<Trash2 size={14} />}
                          className={styles.deleteDocumentButton}
                          disabled={deletingId === doc.id}
                          onClick={() => handleDeleteDocument(doc)}
                        >
                          {deletingId === doc.id ? 'Eliminazione...' : 'Elimina documento'}
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
        </Card>
      </div>

      {viewingDocument && (
        <div className={styles.viewerBackdrop} role="presentation" onMouseDown={() => setViewingDocument(null)}>
          <section className={styles.viewerDialog} role="dialog" aria-modal="true" aria-label={`Pagine di ${viewingDocument.vendor_name || viewingDocument.original_filename}`} onMouseDown={event => event.stopPropagation()}>
            <header className={styles.viewerHeader}>
              <div>
                <h2>{viewingDocument.vendor_name || viewingDocument.original_filename}</h2>
                <p>{viewingDocument.pages?.length || 1} pagine - {viewingDocument.document_date || 'Senza data'}</p>
              </div>
              <button type="button" className={styles.closeViewerButton} onClick={() => setViewingDocument(null)} aria-label="Chiudi visualizzatore">
                <X size={22} />
              </button>
            </header>
            <div className={styles.viewerPages}>
              {viewingDocument.pages?.map(page => (
                <article key={page.id} className={styles.viewerPage}>
                  <div className={styles.viewerPageHeading}>
                    <strong>Pagina {page.page_number}</strong>
                    {page.url && (
                      <a href={page.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Apri originale</a>
                    )}
                  </div>
                  {page.mime_type?.startsWith('image/') && page.url ? (
                    <img src={page.url} alt={`Pagina ${page.page_number}`} loading="lazy" />
                  ) : (
                    <div className={styles.viewerFileFallback}><FileText size={42} /> Anteprima non disponibile</div>
                  )}
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
