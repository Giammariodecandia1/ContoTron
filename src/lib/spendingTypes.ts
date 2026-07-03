import type { SpendingType } from '../types/database';

export const spendingTypeLabels: Record<SpendingType, string> = {
  fixed: 'Fissa',
  variable: 'Variabile',
  necessary_variable: 'Variabile necessaria',
  superfluous: 'Superflua',
};

export const spendingTypeOptions: Array<{ value: SpendingType; label: string }> = [
  { value: 'fixed', label: spendingTypeLabels.fixed },
  { value: 'variable', label: spendingTypeLabels.variable },
  { value: 'necessary_variable', label: spendingTypeLabels.necessary_variable },
  { value: 'superfluous', label: spendingTypeLabels.superfluous },
];

export const getSpendingTypeLabel = (value?: string | null) => (
  spendingTypeLabels[(value || 'variable') as SpendingType] || spendingTypeLabels.variable
);
