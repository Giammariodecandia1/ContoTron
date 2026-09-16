import { getCashImpactDate } from './paymentTiming';

export interface AnnualCashFlowTransaction {
  amount: number;
  type: string;
  status?: string | null;
  transaction_date: string;
  cash_impact_date?: string | null;
  payment_method?: string | null;
  description?: string | null;
  merchant?: string | null;
}

export interface CreditCardAdvanceDetail {
  amount: number;
  description: string;
  purchaseDate: string;
}

export interface AnnualCashFlowMonth {
  nominalExpense: number;
  immediateExpense: number;
  recordedIncome: number;
  creditCardAdvance: number;
  creditCardAdvanceDetails: CreditCardAdvanceDetail[];
}

const monthInYear = (dateIso: string | null | undefined, year: number) => {
  if (!dateIso) return null;
  const [dateYear, dateMonth] = dateIso.split('-').map(Number);
  if (dateYear !== year || !Number.isInteger(dateMonth) || dateMonth < 1 || dateMonth > 12) return null;
  return dateMonth;
};

const emptyMonth = (): AnnualCashFlowMonth => ({
  nominalExpense: 0,
  immediateExpense: 0,
  recordedIncome: 0,
  creditCardAdvance: 0,
  creditCardAdvanceDetails: [],
});

/**
 * Keeps competence and cash flow separate:
 * - every expense remains in its purchase month for budgets and reports;
 * - credit-card purchases affect liquidity only once, in the following charge month;
 * - standard payments affect liquidity in their purchase month.
 */
export const summarizeAnnualCashFlow = (
  transactions: AnnualCashFlowTransaction[],
  year: number,
) => {
  const months: Record<number, AnnualCashFlowMonth> = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [index + 1, emptyMonth()]),
  );

  transactions.forEach(transaction => {
    if (transaction.status === 'deleted' || transaction.status === 'rejected') return;
    const amount = Number(transaction.amount || 0);
    if (!Number.isFinite(amount) || amount === 0) return;

    const purchaseMonth = monthInYear(transaction.transaction_date, year);
    if (transaction.type === 'income') {
      if (purchaseMonth) months[purchaseMonth].recordedIncome += amount;
      return;
    }
    if (transaction.type !== 'expense') return;

    if (purchaseMonth) months[purchaseMonth].nominalExpense += amount;

    if (transaction.payment_method === 'credit_card') {
      const chargeDate = transaction.cash_impact_date
        || getCashImpactDate(transaction.transaction_date, 'credit_card');
      const chargeMonth = monthInYear(chargeDate, year);
      if (chargeMonth) {
        months[chargeMonth].creditCardAdvance += amount;
        months[chargeMonth].creditCardAdvanceDetails.push({
          amount,
          description: transaction.description?.trim() || transaction.merchant?.trim() || 'Spesa con carta',
          purchaseDate: transaction.transaction_date,
        });
      }
      return;
    }

    if (purchaseMonth) months[purchaseMonth].immediateExpense += amount;
  });

  Object.values(months).forEach(month => {
    month.creditCardAdvanceDetails.sort((left, right) => (
      left.purchaseDate.localeCompare(right.purchaseDate)
      || left.description.localeCompare(right.description, 'it-IT')
    ));
  });

  return months;
};

export const calculateEffectiveIncome = (
  plannedIncome: number,
  recordedIncome: number,
  creditCardAdvance: number,
) => {
  const grossIncome = recordedIncome > 0 ? recordedIncome : plannedIncome;
  return grossIncome - creditCardAdvance;
};
