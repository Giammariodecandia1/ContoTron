export type MoneyDisplayMode = 'always' | 'automatic' | 'whole';

const STORAGE_KEY = 'contotron-money-display-mode';
const EVENT_NAME = 'contotron-money-display-mode-changed';

const isMoneyDisplayMode = (value: string | null): value is MoneyDisplayMode => (
  value === 'always' || value === 'automatic' || value === 'whole'
);

export const getMoneyDisplayMode = (): MoneyDisplayMode => {
  if (typeof window === 'undefined') return 'always';
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isMoneyDisplayMode(value) ? value : 'always';
  } catch {
    return 'always';
  }
};

export const saveMoneyDisplayMode = (mode: MoneyDisplayMode) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // La preferenza resta attiva per la pagina corrente.
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: mode }));
};

export const moneyDisplayModeEvent = EVENT_NAME;
