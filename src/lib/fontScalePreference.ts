export type FontScale = 'normal' | 'large' | 'xlarge';

const STORAGE_KEY = 'contotron-font-scale';
const DEFAULT_SCALE: FontScale = 'normal';

const isFontScale = (value: string | null): value is FontScale => (
  value === 'normal' || value === 'large' || value === 'xlarge'
);

export const getFontScale = (): FontScale => {
  if (typeof window === 'undefined') return DEFAULT_SCALE;

  try {
    const savedValue = window.localStorage.getItem(STORAGE_KEY);
    return isFontScale(savedValue) ? savedValue : DEFAULT_SCALE;
  } catch {
    return DEFAULT_SCALE;
  }
};

export const applyFontScale = (scale: FontScale) => {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.fontScale = scale;
};

export const saveFontScale = (scale: FontScale) => {
  applyFontScale(scale);
  try {
    window.localStorage.setItem(STORAGE_KEY, scale);
  } catch {
    // The preference still applies for the current session.
  }
};
