import type { AiConfiguration } from './aiConfiguration';
import {
  AiConnectionError,
  requestAiChatCompletion,
  type AiChatMessage,
  type AiToolDefinition,
} from './aiClient';
import { calculateEqualSplit } from './splitCalculator';
import { supabase } from './supabaseClient';

interface FinancialTransaction {
  id: string;
  transaction_date: string;
  cash_impact_date: string | null;
  description: string;
  merchant: string | null;
  amount: number;
  type: string;
  status: string;
  category_id: string | null;
  subcategory_id: string | null;
  inserted_by: string | null;
  is_shared: boolean;
  categories?: { name?: string | null } | null;
  subcategories?: { name?: string | null } | null;
  inserted_by_profile?: { display_name?: string | null; email?: string | null } | null;
}

interface ToolContext {
  householdId: string;
  userId: string;
  currency: string;
}

export interface FinancialChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const isoDate = (date: Date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');

const currentMonthRange = () => {
  const now = new Date();
  return {
    from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
};

const safeRange = (args: Record<string, unknown>) => {
  const fallback = currentMonthRange();
  const from = typeof args.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.from) ? args.from : fallback.from;
  const to = typeof args.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.to) ? args.to : fallback.to;
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (start > end) throw new Error('Intervallo non valido: la data iniziale supera quella finale.');
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (days > 400) throw new Error('Intervallo troppo ampio. Richiedi al massimo 400 giorni per volta.');
  return { from, to };
};

const fetchExpenseTransactions = async (context: ToolContext, args: Record<string, unknown>) => {
  const { from, to } = safeRange(args);
  const { data, error } = await supabase
    .from('transactions')
    .select(`
      id, transaction_date, cash_impact_date, description, merchant, amount, type, status,
      category_id, subcategory_id, inserted_by, is_shared,
      categories(name), subcategories(name),
      inserted_by_profile:profiles!transactions_inserted_by_fkey(display_name, email)
    `)
    .eq('household_id', context.householdId)
    .eq('type', 'expense')
    .neq('status', 'deleted')
    .neq('status', 'rejected')
    .or([
      `and(cash_impact_date.gte.${from},cash_impact_date.lte.${to})`,
      `and(cash_impact_date.is.null,transaction_date.gte.${from},transaction_date.lte.${to})`,
    ].join(','))
    .order('transaction_date', { ascending: false });
  if (error) throw error;
  return { from, to, transactions: (data || []) as unknown as FinancialTransaction[] };
};

const round = (amount: number) => Math.round(amount * 100) / 100;

const spendingSummary = async (context: ToolContext, args: Record<string, unknown>) => {
  const { from, to, transactions } = await fetchExpenseTransactions(context, args);
  const householdTotal = transactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const myTotal = transactions
    .filter(transaction => transaction.inserted_by === context.userId)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const sharedTotal = transactions
    .filter(transaction => transaction.is_shared !== false)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const personalTotal = transactions
    .filter(transaction => transaction.is_shared === false)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  return {
    from,
    to,
    currency: context.currency,
    household_total: round(householdTotal),
    my_total: round(myTotal),
    shared_total: round(sharedTotal),
    personal_expenses_total: round(personalTotal),
    transaction_count: transactions.length,
  };
};

const spendingByCategory = async (context: ToolContext, args: Record<string, unknown>) => {
  const { from, to, transactions } = await fetchExpenseTransactions(context, args);
  const totals = new Map<string, { amount: number; count: number }>();
  transactions.forEach(transaction => {
    const category = transaction.categories?.name || 'Non classificato';
    const current = totals.get(category) || { amount: 0, count: 0 };
    current.amount += Number(transaction.amount || 0);
    current.count += 1;
    totals.set(category, current);
  });
  return {
    from,
    to,
    currency: context.currency,
    categories: [...totals.entries()]
      .map(([category, value]) => ({ category, amount: round(value.amount), count: value.count }))
      .sort((left, right) => right.amount - left.amount),
  };
};

const memberSpending = async (context: ToolContext, args: Record<string, unknown>) => {
  const { from, to, transactions } = await fetchExpenseTransactions(context, args);
  const totals = new Map<string, { name: string; amount: number; count: number }>();
  transactions.forEach(transaction => {
    const id = transaction.inserted_by || 'unknown';
    const name = transaction.inserted_by_profile?.display_name
      || transaction.inserted_by_profile?.email
      || 'Non attribuito';
    const current = totals.get(id) || { name, amount: 0, count: 0 };
    current.amount += Number(transaction.amount || 0);
    current.count += 1;
    totals.set(id, current);
  });
  return {
    from,
    to,
    currency: context.currency,
    members: [...totals.entries()]
      .map(([userId, value]) => ({
        user_id: userId,
        member: value.name,
        amount: round(value.amount),
        count: value.count,
        is_current_user: userId === context.userId,
      }))
      .sort((left, right) => right.amount - left.amount),
  };
};

const recentTransactions = async (context: ToolContext, args: Record<string, unknown>) => {
  const { from, to, transactions } = await fetchExpenseTransactions(context, args);
  const requestedLimit = typeof args.limit === 'number' ? args.limit : Number(args.limit || 20);
  const limit = Math.max(1, Math.min(50, Number.isFinite(requestedLimit) ? requestedLimit : 20));
  return {
    from,
    to,
    currency: context.currency,
    transactions: transactions.slice(0, limit).map(transaction => ({
      date: transaction.cash_impact_date || transaction.transaction_date,
      description: transaction.description,
      merchant: transaction.merchant,
      amount: round(Number(transaction.amount || 0)),
      category: transaction.categories?.name || 'Non classificato',
      subcategory: transaction.subcategories?.name || null,
      member: transaction.inserted_by_profile?.display_name || transaction.inserted_by_profile?.email || 'Non attribuito',
      shared: transaction.is_shared !== false,
    })),
  };
};

const budgetStatus = async (context: ToolContext, args: Record<string, unknown>) => {
  const now = new Date();
  const year = Math.max(2000, Math.min(2100, Number(args.year || now.getFullYear())));
  const month = Math.max(1, Math.min(12, Number(args.month || now.getMonth() + 1)));
  const from = isoDate(new Date(year, month - 1, 1));
  const to = isoDate(new Date(year, month, 0));
  const [{ transactions }, budgetResult] = await Promise.all([
    fetchExpenseTransactions(context, { from, to }),
    supabase
      .from('budget_targets')
      .select('planned_amount, category_id, categories(name)')
      .eq('household_id', context.householdId)
      .eq('year', year)
      .eq('month', month),
  ]);
  if (budgetResult.error) throw budgetResult.error;
  const planned = (budgetResult.data || []).reduce((sum, row) => sum + Number(row.planned_amount || 0), 0);
  const actual = transactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  return {
    year,
    month,
    currency: context.currency,
    planned_total: round(planned),
    actual_total: round(actual),
    remaining: round(planned - actual),
    used_percentage: planned > 0 ? round(actual / planned * 100) : null,
  };
};

const splitStatus = async (context: ToolContext, args: Record<string, unknown>) => {
  const [{ from, to, transactions }, membersResult] = await Promise.all([
    fetchExpenseTransactions(context, args),
    supabase
      .from('household_members')
      .select('user_id, profiles!household_members_user_id_fkey(display_name, email)')
      .eq('household_id', context.householdId)
      .order('created_at'),
  ]);
  if (membersResult.error) throw membersResult.error;
  const members = (membersResult.data || []).map(row => {
    const profile = row.profiles as unknown as { display_name?: string | null; email?: string | null } | null;
    return {
      userId: row.user_id,
      displayName: profile?.display_name || profile?.email || 'Utente',
    };
  });
  const eligible = transactions.filter(transaction => transaction.is_shared !== false && transaction.inserted_by);
  const split = calculateEqualSplit(members, eligible.map(transaction => ({
    userId: transaction.inserted_by || '',
    amountCents: Math.round(Number(transaction.amount || 0) * 100),
  })));
  return {
    from,
    to,
    currency: context.currency,
    total: round(split.totalCents / 100),
    balances: split.balances.map(balance => ({
      member: balance.displayName,
      paid: round(balance.paidCents / 100),
      equal_share: round(balance.shareCents / 100),
      balance: round(balance.balanceCents / 100),
    })),
    settlements: split.settlements.map(settlement => ({
      from: settlement.from,
      to: settlement.to,
      amount: round(settlement.amountCents / 100),
    })),
  };
};

const rangeProperties = {
  from: { type: 'string', description: 'Data iniziale inclusa YYYY-MM-DD. Se omessa usa il primo giorno del mese corrente.' },
  to: { type: 'string', description: 'Data finale inclusa YYYY-MM-DD. Se omessa usa l ultimo giorno del mese corrente.' },
};

const tools: AiToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_spending_summary',
      description: 'Restituisce totale del nucleo, totale dell utente corrente, spese condivise e personali in un periodo.',
      parameters: { type: 'object', properties: rangeProperties, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_spending_by_category',
      description: 'Restituisce le spese aggregate per categoria e ordinate dalla maggiore.',
      parameters: { type: 'object', properties: rangeProperties, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_member_spending',
      description: 'Restituisce quanto ha inserito o speso ogni componente del nucleo nel periodo.',
      parameters: { type: 'object', properties: rangeProperties, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_transactions',
      description: 'Restituisce un elenco limitato di transazioni del periodo per rispondere a domande di dettaglio.',
      parameters: {
        type: 'object',
        properties: { ...rangeProperties, limit: { type: 'integer', minimum: 1, maximum: 50 } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_budget_status',
      description: 'Confronta budget pianificato e spese effettive per un mese.',
      parameters: {
        type: 'object',
        properties: { year: { type: 'integer' }, month: { type: 'integer', minimum: 1, maximum: 12 } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_split_status',
      description: 'Calcola lo split paritario delle sole spese condivise e gli eventuali rimborsi tra componenti.',
      parameters: { type: 'object', properties: rangeProperties, additionalProperties: false },
    },
  },
];

const executeTool = async (name: string, rawArguments: string, context: ToolContext) => {
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = rawArguments ? JSON.parse(rawArguments) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch {
    throw new Error('Argomenti dello strumento non validi.');
  }
  switch (name) {
    case 'get_spending_summary': return spendingSummary(context, args);
    case 'get_spending_by_category': return spendingByCategory(context, args);
    case 'get_member_spending': return memberSpending(context, args);
    case 'get_recent_transactions': return recentTransactions(context, args);
    case 'get_budget_status': return budgetStatus(context, args);
    case 'get_split_status': return splitStatus(context, args);
    default: throw new Error(`Strumento non autorizzato: ${name}`);
  }
};

const systemPrompt = (currency: string) => `Sei l Assistente finanziario di Contotron. Oggi e ${isoDate(new Date())}.
Rispondi in italiano, con cifre chiare e senza inventare dati. La valuta del nucleo e ${currency}.
Usa gli strumenti in sola lettura per consultare esclusivamente i dati necessari alla domanda.
Per espressioni come questo mese, mese scorso o quest anno calcola date esatte.
Non puoi creare, modificare o cancellare transazioni. Se l utente lo chiede, spiega questo limite.
Non dare consulenza finanziaria professionale: descrivi i dati e segnala con chiarezza le tue inferenze.`;

const fallbackAnswer = async (
  configuration: AiConfiguration,
  context: ToolContext,
  question: string,
) => {
  const [summary, categories, members] = await Promise.all([
    spendingSummary(context, {}),
    spendingByCategory(context, {}),
    memberSpending(context, {}),
  ]);
  const response = await requestAiChatCompletion({
    configuration,
    messages: [
      { role: 'system', content: `${systemPrompt(context.currency)}\nIl modello non dispone di strumenti. Usa soltanto il riepilogo aggregato fornito e dichiara se la domanda richiede dati non presenti.` },
      { role: 'user', content: `Domanda: ${question}\n\nDati aggregati del mese corrente:\n${JSON.stringify({ summary, categories, members })}` },
    ],
    maxTokens: 850,
  });
  return typeof response.content === 'string' ? response.content : '';
};

export const askFinancialAssistant = async ({
  configuration,
  householdId,
  userId,
  currency,
  question,
  history,
}: {
  configuration: AiConfiguration;
  householdId: string;
  userId: string;
  currency: string;
  question: string;
  history: FinancialChatTurn[];
}) => {
  const context = { householdId, userId, currency };
  const messages: AiChatMessage[] = [
    { role: 'system', content: systemPrompt(currency) },
    ...history.slice(-10).map(turn => ({ role: turn.role, content: turn.content } as AiChatMessage)),
    { role: 'user', content: question },
  ];

  try {
    for (let round = 0; round < 6; round += 1) {
      const response = await requestAiChatCompletion({ configuration, messages, tools, maxTokens: 1000 });
      messages.push(response);
      if (!response.tool_calls?.length) {
        const content = typeof response.content === 'string' ? response.content.trim() : '';
        if (!content) throw new AiConnectionError('L assistente non ha restituito una risposta testuale.');
        return content;
      }

      for (const toolCall of response.tool_calls) {
        let result: unknown;
        try {
          result = await executeTool(toolCall.function.name, toolCall.function.arguments, context);
        } catch (error) {
          result = { error: error instanceof Error ? error.message : 'Errore durante la lettura dei dati.' };
        }
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify(result),
        });
      }
    }
    throw new AiConnectionError('L assistente ha richiesto troppi passaggi. Riformula la domanda in modo piu specifico.');
  } catch (error) {
    if (!(error instanceof AiConnectionError)) throw error;
    return fallbackAnswer(configuration, context, question);
  }
};
