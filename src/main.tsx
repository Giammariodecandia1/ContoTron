import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles/globals.css';
import { AuthProvider } from './contexts/AuthContext';
import { HouseholdProvider } from './contexts/HouseholdContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { applyFontScale, getFontScale } from './lib/fontScalePreference';

const redirectLegacyNetlifyOrigin = () => {
  if (window.location.hostname !== 'contotronapp.netlify.app') return false;

  const canonicalUrl = new URL(window.location.href);
  canonicalUrl.protocol = 'https:';
  canonicalUrl.hostname = 'contotron.netlify.app';
  canonicalUrl.port = '';
  window.location.replace(canonicalUrl.toString());
  return true;
};

if (!redirectLegacyNetlifyOrigin()) {
  applyFontScale(getFontScale());

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider>
        <AuthProvider>
          <HouseholdProvider>
            <App />
          </HouseholdProvider>
        </AuthProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
