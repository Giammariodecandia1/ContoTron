export type ViewMode = 'complete' | 'simple';

const preferenceKey = (userId: string) => `contotron_view_mode:${userId}`;

export const getViewMode = (userId?: string | null): ViewMode => {
  if (!userId || typeof window === 'undefined') return 'complete';
  return window.localStorage.getItem(preferenceKey(userId)) === 'simple' ? 'simple' : 'complete';
};

export const saveViewMode = (userId: string | null | undefined, mode: ViewMode) => {
  if (!userId || typeof window === 'undefined') return;
  window.localStorage.setItem(preferenceKey(userId), mode);
};
