export interface NavigationVisibilityOption {
  path: string;
  label: string;
  requiresAi?: boolean;
}

export const navigationVisibilityOptions: NavigationVisibilityOption[] = [
  { path: '/transazioni', label: 'Transazioni' },
  { path: '/split', label: 'Split' },
  { path: '/report', label: 'Consuntivo mensile' },
  { path: '/mensile', label: 'Budget mensile' },
  { path: '/analisi-annuale', label: 'Analisi annuale' },
  { path: '/analisi-alimentari', label: 'Analisi alimentari' },
  { path: '/documenti', label: 'Documenti' },
  { path: '/ricerca', label: 'Ricerca' },
  { path: '/scan', label: 'Scansiona scontrino' },
  { path: '/assistente', label: 'Assistente AI', requiresAi: true },
];

const storageKey = (userId?: string | null) => `contotron_hidden_navigation_${userId || 'anonymous'}`;

export const getHiddenNavigationPaths = (userId?: string | null): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(userId)) || '[]');
    return Array.isArray(value)
      ? value.filter((path): path is string => typeof path === 'string')
      : [];
  } catch {
    return [];
  }
};

export const saveHiddenNavigationPaths = (userId: string | null | undefined, paths: string[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(userId), JSON.stringify([...new Set(paths)]));
};
