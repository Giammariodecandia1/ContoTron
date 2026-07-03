import type { PaymentMethod } from '../types/database';

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  standard: 'Pagamento immediato',
  credit_card: 'Carta di credito',
};

export const paymentMethodOptions: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'standard', label: paymentMethodLabels.standard },
  { value: 'credit_card', label: paymentMethodLabels.credit_card },
];

const toDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getCashImpactDate = (transactionDate: string, paymentMethod: PaymentMethod) => {
  if (paymentMethod !== 'credit_card') return transactionDate;

  const date = new Date(`${transactionDate}T00:00:00`);
  return toDateString(new Date(date.getFullYear(), date.getMonth() + 1, 1));
};
