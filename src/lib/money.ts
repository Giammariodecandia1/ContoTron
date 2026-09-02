import { getMoneyDisplayMode } from './moneyDisplayPreference';

export function formatCurrency(amount: number, currency: string = 'EUR'): string {
  const displayMode = getMoneyDisplayMode();
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency,
    minimumFractionDigits: displayMode === 'always' ? 2 : 0,
    maximumFractionDigits: displayMode === 'whole' ? 0 : 2,
  }).format(amount);
}

export function formatPercentage(value: number, fractionDigits: number = 2): string {
  const displayMode = getMoneyDisplayMode();
  const maximumFractionDigits = displayMode === 'whole' ? 0 : fractionDigits;
  const minimumFractionDigits = displayMode === 'always' ? fractionDigits : 0;
  return `${value.toLocaleString('it-IT', {
    minimumFractionDigits,
    maximumFractionDigits,
  })}%`;
}

export function parseCurrencyInput(value: string): number {
  // Replace comma with dot for decimals, strip out non-numeric chars except dot/minus
  const normalized = value.replace(/,/g, '.').replace(/[^\d.-]/g, '');
  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? 0 : parsed;
}

export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}
