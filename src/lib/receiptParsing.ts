import type { Category, Subcategory } from '../types/database';

export interface ReceiptTotalResult {
  amount: number | null;
  sourceLine: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

export interface ReceiptCategoryResult {
  categoryId: string;
  subcategoryId: string;
  suggestedCategoryName?: string;
  matchedKeyword?: string;
}

export interface ReceiptItemResult {
  id: string;
  rawLine: string;
  description: string;
  amount: number;
  categoryId: string;
  subcategoryId: string;
  suggestedCategoryName?: string;
  matchedKeyword?: string;
}

export interface ReceiptItemsReconciliation {
  items: ReceiptItemResult[];
  correctedDescriptions: string[];
  itemTotal: number;
  difference: number | null;
}

export interface MergedReceiptText {
  text: string;
  removedOverlapLines: number;
}

const categoryKeywords: Record<string, string[]> = {
  Abbigliamento: [
    'abbigliamento',
    'vestito',
    'vestiti',
    'abito',
    'camicia',
    'pantaloni',
    'jeans',
    'maglia',
    't shirt',
    'tshirt',
    'felpa',
    'giacca',
    'scarpe',
    'calzature',
    'calze',
    'intimo',
    'moda',
    'fashion',
    'style',
    'king sport',
    'sport style',
  ],
  Alimentari: [
    'supermercato',
    'conad',
    'esselunga',
    'coop',
    'pam',
    'carrefour',
    'lidl',
    'eurospin',
    'md',
    'spesa',
    'alimentari',
    'macelleria',
    'panetteria',
    'panificio',
    'forno',
    'pane',
    'ortofrutta',
    'mensa',
  ],
  Trasporti: [
    'benzina',
    'eni',
    'q8',
    'esso',
    'ip',
    'tamoil',
    'trenitalia',
    'italo',
    'ryanair',
    'parcheggio',
    'telepass',
    'autostrade',
    'taxi',
    'bus',
  ],
  Abitazione: [
    'enel',
    'a2a',
    'bolletta',
    'luce',
    'gas',
    'acqua',
    'condominio',
    'ikea',
    'leroy',
    'brico',
    'ferramenta',
    'candela',
    'citronella',
  ],
  'Abitazione Numana': ['numana', 'mare', 'casa vacanza'],
  'Tempo libero': [
    'ristorante',
    'pizzeria',
    'bar',
    'cinema',
    'teatro',
    'netflix',
    'amazon',
    'pub',
    'caff',
    'gelateria',
    'sushi',
    'mcdonald',
    'palestra',
    'giocattoli',
  ],
  'Cura della persona': [
    'farmacia',
    'dott',
    'medico',
    'ospedale',
    'clinica',
    'dentista',
    'visita',
    'parrucchiere',
    'estetista',
    'profumeria',
    'pannolini',
    'pediatra',
  ],
  Assicurazione: ['assicurazione', 'polizza', 'unipol', 'genertel', 'allianz', 'axa', 'prima'],
  Imposte: ['tasse', 'f24', 'imu', 'tari', 'bollo', 'agenzia entrate', 'inps'],
  'Regali e beneficenza': ['regalo', 'donazione', 'unicef', 'savethechildren', 'matrimonio', 'compleanno'],
  Risparmi: ['risparmio', 'investimento', 'pac', 'fondo', 'titoli', 'azioni'],
  Prestiti: ['rata', 'mutuo', 'finanziamento', 'prestito', 'compass', 'findomestic', 'agof'],
};

const strongTotalWords = [
  'totale da pagare',
  'totale euro',
  'totale complessivo',
  'totale dovuto',
  'totale vendita',
  'totale corrispettivo',
  'importo totale',
  'totale',
];

const mediumTotalWords = ['importo', 'pagare', 'dovuto', 'saldo', 'tot'];
const hardRejectWords = ['resto', 'cambio', 'iva', 'imponibile', 'aliquota', 'sconto', 'punti', 'articoli', 'pezzi'];
const softRejectWords = ['contante', 'contanti', 'carta', 'bancomat', 'visa', 'mastercard', 'pagato', 'ricevuto'];

export const normalizeSearchText = (value: string) => (
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[0]/g, 'o')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const receiptLineSimilarity = (left: string, right: string) => {
  const leftAmounts = left.match(/\d+[,.]\d{2}/g) || [];
  const rightAmounts = right.match(/\d+[,.]\d{2}/g) || [];
  if (leftAmounts.length > 0 && rightAmounts.length > 0) {
    const normalizedLeftAmounts = leftAmounts.map(value => value.replace(',', '.'));
    const normalizedRightAmounts = rightAmounts.map(value => value.replace(',', '.'));
    if (!normalizedLeftAmounts.some(value => normalizedRightAmounts.includes(value))) return 0;
  }

  const normalizedLeft = normalizeSearchText(left);
  const normalizedRight = normalizeSearchText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  const leftTokens = new Set(normalizedLeft.split(' ').filter(token => token.length > 1));
  const rightTokens = new Set(normalizedRight.split(' ').filter(token => token.length > 1));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  const shared = [...leftTokens].filter(token => rightTokens.has(token)).length;
  return shared / Math.max(leftTokens.size, rightTokens.size);
};

/** Joins OCR pages while removing only duplicated lines at adjacent page boundaries. */
export const mergeReceiptPageTexts = (pageTexts: string[]): MergedReceiptText => {
  const pages = pageTexts
    .map(text => text.split('\n').map(line => line.trim()).filter(Boolean))
    .filter(lines => lines.length > 0);

  if (pages.length === 0) return { text: '', removedOverlapLines: 0 };

  const merged = [...pages[0]];
  let removedOverlapLines = 0;

  for (const nextPage of pages.slice(1)) {
    const maxOverlap = Math.min(8, merged.length, nextPage.length);
    let overlap = 0;

    for (let length = maxOverlap; length >= 1; length -= 1) {
      const previousBoundary = merged.slice(-length);
      const nextBoundary = nextPage.slice(0, length);
      const similarities = previousBoundary.map((line, index) => receiptLineSimilarity(line, nextBoundary[index]));
      const strongMatches = similarities.filter(score => score >= 0.72).length;
      const average = similarities.reduce((sum, score) => sum + score, 0) / length;

      const requiredMatches = length >= 3 ? length - 1 : length;
      if (strongMatches >= requiredMatches && average >= 0.68) {
        overlap = length;
        break;
      }
    }

    removedOverlapLines += overlap;
    merged.push(...nextPage.slice(overlap));
  }

  return {
    text: merged.join('\n'),
    removedOverlapLines,
  };
};

const normalizeMoneyText = (value: string) => (
  value
    .replace(/[Oo]/g, '0')
    .replace(/\s+([,.])\s+/g, '$1')
);

const parseAmountsFromLine = (line: string) => {
  const normalized = normalizeMoneyText(line);
  const regex = /(?:EUR|EURO|€)?\s*(\d{1,4}(?:[.\s]\d{3})*|\d+)\s*[,.]\s*(\d{2})/gi;
  const amounts: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(normalized)) !== null) {
    const trailingText = normalized.slice(match.index + match[0].length);
    if (/^\s*%/.test(trailingText)) continue;

    const integerPart = match[1].replace(/[.\s]/g, '');
    const decimalPart = match[2];
    const value = Number(`${integerPart}.${decimalPart}`);

    if (Number.isFinite(value) && value > 0 && value < 10000) {
      amounts.push(value);
    }
  }

  return amounts;
};

const containsAny = (line: string, words: string[]) => words.some(word => line.includes(word));

export const extractReceiptTotal = (text: string): ReceiptTotalResult => {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const candidates = lines.flatMap((line, index) => {
    const amounts = parseAmountsFromLine(line);
    if (amounts.length === 0) return [];

    const searchableLine = normalizeSearchText(line);
    const hasStrongTotal = containsAny(searchableLine, strongTotalWords);
    const hasMediumTotal = containsAny(searchableLine, mediumTotalWords);
    const hasHardReject = containsAny(searchableLine, hardRejectWords);
    const hasSoftReject = containsAny(searchableLine, softRejectWords);
    const hasCurrency = /€|eur|euro/i.test(line);
    const linePositionBonus = lines.length > 1 ? (index / (lines.length - 1)) * 12 : 0;

    return amounts.map(value => {
      let score = 0;

      if (hasStrongTotal) score += 120;
      if (hasMediumTotal) score += 35;
      if (hasCurrency) score += 12;
      score += linePositionBonus;
      if (hasSoftReject) score -= 25;
      if (hasHardReject) score -= 110;

      return { value, line, score, hasHardReject, hasStrongTotal };
    });
  });

  if (candidates.length === 0) {
    return { amount: null, sourceLine: null, confidence: 'none' };
  }

  const scoredCandidates = candidates
    .filter(candidate => candidate.score > 20)
    .sort((a, b) => b.score - a.score || b.value - a.value);

  if (scoredCandidates.length > 0) {
    const best = scoredCandidates[0];
    return {
      amount: best.value,
      sourceLine: best.line,
      confidence: best.hasStrongTotal ? 'high' : 'medium',
    };
  }

  const fallbackCandidates = candidates
    .filter(candidate => !candidate.hasHardReject)
    .sort((a, b) => b.value - a.value);

  const fallback = fallbackCandidates[0] || candidates.sort((a, b) => b.value - a.value)[0];
  return {
    amount: fallback.value,
    sourceLine: fallback.line,
    confidence: 'low',
  };
};

const findCategoryByName = (categories: Category[], name: string) => {
  const normalizedName = normalizeSearchText(name);

  return categories.find(category => normalizeSearchText(category.name) === normalizedName)
    || categories.find(category => {
      const categoryName = normalizeSearchText(category.name);
      return categoryName.includes(normalizedName) || normalizedName.includes(categoryName);
    });
};

const findMatchingSavedSubcategory = (
  haystack: string,
  subcategories: Subcategory[],
) => (
  [...subcategories]
    .filter(subcategory => {
      const name = normalizeSearchText(subcategory.name);
      return name.length >= 3 && haystack.includes(name);
    })
    .sort((a, b) => b.name.length - a.name.length)[0]
);

const findMatchingSavedCategory = (
  haystack: string,
  categories: Category[],
) => (
  [...categories]
    .filter(category => {
      const name = normalizeSearchText(category.name);
      return name.length >= 3 && haystack.includes(name);
    })
    .sort((a, b) => b.name.length - a.name.length)[0]
);

export const classifyReceiptText = (
  text: string,
  categories: Category[],
  subcategories: Subcategory[],
): ReceiptCategoryResult => {
  const haystack = normalizeSearchText(text);
  const savedSubcategory = findMatchingSavedSubcategory(haystack, subcategories);

  if (savedSubcategory) {
    return {
      categoryId: savedSubcategory.category_id,
      subcategoryId: savedSubcategory.id,
      matchedKeyword: savedSubcategory.name,
    };
  }

  const savedCategory = findMatchingSavedCategory(haystack, categories);
  if (savedCategory) {
    return {
      categoryId: savedCategory.id,
      subcategoryId: '',
      matchedKeyword: savedCategory.name,
    };
  }

  for (const [categoryName, keywords] of Object.entries(categoryKeywords)) {
    const matchedKeyword = keywords.find(keyword => haystack.includes(normalizeSearchText(keyword)));
    if (!matchedKeyword) continue;

    const category = findCategoryByName(categories, categoryName);
    if (category) {
      return {
        categoryId: category.id,
        subcategoryId: '',
        suggestedCategoryName: categoryName,
        matchedKeyword,
      };
    }

    const subcategory = subcategories.find(sub => normalizeSearchText(sub.name) === normalizeSearchText(categoryName));
    if (subcategory) {
      return {
        categoryId: subcategory.category_id,
        subcategoryId: subcategory.id,
        suggestedCategoryName: categoryName,
        matchedKeyword,
      };
    }

    return {
      categoryId: '',
      subcategoryId: '',
      suggestedCategoryName: categoryName,
      matchedKeyword,
    };
  }

  return { categoryId: '', subcategoryId: '' };
};

const itemRejectWords = [
  ...strongTotalWords,
  'subtotale',
  'tot documento',
  'totale documento',
  'contante',
  'contanti',
  'carta',
  'bancomat',
  'resto',
  'cambio',
  'iva',
  'imponibile',
  'aliquota',
  'pagamento',
  'scontrino',
  'documento',
  'operatore',
  'cassa',
  'punti',
];

const cleanupItemDescription = (line: string) => (
  normalizeMoneyText(line)
    .replace(/(?:EUR|EURO)?\s*(\d{1,4}(?:[.\s]\d{3})*|\d+)\s*[,.]\s*\d{2}/gi, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
    .trim()
);

const isUnitPriceOnlyLine = (line: string) => {
  const searchable = normalizeSearchText(line);
  const hasUnitFormula = /\b\d+(?:[,.]\d+)?\s*(?:kg|g|gr|l|lt|ml|cl|pz|pezzi)\s*x\s*(?:eur|euro)?\s*\/?\s*(?:kg|g|gr|l|lt|ml|cl|pz|pezzi)\b/i.test(line);
  const hasProductName = searchable
    .replace(/\b\d+\b/g, ' ')
    .replace(/\b(?:kg|g|gr|l|lt|ml|cl|pz|pezzi|eur|euro|x)\b/g, ' ')
    .replace(/\s+/g, '')
    .length >= 4;

  return hasUnitFormula && !hasProductName;
};

export const extractReceiptItems = (
  text: string,
  categories: Category[],
  subcategories: Subcategory[],
): ReceiptItemResult[] => {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  return lines
    .flatMap((line, index) => {
      const searchableLine = normalizeSearchText(line);
      if (containsAny(searchableLine, itemRejectWords)) return [];
      if (isUnitPriceOnlyLine(line)) return [];
      if (!/[a-zA-Z]{2,}/.test(line)) return [];

      const amounts = parseAmountsFromLine(line);
      if (amounts.length === 0) return [];

      const description = cleanupItemDescription(line);
      if (description.length < 3) return [];

      const amount = amounts[amounts.length - 1];
      const category = classifyReceiptText(description, categories, subcategories);

      return [{
        id: `${index}-${description.slice(0, 12).replace(/\s+/g, '-')}`,
        rawLine: line,
        description,
        amount,
        categoryId: category.categoryId,
        subcategoryId: category.subcategoryId,
        suggestedCategoryName: category.suggestedCategoryName,
        matchedKeyword: category.matchedKeyword,
      }];
    })
    .slice(0, 100);
};

export const reconcileReceiptItems = (
  items: ReceiptItemResult[],
  receiptTotal: number | null,
): ReceiptItemsReconciliation => {
  const reconciledItems = items.map(item => ({ ...item }));
  const correctedDescriptions: string[] = [];

  if (receiptTotal !== null) {
    let currentTotal = reconciledItems.reduce((sum, item) => sum + item.amount, 0);
    let currentDifference = currentTotal - receiptTotal;

    if (currentDifference > 8.5) {
      const candidates = reconciledItems
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.amount >= 9 && item.amount < 10);

      for (const { item, index } of candidates) {
        const correctedAmount = Number((item.amount - 9).toFixed(2));
        const candidateTotal = currentTotal - item.amount + correctedAmount;
        const candidateDifference = candidateTotal - receiptTotal;

        if (Math.abs(candidateDifference) + 0.01 < Math.abs(currentDifference)) {
          reconciledItems[index] = { ...item, amount: correctedAmount };
          correctedDescriptions.push(item.description);
          currentTotal = candidateTotal;
          currentDifference = candidateDifference;
        }

        if (Math.abs(currentDifference) <= 0.05) break;
      }
    }
  }

  const itemTotal = reconciledItems.reduce((sum, item) => sum + item.amount, 0);
  return {
    items: reconciledItems,
    correctedDescriptions,
    itemTotal,
    difference: receiptTotal === null ? null : Number((itemTotal - receiptTotal).toFixed(2)),
  };
};
