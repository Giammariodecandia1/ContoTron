export function formatCurrency(amount: number, currency: string = 'EUR'): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency,
  }).format(amount);
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
