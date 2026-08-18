import React, { createContext, useContext, useState } from 'react';
import { getHiddenNavigationPaths, saveHiddenNavigationPaths } from '../lib/navigationVisibilityPreference';
import { useAuth } from './AuthContext';

interface NavigationVisibilityContextValue {
  hiddenPaths: string[];
  isHidden: (path: string) => boolean;
  togglePath: (path: string) => void;
  resetHiddenPaths: () => void;
}

const NavigationVisibilityContext = createContext<NavigationVisibilityContextValue | undefined>(undefined);

export const NavigationVisibilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id || null;
  const [preference, setPreference] = useState<{ userId: string | null; hiddenPaths: string[] }>(() => ({
    userId,
    hiddenPaths: getHiddenNavigationPaths(userId),
  }));
  const hiddenPaths = preference.userId === userId
    ? preference.hiddenPaths
    : getHiddenNavigationPaths(userId);

  const save = (paths: string[]) => {
    setPreference({ userId, hiddenPaths: paths });
    saveHiddenNavigationPaths(userId, paths);
  };

  const value: NavigationVisibilityContextValue = {
    hiddenPaths,
    isHidden: path => hiddenPaths.includes(path),
    togglePath: path => save(hiddenPaths.includes(path)
      ? hiddenPaths.filter(hiddenPath => hiddenPath !== path)
      : [...hiddenPaths, path]),
    resetHiddenPaths: () => save([]),
  };

  return <NavigationVisibilityContext.Provider value={value}>{children}</NavigationVisibilityContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useNavigationVisibility = () => {
  const context = useContext(NavigationVisibilityContext);
  if (!context) throw new Error('useNavigationVisibility must be used within a NavigationVisibilityProvider');
  return context;
};
