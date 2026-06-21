import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css'; // Just in case
import './styles/globals.css';
import { AuthProvider } from './contexts/AuthContext';
import { HouseholdProvider } from './contexts/HouseholdContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <HouseholdProvider>
        <App />
      </HouseholdProvider>
    </AuthProvider>
  </StrictMode>,
);
