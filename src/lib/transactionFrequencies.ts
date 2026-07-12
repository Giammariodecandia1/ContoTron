import type { TransactionFrequency } from '../types/database';

export const transactionFrequencyLabels: Record<TransactionFrequency, string> = {
  monthly: 'Mensile',
  bimonthly: 'Bimestrale',
  quarterly: 'Trimestrale',
  four_monthly: 'Quadrimestrale',
  semiannual: 'Semestrale',
  yearly: 'Annuale',
  other: 'Altro',
};

export const transactionFrequencyOptions = Object.entries(transactionFrequencyLabels).map(([value, label]) => ({
  value: value as TransactionFrequency,
  label,
}));

export const getTransactionFrequencyLabel = (value?: string | null) => (
  transactionFrequencyLabels[(value || 'other') as TransactionFrequency] || transactionFrequencyLabels.other
);
