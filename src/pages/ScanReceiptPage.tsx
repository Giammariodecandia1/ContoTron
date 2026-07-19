import React, { useCallback, useMemo, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import Tesseract from 'tesseract.js';
import ReactCrop, { type Crop, type PercentCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Crop as CropIcon,
  Monitor,
  Plus,
  Smartphone,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuth, useHousehold } from '../hooks';
import { supabase } from '../lib/supabaseClient';
import { dataUrlToFile, deleteArchiveDocument, uploadArchiveDocumentPages } from '../lib/documentArchive';
import { getDocumentStorageProvider, getDocumentStorageStatus } from '../lib/documentStoragePreference';
import {
  classifyReceiptText,
  extractReceiptItems,
  extractReceiptTotal,
  mergeReceiptPageTexts,
  normalizeSearchText,
  reconcileReceiptItems,
  type ReceiptItemResult,
} from '../lib/receiptParsing';
import {
  findProductClassificationRule,
  loadProductClassificationRules,
  saveProductClassificationRules,
} from '../lib/productLearning';
import { getCashImpactDate, paymentMethodOptions } from '../lib/paymentTiming';
import { transactionFrequencyOptions } from '../lib/transactionFrequencies';
import type { PaymentMethod, TransactionFrequency } from '../types/database';
import styles from './ScanReceiptPage.module.css';

type ScanStatus = 'idle' | 'webcam' | 'reviewing' | 'scanning' | 'done';

type ReceiptPage = {
  id: string;
  image: string;
  crop?: PercentCrop;
};

type OcrPageResult = {
  pageNumber: number;
  text: string;
  confidence: number;
};

type EditableReceiptItem = ReceiptItemResult & {
  amountText: string;
};

const totalConfidenceLabels: Record<string, string> = {
  high: 'affidabilita alta',
  medium: 'affidabilita media',
  low: 'affidabilita bassa: controlla importo e totale prima di salvare',
  none: 'non rilevato',
};

const MAX_SCAN_IMAGE_SIDE = 3000;
const SCAN_JPEG_QUALITY = 0.9;
const MAX_RECEIPT_PAGES = 10;
const MIN_OCR_IMAGE_WIDTH = 1100;
const MAX_OCR_IMAGE_HEIGHT = 6000;

const isSupportedImageFile = (file: File) => (
  file.type.startsWith('image/')
  || (file.type === '' && file.size > 0)
  || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name)
);

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => {
    if (typeof reader.result === 'string') resolve(reader.result);
    else reject(new Error('Risultato immagine non valido'));
  };
  reader.onerror = () => reject(new Error('Impossibile leggere il file immagine'));
  reader.readAsDataURL(blob);
});

const fitImageSize = (width: number, height: number) => {
  const longestSide = Math.max(width, height);
  if (longestSide <= MAX_SCAN_IMAGE_SIDE) return { width, height };

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
      return canvas.toDataURL('image/jpeg', SCAN_JPEG_QUALITY);
    } catch (error) {
      console.warn('Normalizzazione immagine con createImageBitmap fallita:', error);
    }
  }

  const originalDataUrl = await blobToDataUrl(file);
  return new Promise(resolve => {
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
      resolve(canvas.toDataURL('image/jpeg', SCAN_JPEG_QUALITY));
    };
    image.onerror = () => resolve(originalDataUrl);
    image.src = originalDataUrl;
  });
};

const loadDataUrlImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Impossibile preparare una pagina per OCR'));
  image.src = source;
});

const preparePageForOcr = async (page: ReceiptPage, mode: 'standard' | 'strong' = 'standard') => {
  const image = await loadDataUrlImage(page.image);
  const crop = page.crop;
  const sourceX = crop ? Math.round((crop.x / 100) * image.naturalWidth) : 0;
  const sourceY = crop ? Math.round((crop.y / 100) * image.naturalHeight) : 0;
  const sourceWidth = crop ? Math.round((crop.width / 100) * image.naturalWidth) : image.naturalWidth;
  const sourceHeight = crop ? Math.round((crop.height / 100) * image.naturalHeight) : image.naturalHeight;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const widthScale = safeSourceWidth < MIN_OCR_IMAGE_WIDTH ? MIN_OCR_IMAGE_WIDTH / safeSourceWidth : 1;
  const heightScaleLimit = MAX_OCR_IMAGE_HEIGHT / safeSourceHeight;
  const outputScale = Math.max(1, Math.min(widthScale, heightScaleLimit));
  canvas.width = Math.max(1, Math.round(safeSourceWidth * outputScale));
  canvas.height = Math.max(1, Math.round(safeSourceHeight * outputScale));
  if (!context) return page.image;

  context.drawImage(
    image,
    sourceX,
    sourceY,
    Math.max(1, sourceWidth),
    Math.max(1, sourceHeight),
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  for (let index = 0; index < pixels.length; index += 4) {
    const gray = (pixels[index] * 0.299) + (pixels[index + 1] * 0.587) + (pixels[index + 2] * 0.114);
    const contrast = mode === 'strong' ? 1.85 : 1.35;
    const enhanced = Math.max(0, Math.min(255, ((gray - 128) * contrast) + 128));
    pixels[index] = enhanced;
    pixels[index + 1] = enhanced;
    pixels[index + 2] = enhanced;
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
};

const assessOcrText = (text: string, confidence: number) => {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const itemLikeLines = lines.filter(line => (
    /[a-zA-Z]{2,}/.test(line)
    && /\d+\s*[,.]\s*\d{2}/.test(line)
  )).length;
  const score = confidence + Math.min(40, itemLikeLines * 4) + Math.min(20, lines.length * 0.5);
  const expectedItemLines = Math.max(4, Math.floor(lines.length * 0.25));

  return {
    score,
    shouldRetry: confidence < 72 || (lines.length >= 12 && itemLikeLines < expectedItemLines),
  };
};

const createReceiptPage = (image: string): ReceiptPage => ({
  id: crypto.randomUUID(),
  image,
});

export const ScanReceiptPage: React.FC = () => {
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [pages, setPages] = useState<ReceiptPage[]>([]);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [preparingImages, setPreparingImages] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [accountId, setAccountId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('standard');
  const [frequency, setFrequency] = useState<TransactionFrequency | ''>('');
  const [notes, setNotes] = useState('');
  const [detectedCategoryId, setDetectedCategoryId] = useState('');
  const [detectedSubcategoryId, setDetectedSubcategoryId] = useState('');
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [ocrHint, setOcrHint] = useState<string | null>(null);
  const [receiptItems, setReceiptItems] = useState<EditableReceiptItem[]>([]);
  const [ocrPages, setOcrPages] = useState<OcrPageResult[]>([]);
  const [mergedOcrText, setMergedOcrText] = useState('');
  const [removedOverlapLines, setRemovedOverlapLines] = useState(0);
  const [archiving, setArchiving] = useState(false);

  const webcamRef = useRef<Webcam>(null);
  const navigate = useNavigate();
  const { household, accounts, categories, subcategories, refreshData } = useHousehold();
  const { user } = useAuth();
  const documentStorageProvider = getDocumentStorageProvider(household);
  const documentStorageStatus = getDocumentStorageStatus(household);
  const drivePending = documentStorageProvider === 'google_drive' && documentStorageStatus !== 'ready';
  const activePage = pages[activePageIndex] || null;
  const expenseCategories = categories
    .filter(category => category.type === 'expense')
    .sort((left, right) => left.name.localeCompare(right.name));
  const resetResults = () => {
    setAmount('');
    setMerchant('');
    setDetectedCategoryId('');
    setDetectedSubcategoryId('');
    setArchiveError(null);
    setOcrHint(null);
    setReceiptItems([]);
    setOcrPages([]);
    setMergedOcrText('');
    setRemovedOverlapLines(0);
  };

  const resetAll = () => {
    resetResults();
    setPages([]);
    setActivePageIndex(0);
    setAccountId('');
    setPaymentMethod('standard');
    setFrequency('');
    setNotes('');
    setStatus('idle');
  };

  const ensureExpenseCategory = async (name: string) => {
    if (!household) return null;
    const existingCategory = categories.find(category => normalizeSearchText(category.name) === normalizeSearchText(name));
    if (existingCategory) return existingCategory;

    const { data, error } = await supabase
      .from('categories')
      .insert([{ household_id: household.id, name, type: 'expense', sort_order: 100 }])
      .select('*')
      .single();

    if (error) {
      console.error('Errore creazione categoria OCR:', error);
      return null;
    }

    await refreshData();
    return data;
  };

  const addFiles = async (selectedFiles: File[]) => {
    const availableSlots = MAX_RECEIPT_PAGES - pages.length;
    const acceptedFiles = selectedFiles.filter(isSupportedImageFile).slice(0, availableSlots);
    if (acceptedFiles.length === 0) {
      setArchiveError(
        pages.length >= MAX_RECEIPT_PAGES
          ? `Puoi acquisire al massimo ${MAX_RECEIPT_PAGES} pagine per scontrino.`
          : 'Seleziona una foto o immagine valida.',
      );
      return;
    }

    setPreparingImages(true);
    setArchiveError('Preparazione delle foto...');
    try {
      const normalizedImages: string[] = [];
      for (const file of acceptedFiles) normalizedImages.push(await normalizeImageFileForScan(file));

      const newPages = normalizedImages.map(createReceiptPage);
      setPages(previous => [...previous, ...newPages]);
      setActivePageIndex(pages.length);
      resetResults();
      setStatus('reviewing');
      setArchiveError(
        selectedFiles.length > acceptedFiles.length
          ? `Sono state aggiunte ${acceptedFiles.length} foto. Il limite e ${MAX_RECEIPT_PAGES} pagine.`
          : null,
      );
    } catch (error) {
      console.error('Errore lettura immagini:', error);
      setArchiveError('Non riesco a leggere una delle immagini. Se e HEIC, imposta la fotocamera su JPG e riprova.');
    } finally {
      setPreparingImages(false);
    }
  };

  const onImageLoad = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    await addFiles(files);
  };

  const captureWebcam = useCallback(() => {
    const imageSource = webcamRef.current?.getScreenshot();
    if (!imageSource) return;
    setPages(previous => [...previous, createReceiptPage(imageSource)].slice(0, MAX_RECEIPT_PAGES));
    setActivePageIndex(pages.length);
    resetResults();
    setArchiveError(null);
    setStatus('reviewing');
  }, [pages.length]);

  const updateActiveCrop = (crop: PercentCrop) => {
    setPages(previous => previous.map((page, index) => index === activePageIndex ? { ...page, crop } : page));
  };

  const moveActivePage = (direction: -1 | 1) => {
    const destination = activePageIndex + direction;
    if (destination < 0 || destination >= pages.length) return;

    setPages(previous => {
      const reordered = [...previous];
      [reordered[activePageIndex], reordered[destination]] = [reordered[destination], reordered[activePageIndex]];
      return reordered;
    });
    setActivePageIndex(destination);
  };

  const removeActivePage = () => {
    const remaining = pages.filter((_, index) => index !== activePageIndex);
    setPages(remaining);
    setActivePageIndex(Math.max(0, Math.min(activePageIndex, remaining.length - 1)));
    resetResults();
    if (remaining.length === 0) setStatus('idle');
  };

  const processImages = async () => {
    if (pages.length === 0) {
      setArchiveError('Aggiungi almeno una foto dello scontrino.');
      return;
    }

    setStatus('scanning');
    setArchiveError(null);
    setScanProgress(`Preparazione pagina 1 di ${pages.length}...`);

    try {
      const recognizedPages: OcrPageResult[] = [];
      for (let index = 0; index < pages.length; index += 1) {
        setScanProgress(`Lettura OCR pagina ${index + 1} di ${pages.length}...`);
        const targetImage = await preparePageForOcr(pages[index]);
        let result = await Tesseract.recognize(targetImage, 'ita+eng');
        const firstAssessment = assessOcrText(result.data.text, result.data.confidence);

        if (firstAssessment.shouldRetry) {
          setScanProgress(`Seconda lettura pagina ${index + 1} di ${pages.length}...`);
          const strongImage = await preparePageForOcr(pages[index], 'strong');
          const secondResult = await Tesseract.recognize(strongImage, 'ita+eng');
          const secondAssessment = assessOcrText(secondResult.data.text, secondResult.data.confidence);
          if (secondAssessment.score > firstAssessment.score) result = secondResult;
        }
        recognizedPages.push({
          pageNumber: index + 1,
          text: result.data.text,
          confidence: result.data.confidence,
        });
      }

      setScanProgress('Unione delle pagine e classificazione articoli...');
      const merged = mergeReceiptPageTexts(recognizedPages.map(page => page.text));
      if (!merged.text.trim()) throw new Error('Non e stato riconosciuto testo leggibile nelle foto.');

      const firstPageLines = recognizedPages[0].text.split('\n').map(line => line.trim()).filter(Boolean);
      const totalResult = extractReceiptTotal(merged.text);
      const foundMerchant = firstPageLines.find(line => /[a-zA-Z]{4,}/.test(line)) || firstPageLines[0] || '';
      const cleanMerchant = foundMerchant.replace(/[^a-zA-Z0-9\s.&-]/g, '').substring(0, 40).trim();

      setAmount(totalResult.amount ? totalResult.amount.toFixed(2) : '0.00');
      setMerchant(cleanMerchant || 'Esercente sconosciuto');

      const fullTextLower = normalizeSearchText(merged.text);
      let matchedCategoryId = '';
      let matchedSubcategoryId = '';
      let suggestedCategoryName = '';
      let categoriesForItemMatching = categories;

      if (household) {
        const { data: rules } = await supabase
          .from('classification_rules')
          .select('*')
          .eq('household_id', household.id)
          .order('priority', { ascending: false })
          .order('use_count', { ascending: false });

        const merchantLower = normalizeSearchText(cleanMerchant);
        const rule = rules?.find(candidate => normalizeSearchText(candidate.match_text) === merchantLower)
          || rules?.find(candidate => fullTextLower.includes(normalizeSearchText(candidate.match_text)));
        if (rule) {
          matchedCategoryId = rule.category_id;
          matchedSubcategoryId = rule.subcategory_id || '';
        }
      }

      if (!matchedCategoryId) {
        const categoryMatch = classifyReceiptText(merged.text, categories, subcategories);
        matchedCategoryId = categoryMatch.categoryId;
        matchedSubcategoryId = categoryMatch.subcategoryId;
        suggestedCategoryName = categoryMatch.suggestedCategoryName || '';

        if (!matchedCategoryId && suggestedCategoryName) {
          const createdCategory = await ensureExpenseCategory(suggestedCategoryName);
          if (createdCategory) {
            matchedCategoryId = createdCategory.id;
            categoriesForItemMatching = [...categories, createdCategory];
          }
        }
      }

      const receiptLines = merged.text.split('\n').map(line => line.trim()).filter(Boolean);
      const totalSourceKey = normalizeSearchText(totalResult.sourceLine || '');
      const totalSourceIndex = totalSourceKey
        ? receiptLines.findIndex(line => normalizeSearchText(line) === totalSourceKey)
        : -1;
      const totalComesFromReceiptFooter = totalSourceIndex >= Math.floor(receiptLines.length * 0.55);
      const extractedItems = extractReceiptItems(merged.text, categoriesForItemMatching, subcategories)
        .filter(item => !(
          totalResult.amount !== null
          && totalComesFromReceiptFooter
          && normalizeSearchText(item.rawLine) === totalSourceKey
          && Math.abs(item.amount - totalResult.amount) <= 0.01
        ));
      const reconciliation = reconcileReceiptItems(extractedItems, totalResult.amount);
      const productRules = household ? await loadProductClassificationRules(household.id) : [];
      const editableItems: EditableReceiptItem[] = [];

      for (const item of reconciliation.items) {
        const learnedRule = findProductClassificationRule(item.description, productRules);
        let itemCategoryId = learnedRule?.category_id || item.categoryId;
        const itemSubcategoryId = learnedRule?.subcategory_id || item.subcategoryId;

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
          subcategoryId: itemSubcategoryId,
          amountText: item.amount.toFixed(2),
        });
      }

      setDetectedCategoryId(matchedCategoryId);
      setDetectedSubcategoryId(matchedSubcategoryId);
      setReceiptItems(editableItems);
      setOcrPages(recognizedPages);
      setMergedOcrText(merged.text);
      setRemovedOverlapLines(merged.removedOverlapLines);
      setOcrHint([
        `${pages.length} ${pages.length === 1 ? 'pagina analizzata' : 'pagine analizzate'}`,
        merged.removedOverlapLines > 0 ? `${merged.removedOverlapLines} righe sovrapposte eliminate` : '',
        totalResult.sourceLine
          ? `Totale letto da: "${totalResult.sourceLine}" - ${totalConfidenceLabels[totalResult.confidence]}`
          : 'Totale non rilevato',
        reconciliation.correctedDescriptions.length > 0
          ? `Corretto possibile errore 9/0 su: ${reconciliation.correctedDescriptions.join(', ')}`
          : '',
      ].filter(Boolean).join(' - '));
      setStatus('done');
    } catch (error) {
      console.error(error);
      setArchiveError(error instanceof Error ? error.message : 'Errore durante il riconoscimento del testo.');
      setStatus('reviewing');
    } finally {
      setScanProgress('');
    }
  };

  const updateReceiptItem = (id: string, updates: Partial<EditableReceiptItem>) => {
    setReceiptItems(previous => previous.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const removeReceiptItem = (id: string) => {
    setReceiptItems(previous => previous.filter(item => item.id !== id));
  };

  const addReceiptItem = () => {
    setReceiptItems(previous => [...previous, {
      id: `manual-${crypto.randomUUID()}`,
      rawLine: '',
      description: '',
      amount: 0,
      amountText: '',
      categoryId: detectedCategoryId,
      subcategoryId: '',
    }]);
  };

  const receiptItemsTotal = useMemo(() => receiptItems.reduce((sum, item) => {
    const value = Number(item.amountText.replace(',', '.'));
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0), [receiptItems]);
  const receiptAmountNumber = Number(amount.replace(',', '.'));
  const receiptDifference = Number.isFinite(receiptAmountNumber)
    ? Number((receiptItemsTotal - receiptAmountNumber).toFixed(2))
    : null;

  const handleConfirm = async () => {
    if (!household || pages.length === 0) {
      setArchiveError('Nucleo familiare o pagine non disponibili.');
      return;
    }

    const items = receiptItems
      .map(item => ({
        description: item.description.trim(),
        amount: Number(item.amountText.replace(',', '.')),
        categoryId: item.categoryId || detectedCategoryId || '',
        subcategoryId: item.subcategoryId || '',
      }))
      .filter(item => item.description && Number.isFinite(item.amount) && item.amount > 0);

    if (!Number.isFinite(receiptAmountNumber) || receiptAmountNumber <= 0) {
      setArchiveError('Controlla e inserisci un totale dello scontrino valido.');
      return;
    }

    const selectedAccountId = accountId || accounts[0]?.id || null;
    if (!selectedAccountId) {
      setArchiveError('Non e disponibile un conto sul quale registrare la spesa.');
      return;
    }

    if (!frequency) {
      setArchiveError("Seleziona la periodicita dell'acquisto.");
      return;
    }

    if (receiptDifference !== null && Math.abs(receiptDifference) > 0.05) {
      const confirmed = window.confirm(
        `La somma degli articoli (${receiptItemsTotal.toFixed(2)} EUR) differisce dal totale (${receiptAmountNumber.toFixed(2)} EUR) di ${receiptDifference.toFixed(2)} EUR. Vuoi procedere comunque?`,
      );
      if (!confirmed) return;
    }

    setArchiving(true);
    setArchiveError(null);
    try {
      const timestamp = Date.now();
      const files = await Promise.all(pages.map((page, index) => (
        dataUrlToFile(page.image, `scontrino-${timestamp}-pagina-${index + 1}.jpg`)
      )));
      const totalAmount = receiptAmountNumber;
      const document = await uploadArchiveDocumentPages({
        householdId: household.id,
        household,
        uploadedBy: user?.id || null,
        files,
        type: 'receipt',
        documentDate: date,
        vendorName: merchant || 'Scontrino',
        totalAmount,
      });

      const averageConfidence = ocrPages.length > 0
        ? ocrPages.reduce((sum, page) => sum + page.confidence, 0) / ocrPages.length
        : null;
      const { error: ocrError } = await supabase.from('ocr_jobs').insert([{
        household_id: household.id,
        document_id: document.id,
        provider: 'tesseract',
        status: 'completed',
        extracted_text: mergedOcrText,
        extracted_json: {
          source: 'scan_receipt_multipage',
          page_count: pages.length,
          removed_overlap_lines: removedOverlapLines,
          pages: ocrPages,
          detected_category_id: detectedCategoryId || null,
          detected_subcategory_id: detectedSubcategoryId || null,
          items: items.map(item => ({
            description: item.description,
            amount: item.amount,
            category_id: item.categoryId || null,
            subcategory_id: item.subcategoryId || null,
          })),
        },
        confidence: averageConfidence,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      }]);
      if (ocrError) console.error('Testo OCR non archiviato:', ocrError);

      const categorizedItems = items.filter(item => item.categoryId);
      const categoryIds = new Set(categorizedItems.map(item => item.categoryId));
      const subcategoryIds = new Set(items.filter(item => item.subcategoryId).map(item => item.subcategoryId));
      const allItemsShareCategory = items.length > 0 && categorizedItems.length === items.length && categoryIds.size === 1;
      const allItemsShareSubcategory = allItemsShareCategory && subcategoryIds.size === 1
        && items.every(item => item.subcategoryId);

      const { data: transaction, error: transactionError } = await supabase
        .from('transactions')
        .insert([{
          household_id: household.id,
          account_id: selectedAccountId,
          document_id: document.id,
          type: 'expense',
          status: 'confirmed',
          source: 'receipt_ocr',
          payment_method: paymentMethod,
          cash_impact_date: getCashImpactDate(date, paymentMethod),
          frequency,
          transaction_date: date,
          description: `Acquisto ${merchant || 'da scontrino'}`,
          merchant: merchant.trim() || null,
          amount: totalAmount,
          category_id: allItemsShareCategory ? [...categoryIds][0] : null,
          subcategory_id: allItemsShareSubcategory ? [...subcategoryIds][0] : null,
          is_shared: true,
          inserted_by: user?.id || null,
          notes: notes.trim() || null,
        }])
        .select()
        .single();

      if (transactionError || !transaction) {
        await deleteArchiveDocument(document).catch(cleanupError => console.warn('Pulizia documento fallita:', cleanupError));
        throw new Error(transactionError?.message || 'Transazione non salvata.');
      }

      if (items.length > 0) {
        const itemRows = items.map(item => ({
          household_id: household.id,
          transaction_id: transaction.id,
          description: item.description,
          amount: item.amount,
          category_id: item.categoryId || null,
          subcategory_id: item.subcategoryId || null,
          is_confirmed: true,
        }));
        const { error: itemError } = await supabase.from('transaction_items').insert(itemRows);
        if (itemError) {
          await supabase.from('transactions').delete().eq('id', transaction.id);
          await deleteArchiveDocument(document).catch(cleanupError => console.warn('Pulizia documento fallita:', cleanupError));
          throw new Error(`Articoli non salvati: ${itemError.message}`);
        }

        await saveProductClassificationRules({
          householdId: household.id,
          userId: user?.id || null,
          products: items.map(item => ({
            description: item.description,
            categoryId: item.categoryId || null,
            subcategoryId: item.subcategoryId || null,
          })),
        }).catch(error => console.warn('Apprendimento prodotti non completato:', error));
      }

      navigate('/transazioni', { replace: true });
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : 'Non riesco ad archiviare lo scontrino multipagina.');
    } finally {
      setArchiving(false);
    }
  };

  const pageStrip = (
    <div className={styles.pageStrip} aria-label="Pagine dello scontrino">
      {pages.map((page, index) => (
        <button
          key={page.id}
          type="button"
          className={`${styles.pageThumbnail} ${index === activePageIndex ? styles.pageThumbnailActive : ''}`}
          onClick={() => setActivePageIndex(index)}
        >
          <img src={page.image} alt={`Pagina ${index + 1}`} />
          <span>Pagina {index + 1}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Scansiona scontrino</h1>
        <p className="text-muted">Fotografa anche gli scontrini lunghi in piu parti e controlla tutto prima di salvare.</p>
      </header>

      <Card className={styles.scanCard}>
        {status === 'idle' && (
          <div className={styles.idleState}>
            <div className={styles.iconCircle}><Camera size={32} /></div>
            <h2>Acquisisci la prima pagina</h2>
            <p className="text-muted">Per uno scontrino lungo potrai aggiungere altre foto subito dopo.</p>
            {archiveError && <p className="text-warning fs-sm">{archiveError}</p>}
            <div className={styles.captureActions}>
              <input type="file" accept="image/*" capture="environment" id="receipt-camera-input" className={styles.fileInput} onChange={onImageLoad} />
              <label className={`${styles.fileButton} ${styles.fileButtonPrimary}`} htmlFor="receipt-camera-input">
                <Smartphone size={18} /> Fotocamera telefono
              </label>
              <Button variant="secondary" icon={<Monitor size={18} />} onClick={() => setStatus('webcam')} className="w-full">
                Webcam PC
              </Button>
              <input type="file" accept="image/*" multiple id="receipt-file-input" className={styles.fileInput} onChange={onImageLoad} />
              <label className={`${styles.fileButton} ${styles.fileButtonGhost}`} htmlFor="receipt-file-input">
                <UploadCloud size={18} /> Carica foto esistenti
              </label>
            </div>
          </div>
        )}

        {status === 'webcam' && (
          <div className={styles.webcamState}>
            <div className={styles.webcamFrame}>
              <Webcam
                audio={false}
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                videoConstraints={{ facingMode: 'environment' }}
              />
            </div>
            <div className={styles.actionRow}>
              <Button variant="secondary" onClick={() => setStatus(pages.length ? 'reviewing' : 'idle')}>Annulla</Button>
              <Button onClick={captureWebcam} icon={<Camera size={18} />}>Scatta foto</Button>
            </div>
          </div>
        )}

        {status === 'reviewing' && activePage && (
          <div className={styles.reviewState}>
            <div className={styles.reviewHeader}>
              <div>
                <h2>{pages.length === 1 ? '1 pagina acquisita' : `${pages.length} pagine acquisite`}</h2>
                <p className="text-muted fs-sm">Lascia 2-3 righe sovrapposte tra una foto e la successiva. Verranno eliminate automaticamente.</p>
              </div>
              <span className={styles.pageLimit}>{pages.length}/{MAX_RECEIPT_PAGES}</span>
            </div>
            {pageStrip}

            <div className={styles.pageToolbar}>
              <Button variant="secondary" size="sm" icon={<ArrowUp size={16} />} disabled={activePageIndex === 0} onClick={() => moveActivePage(-1)}>
                Prima
              </Button>
              <Button variant="secondary" size="sm" icon={<ArrowDown size={16} />} disabled={activePageIndex === pages.length - 1} onClick={() => moveActivePage(1)}>
                Dopo
              </Button>
              <Button variant="danger" size="sm" icon={<Trash2 size={16} />} onClick={removeActivePage}>
                Rimuovi
              </Button>
            </div>

            <div className={styles.cropFrame}>
              <ReactCrop
                crop={activePage.crop as Crop | undefined}
                onChange={(_, percentCrop) => updateActiveCrop(percentCrop)}
              >
                <img src={activePage.image} alt={`Pagina ${activePageIndex + 1} dello scontrino`} />
              </ReactCrop>
            </div>
            <p className="text-muted fs-sm">Il ritaglio e facoltativo. Includi l'intera porzione visibile dello scontrino, non soltanto il totale.</p>

            {archiveError && <p className="text-warning fs-sm">{archiveError}</p>}
            <div className={styles.addPageActions}>
              <input type="file" accept="image/*" capture="environment" id="receipt-add-camera-input" className={styles.fileInput} onChange={onImageLoad} />
              <label className={`${styles.fileButton} ${styles.fileButtonPrimary}`} htmlFor="receipt-add-camera-input">
                <Camera size={18} /> Aggiungi altra foto
              </label>
              <input type="file" accept="image/*" multiple id="receipt-add-file-input" className={styles.fileInput} onChange={onImageLoad} />
              <label className={`${styles.fileButton} ${styles.fileButtonGhost}`} htmlFor="receipt-add-file-input">
                <Plus size={18} /> Aggiungi dalla galleria
              </label>
            </div>
            <div className={styles.actionRow}>
              <Button variant="secondary" onClick={resetAll}>Annulla scansione</Button>
              <Button icon={<CropIcon size={18} />} onClick={processImages} disabled={preparingImages}>
                {preparingImages ? 'Preparazione...' : `Analizza ${pages.length} ${pages.length === 1 ? 'pagina' : 'pagine'}`}
              </Button>
            </div>
          </div>
        )}

        {status === 'scanning' && (
          <div className={styles.scanningState}>
            <div className={styles.spinner}></div>
            <p>{scanProgress || 'Analisi OCR in corso...'}</p>
            <small className="text-muted">Non chiudere questa pagina durante la lettura.</small>
          </div>
        )}

        {status === 'done' && (
          <div className={styles.doneState}>
            <div className={styles.doneHeading}>
              <div>
                <h2>Dati estratti</h2>
                <p className="text-muted fs-sm">Controlla totale, righe e categorie prima di creare la transazione.</p>
              </div>
              <span className={styles.pageCountBadge}>{pages.length} {pages.length === 1 ? 'pagina' : 'pagine'}</span>
            </div>
            {pageStrip}

            <div className={styles.summaryGrid}>
              <div className={styles.formGroup}>
                <label>Importo totale</label>
                <input type="text" inputMode="decimal" className={styles.input} value={amount} onChange={event => setAmount(event.target.value)} />
              </div>
              <div className={styles.formGroup}>
                <label>Esercente</label>
                <input type="text" className={styles.input} value={merchant} onChange={event => setMerchant(event.target.value)} />
              </div>
              <div className={styles.formGroup}>
                <label>Data</label>
                <input type="date" className={styles.input} value={date} onChange={event => setDate(event.target.value)} />
              </div>
              {accounts.length > 1 && (
                <div className={styles.formGroup}>
                  <label>Conto</label>
                  <select className={styles.input} value={accountId || accounts[0]?.id || ''} onChange={event => setAccountId(event.target.value)}>
                    {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </div>
              )}
              <div className={styles.formGroup}>
                <label>Tipologia pagamento</label>
                <select className={styles.input} value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as PaymentMethod)}>
                  {paymentMethodOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>Periodicita dell'acquisto</label>
                <select className={styles.input} value={frequency} onChange={event => setFrequency(event.target.value as TransactionFrequency)} required>
                  <option value="">Seleziona periodicita...</option>
                  {transactionFrequencyOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>Commento / promemoria</label>
                <textarea className={styles.input} rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Dettaglio opzionale sulla spesa" />
              </div>
            </div>

            {ocrHint && <p className={styles.ocrHint}>{ocrHint}</p>}

            <div className={styles.itemsReview}>
              <div className={styles.itemsHeader}>
                <div>
                  <h3>Articoli rilevati</h3>
                  <p className="text-muted fs-sm">Correggi descrizione, prezzo e classificazione di ogni riga.</p>
                </div>
                <Button type="button" variant="secondary" size="sm" icon={<Plus size={16} />} onClick={addReceiptItem}>
                  Aggiungi riga
                </Button>
              </div>

              {receiptItems.length === 0 && <p className="text-warning fs-sm">Nessun articolo riconosciuto. Puoi aggiungere le righe manualmente.</p>}
              {receiptItems.map(item => {
                const itemSubcategories = subcategories
                  .filter(subcategory => subcategory.category_id === item.categoryId)
                  .sort((left, right) => left.name.localeCompare(right.name));

                return (
                  <div key={item.id} className={styles.itemRow}>
                    <input className={styles.itemDescription} value={item.description} onChange={event => updateReceiptItem(item.id, { description: event.target.value })} aria-label="Descrizione articolo" placeholder="Descrizione" />
                    <input className={styles.itemAmount} inputMode="decimal" value={item.amountText} onChange={event => updateReceiptItem(item.id, { amountText: event.target.value })} aria-label="Importo articolo" placeholder="0,00" />
                    <select className={styles.itemSelect} value={item.categoryId} onChange={event => updateReceiptItem(item.id, { categoryId: event.target.value, subcategoryId: '' })} aria-label="Categoria articolo">
                      <option value="">Categoria...</option>
                      {expenseCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                    <select className={styles.itemSelect} value={item.subcategoryId} onChange={event => updateReceiptItem(item.id, { subcategoryId: event.target.value })} aria-label="Sottocategoria articolo" disabled={!item.categoryId || itemSubcategories.length === 0}>
                      <option value="">Sottocategoria...</option>
                      {itemSubcategories.map(subcategory => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}
                    </select>
                    <button type="button" className={styles.removeItemButton} onClick={() => removeReceiptItem(item.id)} aria-label="Rimuovi articolo">
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}

              <div className={styles.reconciliationSummary}>
                <span>Somma articoli: <strong>{receiptItemsTotal.toFixed(2)} EUR</strong></span>
                <span className={receiptDifference !== null && Math.abs(receiptDifference) > 0.05 ? styles.reconciliationWarning : styles.reconciliationOk}>
                  {receiptDifference === null
                    ? 'Totale non disponibile'
                    : Math.abs(receiptDifference) <= 0.05
                    ? 'Somma verificata'
                    : `Differenza: ${receiptDifference.toFixed(2)} EUR`}
                </span>
              </div>
            </div>

            <p className="text-muted fs-sm text-center">
              {drivePending
                ? "Le pagine verranno salvate nell'archivio interno provvisorio finche Google Drive non sara collegato."
                : `Le ${pages.length} pagine verranno archiviate insieme come un unico documento.`}
            </p>
            {archiveError && <p className="text-warning fs-sm text-center">{archiveError}</p>}
            <div className={styles.actionRow}>
              <Button variant="secondary" onClick={() => setStatus('reviewing')} disabled={archiving}>Rivedi foto</Button>
              <Button onClick={handleConfirm} disabled={archiving}>
                {archiving ? 'Salvataggio completo...' : 'Salva scontrino e transazione'}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
