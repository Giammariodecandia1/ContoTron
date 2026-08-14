import type { Category, Subcategory } from '../types/database';
import type { AiConfiguration } from './aiConfiguration';
import { requestAiChatCompletion } from './aiClient';

export interface AiReceiptItem {
  description: string;
  amount: number;
  categoryId: string;
  subcategoryId: string;
}

export interface AiReceiptAnalysis {
  merchant: string | null;
  total: number | null;
  date: string | null;
  categoryId: string;
  subcategoryId: string;
  items: AiReceiptItem[];
}

interface RawAiReceipt {
  merchant?: unknown;
  total?: unknown;
  date?: unknown;
  category_id?: unknown;
  subcategory_id?: unknown;
  items?: unknown;
}

const parseJsonObject = (text: string): RawAiReceipt => {
  const withoutFence = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error('L AI non ha restituito dati strutturati.');
  const parsed: unknown = JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Risposta AI non valida.');
  return parsed as RawAiReceipt;
};

const optionalText = (value: unknown, maxLength: number) => (
  typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : null
);

const optionalAmount = (value: unknown) => {
  const amount = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 && amount < 1_000_000 ? Math.round(amount * 100) / 100 : null;
};

export const analyzeReceiptWithAi = async ({
  configuration,
  images,
  ocrText,
  categories,
  subcategories,
}: {
  configuration: AiConfiguration;
  images: string[];
  ocrText: string;
  categories: Category[];
  subcategories: Subcategory[];
}): Promise<AiReceiptAnalysis> => {
  const expenseCategories = categories.filter(category => category.type === 'expense');
  const allowedCategoryIds = new Set(expenseCategories.map(category => category.id));
  const allowedSubcategories = new Map(subcategories.map(subcategory => [subcategory.id, subcategory]));
  const taxonomy = expenseCategories.map(category => ({
    id: category.id,
    name: category.name,
    subcategories: subcategories
      .filter(subcategory => subcategory.category_id === category.id)
      .map(subcategory => ({ id: subcategory.id, name: subcategory.name })),
  }));

  const prompt = `Analizza le immagini di questo scontrino italiano insieme al testo OCR locale.
Restituisci SOLTANTO un oggetto JSON valido, senza markdown, con questa forma:
{"merchant":string|null,"total":number|null,"date":"YYYY-MM-DD"|null,"category_id":string|null,"subcategory_id":string|null,"items":[{"description":string,"amount":number,"category_id":string|null,"subcategory_id":string|null}]}

Regole:
- Il total deve essere l importo effettivamente pagato, non subtotale, IVA, contanti ricevuti o resto.
- Ogni item deve essere un prodotto/servizio acquistato; escludi totale, IVA, pagamenti e prezzi unitari duplicati.
- amount e il totale della riga dopo eventuali sconti.
- Usa soltanto gli ID presenti nella tassonomia. Se incerto usa null.
- Non inventare righe illeggibili. Meglio omettere che indovinare.
- Se lo scontrino continua su piu immagini, elimina le righe sovrapposte.

Tassonomia Contotron:
${JSON.stringify(taxonomy)}

Testo OCR locale:
${ocrText.slice(0, 30_000)}`;

  const response = await requestAiChatCompletion({
    configuration,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...images.map(image => ({ type: 'image_url' as const, image_url: { url: image } })),
      ],
    }],
    maxTokens: 2500,
    timeoutMs: 90_000,
  });
  const raw = parseJsonObject(typeof response.content === 'string' ? response.content : '');
  const categoryId = typeof raw.category_id === 'string' && allowedCategoryIds.has(raw.category_id)
    ? raw.category_id
    : '';
  const subcategory = typeof raw.subcategory_id === 'string' ? allowedSubcategories.get(raw.subcategory_id) : null;
  const subcategoryId = subcategory && (!categoryId || subcategory.category_id === categoryId) ? subcategory.id : '';
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items: AiReceiptItem[] = [];

  rawItems.slice(0, 250).forEach(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const item = value as Record<string, unknown>;
    const description = optionalText(item.description, 160);
    const amount = optionalAmount(item.amount);
    if (!description || amount === null) return;
    const itemCategoryId = typeof item.category_id === 'string' && allowedCategoryIds.has(item.category_id)
      ? item.category_id
      : '';
    const itemSubcategory = typeof item.subcategory_id === 'string' ? allowedSubcategories.get(item.subcategory_id) : null;
    const itemSubcategoryId = itemSubcategory && (!itemCategoryId || itemSubcategory.category_id === itemCategoryId)
      ? itemSubcategory.id
      : '';
    items.push({ description, amount, categoryId: itemCategoryId, subcategoryId: itemSubcategoryId });
  });

  const date = optionalText(raw.date, 10);
  const validDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(new Date(`${date}T12:00:00`).getTime())
    ? date
    : null;
  return {
    merchant: optionalText(raw.merchant, 80),
    total: optionalAmount(raw.total),
    date: validDate,
    categoryId,
    subcategoryId,
    items,
  };
};
