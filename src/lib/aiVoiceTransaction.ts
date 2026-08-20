import type { Account, Category, PaymentMethod, Subcategory, TransactionType } from '../types/database';
import type { AiConfiguration } from './aiConfiguration';
import { requestAiChatCompletion } from './aiClient';

export interface AiVoiceTransactionDraft {
  type: TransactionType | null;
  amount: number | null;
  date: string | null;
  categoryId: string;
  subcategoryId: string;
  accountId: string;
  merchant: string | null;
  description: string | null;
  notes: string | null;
  paymentMethod: PaymentMethod | null;
  isShared: boolean | null;
}

interface RawAiVoiceTransaction {
  type?: unknown;
  amount?: unknown;
  date?: unknown;
  category_id?: unknown;
  subcategory_id?: unknown;
  account_id?: unknown;
  merchant?: unknown;
  description?: unknown;
  notes?: unknown;
  payment_method?: unknown;
  is_shared?: unknown;
}

const parseJsonObject = (text: string): RawAiVoiceTransaction => {
  const withoutFence = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error("L'AI non ha restituito una transazione valida.");
  const parsed: unknown = JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Risposta AI non valida.');
  return parsed as RawAiVoiceTransaction;
};

const optionalText = (value: unknown, maxLength: number) => (
  typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : null
);

const optionalAmount = (value: unknown) => {
  const amount = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 && amount < 1_000_000 ? Math.round(amount * 100) / 100 : null;
};

const validDate = (value: unknown) => {
  const date = optionalText(value, 10);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T12:00:00`).getTime())
    ? date
    : null;
};

export const analyzeVoiceTransactionWithAi = async ({
  configuration,
  transcript,
  categories,
  subcategories,
  accounts,
  today,
}: {
  configuration: AiConfiguration;
  transcript: string;
  categories: Category[];
  subcategories: Subcategory[];
  accounts: Account[];
  today: string;
}): Promise<AiVoiceTransactionDraft> => {
  const categoryMap = new Map(categories.map(category => [category.id, category]));
  const subcategoryMap = new Map(subcategories.map(subcategory => [subcategory.id, subcategory]));
  const accountIds = new Set(accounts.map(account => account.id));
  const taxonomy = categories.map(category => ({
    id: category.id,
    name: category.name,
    type: category.type,
    subcategories: subcategories
      .filter(subcategory => subcategory.category_id === category.id)
      .map(subcategory => ({ id: subcategory.id, name: subcategory.name })),
  }));

  const prompt = `Interpreta questo comando vocale italiano per compilare una transazione Contotron.
Oggi e ${today}. Restituisci SOLTANTO un oggetto JSON valido, senza markdown:
{"type":"expense"|"income"|null,"amount":number|null,"date":"YYYY-MM-DD"|null,"category_id":string|null,"subcategory_id":string|null,"account_id":string|null,"merchant":string|null,"description":string|null,"notes":string|null,"payment_method":"standard"|"credit_card"|null,"is_shared":boolean|null}

Regole:
- Non inventare dati: usa null se il comando non li dice chiaramente.
- "personale", "per me", "mio" significa is_shared=false. "familiare", "comune", "da dividere" significa is_shared=true.
- Per un'uscita non nominata, type e expense; per entrate come stipendio/rimborso, income.
- Usa esclusivamente gli ID di categorie, sottocategorie e conti elencati qui sotto.
- La sottocategoria deve appartenere alla categoria scelta.
- Mantieni importi in euro come numeri decimali, senza simboli.

Categorie disponibili:
${JSON.stringify(taxonomy)}

Conti disponibili:
${JSON.stringify(accounts.map(account => ({ id: account.id, name: account.name })))}

Comando vocale:
${transcript.slice(0, 2_000)}`;

  const response = await requestAiChatCompletion({
    configuration,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 900,
    timeoutMs: 60_000,
  });
  const raw = parseJsonObject(typeof response.content === 'string' ? response.content : '');
  const type: TransactionType | null = raw.type === 'expense' || raw.type === 'income' ? raw.type : null;
  const category = typeof raw.category_id === 'string' ? categoryMap.get(raw.category_id) : null;
  const categoryId = category && (!type || category.type === type) ? category.id : '';
  const subcategory = typeof raw.subcategory_id === 'string' ? subcategoryMap.get(raw.subcategory_id) : null;
  const subcategoryId = subcategory && subcategory.category_id === categoryId ? subcategory.id : '';

  return {
    type,
    amount: optionalAmount(raw.amount),
    date: validDate(raw.date),
    categoryId,
    subcategoryId,
    accountId: typeof raw.account_id === 'string' && accountIds.has(raw.account_id) ? raw.account_id : '',
    merchant: optionalText(raw.merchant, 80),
    description: optionalText(raw.description, 180),
    notes: optionalText(raw.notes, 500),
    paymentMethod: raw.payment_method === 'credit_card' || raw.payment_method === 'standard'
      ? raw.payment_method
      : null,
    isShared: typeof raw.is_shared === 'boolean' ? raw.is_shared : null,
  };
};
