export const resolvePlannedIncome = (
  sourceAmount: number,
  hasSource: boolean,
  targetAmount: number | undefined,
  manualOverride: boolean,
): number => (manualOverride || !hasSource ? targetAmount || 0 : sourceAmount);
