import React, { createContext, useContext, useState } from 'react';
import { getViewMode, saveViewMode, type ViewMode } from '../lib/viewModePreference';
import { useAuth } from './AuthContext';

interface ViewModeContextValue {
  mode: ViewMode;
  isSimple: boolean;
  setMode: (mode: ViewMode) => void;
}

const ViewModeContext = createContext<ViewModeContextValue | undefined>(undefined);

export const ViewModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id || null;
  const [preference, setPreference] = useState<{ userId: string | null; mode: ViewMode }>(() => ({
    userId,
    mode: getViewMode(userId),
  }));
  const mode = preference.userId === userId ? preference.mode : getViewMode(userId);

  const setMode = (nextMode: ViewMode) => {
    setPreference({ userId, mode: nextMode });
    saveViewMode(userId, nextMode);
  };

  const value: ViewModeContextValue = {
    mode,
    isSimple: mode === 'simple',
    setMode,
  };

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
};

// Context hooks intentionally live beside their provider.
// eslint-disable-next-line react-refresh/only-export-components
export const useViewMode = () => {
  const context = useContext(ViewModeContext);
  if (!context) throw new Error('useViewMode must be used within a ViewModeProvider');
  return context;
};
