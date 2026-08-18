import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/nunito/latin-700.css';
import App from './App.tsx';
import './styles/globals.css';
import { AuthProvider } from './contexts/AuthContext';
import { HouseholdProvider } from './contexts/HouseholdContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ViewModeProvider } from './contexts/ViewModeContext';
import { NavigationVisibilityProvider } from './contexts/NavigationVisibilityContext';
import { applyFontScale, getFontScale } from './lib/fontScalePreference';

applyFontScale(getFontScale());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <ViewModeProvider>
          <NavigationVisibilityProvider>
            <HouseholdProvider>
              <App />
            </HouseholdProvider>
          </NavigationVisibilityProvider>
        </ViewModeProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
