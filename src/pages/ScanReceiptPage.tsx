import React, { useState, useRef, useCallback } from 'react';
import Webcam from 'react-webcam';
import Tesseract from 'tesseract.js';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Camera, UploadCloud, Monitor, Smartphone, Crop as CropIcon, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useHousehold } from '../hooks';
import { supabase } from '../lib/supabaseClient';
import { dataUrlToFile, deleteArchiveDocument, uploadArchiveDocument } from '../lib/documentArchive';
import { getDocumentStorageProvider, getDocumentStorageStatus } from '../lib/documentStoragePreference';
import { classifyReceiptText, extractReceiptItems, extractReceiptTotal, normalizeSearchText, type ReceiptItemResult } from '../lib/receiptParsing';
import type { Document } from '../types/database';
import styles from './ScanReceiptPage.module.css';

type EditableReceiptItem = ReceiptItemResult & {
  amountText: string;
};

const totalConfidenceLabels: Record<string, string> = {
  high: 'affidabilita alta',
  medium: 'affidabilita media',
  low: 'affidabilita bassa: controlla importo e totale prima di salvare',
  none: 'non rilevato',
};

const MAX_SCAN_IMAGE_SIDE = 1800;
const SCAN_JPEG_QUALITY = 0.86;

const isSupportedImageFile = (file: File) => (
  file.type.startsWith('image/')
  || (file.type === '' && file.size > 0)
  || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name)
);

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => {
    if (typeof reader.result === 'string') {
      resolve(reader.result);
    } else {
      reject(new Error('Risultato immagine non valido'));
    }
  };
  reader.onerror = () => reject(new Error('Impossibile leggere il file immagine'));
  reader.readAsDataURL(blob);
});

const canvasToJpegDataUrl = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/jpeg', SCAN_JPEG_QUALITY);

const fitImageSize = (width: number, height: number) => {
  const longestSide = Math.max(width, height);
  if (longestSide <= MAX_SCAN_IMAGE_SIDE) {
    return { width, height };
  }

  const ratio = MAX_SCAN_IMAGE_SIDE / longestSide;
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
};

const normalizeImageFileForScan = async (file: File): Promise<string> => {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const { width, height } = fitImageSize(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      canvas.width = width;
      canvas.height = height;

      if (!context) {
        bitmap.close();
        throw new Error('Canvas non disponibile');
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      return canvasToJpegDataUrl(canvas);
    } catch (error) {
      console.warn('Normalizzazione immagine con createImageBitmap fallita:', error);
    }
  }

  const originalDataUrl = await blobToDataUrl(file);

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const { width, height } = fitImageSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      canvas.width = width;
      canvas.height = height;

      if (!context) {
        resolve(originalDataUrl);
        return;
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, width, height);
      resolve(canvasToJpegDataUrl(canvas));
    };
    image.onerror = () => resolve(originalDataUrl);
    image.src = originalDataUrl;
  });
};

export const ScanReceiptPage: React.FC = () => {
  const [status, setStatus] = useState<'idle' | 'webcam' | 'cropping' | 'scanning' | 'done'>('idle');
  const [image, setImage] = useState<string | null>(null);
  const [imageReady, setImageReady] = useState(false);
  
  // Crop state
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const imgRef = useRef<HTMLImageElement>(null);
  
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [detectedCategoryId, setDetectedCategoryId] = useState<string>('');
  const [detectedSubcategoryId, setDetectedSubcategoryId] = useState<string>('');
  const [archivedDocumentId, setArchivedDocumentId] = useState<string>('');
  const [archivedDocument, setArchivedDocument] = useState<Document | null>(null);
  const [archivedOnGoogleDrive, setArchivedOnGoogleDrive] = useState(false);
  const [deletingArchivedDocument, setDeletingArchivedDocument] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [ocrHint, setOcrHint] = useState<string | null>(null);
  const [receiptItems, setReceiptItems] = useState<EditableReceiptItem[]>([]);

  const webcamRef = useRef<Webcam>(null);
  const navigate = useNavigate();
  const { household, categories, subcategories, refreshData } = useHousehold();
  const { user } = useAuth();
  const documentStorageProvider = getDocumentStorageProvider(household);
  const documentStorageStatus = getDocumentStorageStatus(household);
  const drivePending = documentStorageProvider === 'google_drive' && documentStorageStatus !== 'ready';
  const expenseCategories = categories
    .filter(category => category.type === 'expense')
    .sort((a, b) => a.name.localeCompare(b.name));
  const detectedCategory = categories.find(category => category.id === detectedCategoryId);
  const detectedSubcategories = subcategories
    .filter(subcategory => subcategory.category_id === detectedCategoryId)
    .sort((a, b) => a.name.localeCompare(b.name));

  const ensureExpenseCategory = async (name: string) => {
    if (!household) return null;

    const existingCategory = categories.find(category => (
      normalizeSearchText(category.name) === normalizeSearchText(name)
    ));

    if (existingCategory) return existingCategory;

    const { data, error } = await supabase
      .from('categories')
      .insert([{
        household_id: household.id,
        name,
        type: 'expense',
        sort_order: 100,
      }])
      .select('*')
      .single();

    if (error) {
      console.error('Errore creazione categoria OCR:', error);
      return null;
    }

    await refreshData();
    return data;
  };

  // Draw crop to canvas to extract just the cropped portion
  const getCroppedImg = async (imageElement: HTMLImageElement, pixelCrop: PixelCrop): Promise<string> => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('No 2d context');
    }

    const scaleX = imageElement.naturalWidth / imageElement.width;
    const scaleY = imageElement.naturalHeight / imageElement.height;
    
    const pixelRatio = window.devicePixelRatio;
    
    canvas.width = Math.floor(pixelCrop.width * scaleX * pixelRatio);
    canvas.height = Math.floor(pixelCrop.height * scaleY * pixelRatio);

    ctx.scale(pixelRatio, pixelRatio);
    ctx.imageSmoothingQuality = 'high';

    const cropX = pixelCrop.x * scaleX;
    const cropY = pixelCrop.y * scaleY;
    const cropWidth = pixelCrop.width * scaleX;
    const cropHeight = pixelCrop.height * scaleY;

    ctx.drawImage(
      imageElement,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight
    );

    // Auto-enhance for OCR (grayscale + high contrast)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i+1] + data[i+2]) / 3;
      const val = avg < 150 ? 0 : 255;
      data[i] = val;
      data[i+1] = val;
      data[i+2] = val;
    }
    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL('image/jpeg');
  };

  const processImage = async () => {
    if (!image) {
      setArchiveError('Carica o scatta una foto dello scontrino prima di avviare OCR.');
      return;
    }

    if (!imgRef.current || !imageReady) {
      setArchiveError("Sto ancora caricando l'immagine. Riprova tra un secondo.");
      return;
    }
    
    let targetImageSrc = image;
    
    // If user cropped, use the cropped and enhanced image
    if (completedCrop && completedCrop.width > 0 && completedCrop.height > 0) {
       targetImageSrc = await getCroppedImg(imgRef.current, completedCrop);
    }
    
    setStatus('scanning');
    
    try {
      const result = await Tesseract.recognize(targetImageSrc, 'ita+eng', {
        logger: m => console.log(m)
      });
      const text = result.data.text;
      
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const totalResult = extractReceiptTotal(text);
      const foundAmount = totalResult.amount ? totalResult.amount.toFixed(2) : '0.00';

      // Heuristic 2: Merchant is usually the first non-empty line containing text
      const foundMerchant = lines.find(l => /[a-zA-Z]{4,}/.test(l)) || (lines.length > 0 ? lines[0] : '');
      const cleanMerchant = foundMerchant.replace(/[^a-zA-Z0-9\s.&-]/g, '').substring(0, 30).trim();
      
      setAmount(foundAmount);
      setMerchant(cleanMerchant || 'Esercente Sconosciuto');

      // Auto categorization
      const fullTextLower = normalizeSearchText(text);
      let matchedCategoryId = '';
      let matchedSubcategoryId = '';
      let matchFoundInDb = false;
      let detectedKeyword = '';
      let suggestedCategoryName = '';
      let categoriesForItemMatching = categories;

      // 1. Try DB Classification Rules
      if (household) {
        // Find all rules for this household
        const { data: rules } = await supabase
          .from('classification_rules')
          .select('*')
          .eq('household_id', household.id)
          .order('priority', { ascending: false })
          .order('use_count', { ascending: false });

        if (rules && rules.length > 0) {
          // First try to match the exact merchant
          const merchantLower = normalizeSearchText(cleanMerchant);
          const merchantMatch = rules.find(r => normalizeSearchText(r.match_text) === merchantLower);
          
          if (merchantMatch) {
            matchedCategoryId = merchantMatch.category_id;
            matchedSubcategoryId = merchantMatch.subcategory_id || '';
            matchFoundInDb = true;
          } else {
            // Then try to find any rule keyword in the full text
            for (const rule of rules) {
              if (fullTextLower.includes(normalizeSearchText(rule.match_text))) {
                matchedCategoryId = rule.category_id;
                matchedSubcategoryId = rule.subcategory_id || '';
                matchFoundInDb = true;
                break;
              }
            }
          }
        }
      }

      // 2. Fallback to saved category/subcategory names and curated keywords
      if (!matchFoundInDb) {
        const categoryMatch = classifyReceiptText(text, categories, subcategories);
        matchedCategoryId = categoryMatch.categoryId;
        matchedSubcategoryId = categoryMatch.subcategoryId;
        detectedKeyword = categoryMatch.matchedKeyword || '';
        suggestedCategoryName = categoryMatch.suggestedCategoryName || '';

        if (!matchedCategoryId && suggestedCategoryName) {
          const createdCategory = await ensureExpenseCategory(suggestedCategoryName);
          if (createdCategory) {
            matchedCategoryId = createdCategory.id;
            categoriesForItemMatching = [...categories, createdCategory];
          }
        }
      }

      const extractedItems = extractReceiptItems(text, categoriesForItemMatching, subcategories);
      const editableItems: EditableReceiptItem[] = [];

      for (const item of extractedItems) {
        let itemCategoryId = item.categoryId;

        if (!itemCategoryId && item.suggestedCategoryName) {
          const createdCategory = await ensureExpenseCategory(item.suggestedCategoryName);
          if (createdCategory) {
            itemCategoryId = createdCategory.id;
            categoriesForItemMatching = [...categoriesForItemMatching, createdCategory];
          }
        }

        editableItems.push({
          ...item,
          categoryId: itemCategoryId,
          amountText: item.amount.toFixed(2),
        });
      }

      setDetectedCategoryId(matchedCategoryId);
      setDetectedSubcategoryId(matchedSubcategoryId);
      setReceiptItems(editableItems);
      setOcrHint([
        totalResult.sourceLine ? `Totale letto da: "${totalResult.sourceLine}" - ${totalConfidenceLabels[totalResult.confidence]}` : '',
        suggestedCategoryName ? `Categoria suggerita: ${suggestedCategoryName}${detectedKeyword ? ` da "${detectedKeyword}"` : ''}` : '',
      ].filter(Boolean).join(' - ') || null);

      if (household && image) {
        try {
          setArchiveError(null);
          const archiveFile = await dataUrlToFile(image, `scontrino-${Date.now()}.jpg`);
          const document = await uploadArchiveDocument({
            householdId: household.id,
            household,
            uploadedBy: user?.id || null,
            file: archiveFile,
            type: 'receipt',
            documentDate: date,
            vendorName: cleanMerchant || 'Scontrino',
            totalAmount: totalResult.amount,
          });

          await supabase.from('ocr_jobs').insert([{
            household_id: household.id,
            document_id: document.id,
            provider: 'tesseract',
            status: 'completed',
            extracted_text: text,
            extracted_json: {
              source: 'scan_receipt',
              total: totalResult,
              detected_category_id: matchedCategoryId || null,
              detected_subcategory_id: matchedSubcategoryId || null,
              detected_keyword: detectedKeyword || null,
              items: editableItems.map(item => ({
                description: item.description,
                amount: Number(item.amountText.replace(',', '.')),
                category_id: item.categoryId || null,
                subcategory_id: item.subcategoryId || null,
                raw_line: item.rawLine,
              })),
            },
            confidence: result.data.confidence,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          }]);

          setArchivedDocumentId(document.id);
          setArchivedDocument(document);
          setArchivedOnGoogleDrive(document.storage_provider === 'google_drive' || document.storage_path.startsWith('google_drive:'));
        } catch (documentError) {
          setArchiveError(documentError instanceof Error ? documentError.message : 'Documento non archiviato');
        }
      }

      setStatus('done');

    } catch (err) {
      console.error(err);
      alert('Errore durante il riconoscimento del testo.');
      setStatus('cropping');
    }
  };

  const resetScanResult = () => {
    setImageReady(false);
    setCrop(undefined);
    setCompletedCrop(undefined);
    setAmount('');
    setMerchant('');
    setDetectedCategoryId('');
    setDetectedSubcategoryId('');
    setArchivedDocumentId('');
    setArchivedDocument(null);
    setArchivedOnGoogleDrive(false);
    setDeletingArchivedDocument(false);
    setArchiveError(null);
    setOcrHint(null);
    setReceiptItems([]);
  };

  const onImageLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';

    if (file) {
      if (!isSupportedImageFile(file)) {
        setArchiveError('Per ora la scansione OCR accetta foto o immagini. I PDF puoi archiviarli dalla pagina Documenti.');
        return;
      }

      try {
        resetScanResult();
        setArchiveError('Preparazione foto per OCR...');
        const normalizedImage = await normalizeImageFileForScan(file);
        setImage(normalizedImage);
        setArchiveError(null);
        setStatus('cropping');
      } catch (error) {
        console.error('Errore lettura immagine:', error);
        setArchiveError('Non riesco a leggere questa immagine. Se e uno scatto HEIC, prova a impostare la fotocamera su JPG e riprova.');
      }
    }
  };

  const captureWebcam = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      resetScanResult();
      setImage(imageSrc);
      setStatus('cropping');
    }
  }, [webcamRef]);

  const updateReceiptItem = (id: string, updates: Partial<EditableReceiptItem>) => {
    setReceiptItems(prev => prev.map(item => (
      item.id === id ? { ...item, ...updates } : item
    )));
  };

  const removeReceiptItem = (id: string) => {
    setReceiptItems(prev => prev.filter(item => item.id !== id));
  };

  const handleDeleteArchivedDocument = async () => {
    if (!archivedDocument) {
      setStatus('idle');
      resetScanResult();
      setImage(null);
      return;
    }

    const confirmed = window.confirm(
      'Vuoi eliminare lo scontrino archiviato e annullare questa scansione?\n\nNessuna transazione verra salvata.',
    );
    if (!confirmed) return;

    setDeletingArchivedDocument(true);
    setArchiveError(null);

    try {
      await deleteArchiveDocument(archivedDocument);
      setImage(null);
      setStatus('idle');
      resetScanResult();
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : 'Non riesco a eliminare lo scontrino archiviato.');
    } finally {
      setDeletingArchivedDocument(false);
    }
  };

  const handleConfirm = () => {
    const items = receiptItems
      .map(item => ({
        description: item.description.trim(),
        amount: Number(item.amountText.replace(',', '.')),
        categoryId: item.categoryId || detectedCategoryId || '',
        subcategoryId: item.subcategoryId || '',
      }))
      .filter(item => item.description && Number.isFinite(item.amount) && item.amount > 0);

    navigate('/transazioni/nuova', { 
      state: { 
        amount, 
        merchant, 
        date,
        description: `Acquisto ${merchant}`,
        type: 'expense',
        categoryId: detectedCategoryId,
        subcategoryId: detectedSubcategoryId,
        documentId: archivedDocumentId,
        items,
      } 
    });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Scansiona Scontrino</h1>
        <p className="text-muted">Acquisisci un documento, ritaglialo e lascia che l'OCR estragga i dati.</p>
      </header>

      <Card className={styles.scanCard}>
        {status === 'idle' && (
          <div className={styles.idleState}>
            <div className={styles.iconCircle}>
              <Camera size={32} />
            </div>
            <p>Scegli come vuoi acquisire lo scontrino:</p>
            {archiveError && <p className="text-warning fs-sm">{archiveError}</p>}
            
            <div style={{display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '2rem', width: '100%', maxWidth: '300px'}}>
              <input 
                type="file" 
                accept="image/*" 
                capture="environment" 
                id="receipt-camera-input"
                className={styles.fileInput}
                onChange={onImageLoad}
              />
              <label className={`${styles.fileButton} ${styles.fileButtonPrimary}`} htmlFor="receipt-camera-input">
                <Smartphone size={18} />
                Fotocamera Telefono
              </label>

              <Button 
                variant="secondary"
                icon={<Monitor size={18} />} 
                onClick={() => setStatus('webcam')}
                className="w-full"
              >
                Webcam PC
              </Button>

              <input 
                type="file" 
                accept="image/*"
                id="receipt-file-input"
                className={styles.fileInput}
                onChange={onImageLoad}
              />
              <label className={`${styles.fileButton} ${styles.fileButtonGhost}`} htmlFor="receipt-file-input">
                <UploadCloud size={18} />
                Carica Immagine
              </label>
            </div>
          </div>
        )}

        {status === 'webcam' && (
          <div style={{width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
            <div style={{marginBottom: '1rem', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--color-gray-200)'}}>
              <Webcam
                audio={false}
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                videoConstraints={{ facingMode: "environment" }}
                style={{width: '100%', maxWidth: '500px'}}
              />
            </div>
            <div style={{display: 'flex', gap: '1rem'}}>
              <Button variant="secondary" onClick={() => setStatus('idle')}>Annulla</Button>
              <Button onClick={captureWebcam} icon={<Camera size={18} />}>Scatta Foto</Button>
            </div>
          </div>
        )}

        {status === 'cropping' && (
          <div style={{width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
             <p className="mb-4 text-muted"><strong>Opzionale ma Consigliato:</strong> Ritaglia l'immagine per includere solo il Totale e l'Esercente. L'immagine verrà messa in bianco e nero in automatico per migliorare l'OCR.</p>
             <div style={{maxWidth: '100%', maxHeight: '60vh', overflow: 'auto', border: '1px solid var(--color-gray-200)', borderRadius: '4px', marginBottom: '1rem'}}>
               {image && (
                 <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)}>
                   <img
                     ref={imgRef}
                     src={image}
                     alt="Scontrino"
                     style={{maxWidth: '100%'}}
                     onLoad={() => setImageReady(true)}
                     onError={() => setArchiveError('Non riesco a mostrare questa immagine. Prova a scattarla di nuovo.')}
                   />
                 </ReactCrop>
               )}
             </div>
             {archiveError && <p className="text-warning fs-sm mb-4">{archiveError}</p>}
             <div style={{display: 'flex', gap: '1rem'}}>
              <Button variant="secondary" onClick={() => setStatus('idle')}>Annulla</Button>
              <Button onClick={processImage} icon={<CropIcon size={18} />} disabled={!imageReady}>
                {imageReady ? 'Conferma e Leggi OCR' : 'Caricamento immagine...'}
              </Button>
            </div>
          </div>
        )}

        {status === 'scanning' && (
          <div className={styles.scanningState}>
            <div className={styles.spinner}></div>
            <p>Analisi OCR in corso con Tesseract.js...<br/><small className="text-muted">Potrebbe richiedere qualche secondo</small></p>
          </div>
        )}

        {status === 'done' && (
          <div className={styles.doneState}>
            <h3 className="text-success mb-4">Dati Estratti!</h3>
            
            <div className={styles.formGroup}>
              <label>Importo totale</label>
              <input type="text" className={styles.input} value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label>Esercente</label>
              <input type="text" className={styles.input} value={merchant} onChange={e => setMerchant(e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label>Data</label>
              <input type="date" className={styles.input} value={date} onChange={e => setDate(e.target.value)} />
            </div>
            {ocrHint && (
              <p className="text-muted fs-sm text-center mb-4">{ocrHint}</p>
            )}
            <div className={styles.formGroup}>
              <label>Categoria dello scontrino</label>
              <select
                className={styles.input}
                value={detectedCategoryId}
                onChange={event => {
                  setDetectedCategoryId(event.target.value);
                  setDetectedSubcategoryId('');
                }}
              >
                <option value="">Seleziona categoria...</option>
                {expenseCategories.map(category => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
              {detectedCategory && (
                <span className="text-success fs-sm">Rilevata: {detectedCategory.name}</span>
              )}
            </div>

            {detectedSubcategories.length > 0 && (
              <div className={styles.formGroup}>
                <label>Sottocategoria</label>
                <select
                  className={styles.input}
                  value={detectedSubcategoryId}
                  onChange={event => setDetectedSubcategoryId(event.target.value)}
                >
                  <option value="">Nessuna sottocategoria</option>
                  {detectedSubcategories.map(subcategory => (
                    <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>
                  ))}
                </select>
              </div>
            )}

            {detectedCategoryId ? (
               <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                 <p className="text-success fs-sm">✨ Categoria trovata automaticamente!</p>
                 {detectedSubcategoryId && (
                   <p className="text-muted fs-sm">Sottocategoria abbinata.</p>
                 )}
               </div>
            ) : (
               <p className="text-warning fs-sm text-center mb-4">⚠️ Nessuna categoria abbinata automaticamente.</p>
            )}
            {receiptItems.length > 0 && (
              <div className={styles.itemsReview}>
                <h4>Articoli rilevati</h4>
                <p className="text-muted fs-sm">
                  Se lo scontrino contiene spese diverse, correggi categoria e importo per ogni riga.
                </p>

                {receiptItems.map(item => {
                  const itemSubcategories = subcategories
                    .filter(subcategory => subcategory.category_id === item.categoryId)
                    .sort((a, b) => a.name.localeCompare(b.name));

                  return (
                    <div key={item.id} className={styles.itemRow}>
                      <input
                        className={styles.itemDescription}
                        value={item.description}
                        onChange={event => updateReceiptItem(item.id, { description: event.target.value })}
                        aria-label="Descrizione articolo"
                      />
                      <input
                        className={styles.itemAmount}
                        value={item.amountText}
                        onChange={event => updateReceiptItem(item.id, { amountText: event.target.value })}
                        aria-label="Importo articolo"
                      />
                      <select
                        className={styles.itemSelect}
                        value={item.categoryId}
                        onChange={event => updateReceiptItem(item.id, { categoryId: event.target.value, subcategoryId: '' })}
                        aria-label="Categoria articolo"
                      >
                        <option value="">Categoria...</option>
                        {expenseCategories.map(category => (
                          <option key={category.id} value={category.id}>{category.name}</option>
                        ))}
                      </select>
                      <select
                        className={styles.itemSelect}
                        value={item.subcategoryId}
                        onChange={event => updateReceiptItem(item.id, { subcategoryId: event.target.value })}
                        aria-label="Sottocategoria articolo"
                        disabled={!item.categoryId || itemSubcategories.length === 0}
                      >
                        <option value="">Sottocategoria...</option>
                        {itemSubcategories.map(subcategory => (
                          <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={styles.removeItemButton}
                        onClick={() => removeReceiptItem(item.id)}
                      >
                        Rimuovi
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {archivedDocumentId && (
              <p className="text-success fs-sm text-center mb-2">
                {archivedOnGoogleDrive
                  ? 'Documento salvato su Google Drive.'
                  : drivePending
                  ? "Documento salvato nell'archivio interno provvisorio. Google Drive e' ancora da collegare."
                  : "Documento salvato nell'archivio."}
              </p>
            )}
            {archiveError && (
              <p className="text-warning fs-sm text-center mb-2">OCR completato, ma archivio non salvato: {archiveError}</p>
            )}
            <div style={{display: 'flex', gap: '1rem', width: '100%', maxWidth: '400px', marginTop: '1rem'}}>
               <Button variant="secondary" className="w-full" onClick={() => setStatus('cropping')}>Ritaglia di nuovo</Button>
               <Button className="w-full" onClick={handleConfirm}>Procedi</Button>
            </div>
            {archivedDocumentId && (
              <div style={{ width: '100%', maxWidth: '400px', marginTop: '0.75rem' }}>
                <Button
                  variant="danger"
                  className="w-full"
                  icon={<Trash2 size={18} />}
                  onClick={handleDeleteArchivedDocument}
                  disabled={deletingArchivedDocument}
                >
                  {deletingArchivedDocument ? 'Eliminazione...' : 'Elimina scontrino e annulla'}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};
