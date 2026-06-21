import React, { useState, useRef, useCallback } from 'react';
import Webcam from 'react-webcam';
import Tesseract from 'tesseract.js';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Camera, UploadCloud, Monitor, Smartphone, Crop as CropIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useHousehold } from '../hooks';
import { supabase } from '../lib/supabaseClient';
import { dataUrlToFile, uploadArchiveDocument } from '../lib/documentArchive';
import styles from './ScanReceiptPage.module.css';

// Keyword matching for auto-categorization
const categoryKeywords: Record<string, string[]> = {
  'Alimentari': ['supermercato', 'conad', 'esselunga', 'coop', 'pam', 'carrefour', 'lidl', 'eurospin', 'md', 'spesa', 'alimentari', 'macelleria', 'panetteria', 'ortofrutta'],
  'Trasporti': ['benzina', 'eni', 'q8', 'esso', 'ip', 'tamoil', 'trenitalia', 'italo', 'ryanair', 'parcheggio', 'telepass', 'autostrade', 'taxi', 'bus'],
  'Abitazione': ['enel', 'a2a', 'bolletta', 'luce', 'gas', 'acqua', 'condominio', 'ikea', 'leroy', 'brico', 'ferramenta'],
  'Abitazione Numana': ['numana', 'mare', 'casa vacanza'],
  'Tempo libero': ['ristorante', 'pizzeria', 'bar', 'cinema', 'teatro', 'netflix', 'amazon', 'pub', 'caff', 'gelateria', 'sushi', 'mcdonald', 'sport', 'palestra', 'abbigliamento', 'vestiti'],
  'Figli': ['scuola', 'asilo', 'bambini', 'giocattoli', 'pannolini', 'pediatra', 'mensa'],
  'Cura della persona': ['farmacia', 'dott', 'medico', 'ospedale', 'clinica', 'dentista', 'visita', 'parrucchiere', 'estetista', 'profumeria'],
  'Assicurazione': ['assicurazione', 'polizza', 'unipol', 'genertel', 'allianz', 'axa', 'prima'],
  'Imposte': ['tasse', 'f24', 'imu', 'tari', 'bollo', 'agenzia entrate', 'inps'],
  'Regali e beneficenza': ['regalo', 'donazione', 'unicef', 'savethechildren', 'matrimonio', 'compleanno'],
  'Risparmi': ['risparmio', 'investimento', 'pac', 'fondo', 'titoli', 'azioni'],
  'Prestiti': ['rata', 'mutuo', 'finanziamento', 'prestito', 'compass', 'findomestic', 'agof']
};

export const ScanReceiptPage: React.FC = () => {
  const [status, setStatus] = useState<'idle' | 'webcam' | 'cropping' | 'scanning' | 'done'>('idle');
  const [image, setImage] = useState<string | null>(null);
  
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
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const webcamRef = useRef<Webcam>(null);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const { household, categories } = useHousehold();
  const { user } = useAuth();

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
    if (!image || !imgRef.current) return;
    
    let targetImageSrc = image;
    
    // If user cropped, use the cropped and enhanced image
    if (completedCrop && completedCrop.width > 0 && completedCrop.height > 0) {
       targetImageSrc = await getCroppedImg(imgRef.current, completedCrop);
    }
    
    setStatus('scanning');
    
    try {
      const result = await Tesseract.recognize(targetImageSrc, 'ita', {
        logger: m => console.log(m)
      });
      const text = result.data.text;
      
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      let foundAmount = '0.00';
      
      // Heuristic 1: The Total is usually the LARGEST currency amount on the receipt.
      const amountRegex = /\d+[\.,]\d{2}/g;
      const allMatches = text.match(amountRegex);
      
      let maxAmount = 0;
      if (allMatches) {
        allMatches.forEach(m => {
          const val = parseFloat(m.replace(',', '.'));
          // Ignore suspiciously large numbers
          if (val > maxAmount && val < 10000) {
            maxAmount = val;
          }
        });
      }
      
      if (maxAmount > 0) {
         foundAmount = maxAmount.toFixed(2);
      }

      // Heuristic 2: Merchant is usually the first non-empty line containing text
      let foundMerchant = lines.find(l => /[a-zA-Z]{4,}/.test(l)) || (lines.length > 0 ? lines[0] : '');
      const cleanMerchant = foundMerchant.replace(/[^a-zA-Z0-9\s\.\-&]/g, '').substring(0, 30).trim();
      
      setAmount(foundAmount);
      setMerchant(cleanMerchant || 'Esercente Sconosciuto');

      // Auto categorization
      const fullTextLower = text.toLowerCase();
      let matchedCategoryId = '';
      let matchedSubcategoryId = '';
      let matchFoundInDb = false;

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
          const merchantLower = cleanMerchant.toLowerCase();
          const merchantMatch = rules.find(r => r.match_text.toLowerCase() === merchantLower);
          
          if (merchantMatch) {
            matchedCategoryId = merchantMatch.category_id;
            matchedSubcategoryId = merchantMatch.subcategory_id || '';
            matchFoundInDb = true;
          } else {
            // Then try to find any rule keyword in the full text
            for (const rule of rules) {
              if (fullTextLower.includes(rule.match_text.toLowerCase())) {
                matchedCategoryId = rule.category_id;
                matchedSubcategoryId = rule.subcategory_id || '';
                matchFoundInDb = true;
                break;
              }
            }
          }
        }
      }

      // 2. Fallback to hardcoded keywords if no DB match
      if (!matchFoundInDb) {
        let matchedCategoryName = '';
        for (const [catName, keywords] of Object.entries(categoryKeywords)) {
          if (keywords.some(kw => fullTextLower.includes(kw))) {
            matchedCategoryName = catName;
            break;
          }
        }

        if (matchedCategoryName) {
           // Case insensitive matching with DB categories
           const foundCat = categories.find(c => c.name.toLowerCase() === matchedCategoryName.toLowerCase());
           if (foundCat) {
             matchedCategoryId = foundCat.id;
           } else {
             // Fallback: try to find a partial match
             const partialMatch = categories.find(c => c.name.toLowerCase().includes(matchedCategoryName.toLowerCase()));
             if (partialMatch) matchedCategoryId = partialMatch.id;
           }
        }
      }

      setDetectedCategoryId(matchedCategoryId);
      setDetectedSubcategoryId(matchedSubcategoryId);

      if (household && image) {
        try {
          setArchiveError(null);
          const archiveFile = await dataUrlToFile(image, `scontrino-${Date.now()}.jpg`);
          const document = await uploadArchiveDocument({
            householdId: household.id,
            uploadedBy: user?.id || null,
            file: archiveFile,
            type: 'receipt',
            documentDate: date,
            vendorName: cleanMerchant || 'Scontrino',
            totalAmount: maxAmount > 0 ? maxAmount : null,
          });

          await supabase.from('ocr_jobs').insert([{
            household_id: household.id,
            document_id: document.id,
            provider: 'tesseract',
            status: 'completed',
            extracted_text: text,
            extracted_json: { source: 'scan_receipt' },
            confidence: result.data.confidence,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          }]);

          setArchivedDocumentId(document.id);
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

  const onImageLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result) {
          setImage(reader.result as string);
          setStatus('cropping');
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const captureWebcam = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      setImage(imageSrc);
      setStatus('cropping');
    }
  }, [webcamRef]);

  const handleConfirm = () => {
    navigate('/transazioni/nuova', { 
      state: { 
        amount, 
        merchant, 
        date,
        description: `Acquisto ${merchant}`,
        type: 'expense',
        categoryId: detectedCategoryId,
        subcategoryId: detectedSubcategoryId,
        documentId: archivedDocumentId
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
            
            <div style={{display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '2rem', width: '100%', maxWidth: '300px'}}>
              <input 
                type="file" 
                accept="image/*" 
                capture="environment" 
                style={{display: 'none'}} 
                ref={cameraInputRef}
                onChange={onImageLoad}
              />
              <Button 
                icon={<Smartphone size={18} />} 
                onClick={() => cameraInputRef.current?.click()}
                className="w-full"
              >
                Fotocamera Telefono
              </Button>

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
                style={{display: 'none'}} 
                ref={fileInputRef}
                onChange={onImageLoad}
              />
              <Button 
                variant="ghost" 
                icon={<UploadCloud size={18} />} 
                onClick={() => fileInputRef.current?.click()}
                className="w-full"
              >
                Carica Immagine/PDF
              </Button>
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
                   <img ref={imgRef} src={image} alt="Scontrino" style={{maxWidth: '100%'}} />
                 </ReactCrop>
               )}
             </div>
             <div style={{display: 'flex', gap: '1rem'}}>
              <Button variant="secondary" onClick={() => setStatus('idle')}>Annulla</Button>
              <Button onClick={processImage} icon={<CropIcon size={18} />}>Conferma e Leggi OCR</Button>
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
              <label>Importo Totale (€)</label>
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
            {archivedDocumentId && (
              <p className="text-success fs-sm text-center mb-2">Documento salvato nell'archivio.</p>
            )}
            {archiveError && (
              <p className="text-warning fs-sm text-center mb-2">OCR completato, ma archivio non salvato: {archiveError}</p>
            )}
            <div style={{display: 'flex', gap: '1rem', width: '100%', maxWidth: '400px', marginTop: '1rem'}}>
               <Button variant="secondary" className="w-full" onClick={() => setStatus('cropping')}>Ritaglia di nuovo</Button>
               <Button className="w-full" onClick={handleConfirm}>Procedi</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
