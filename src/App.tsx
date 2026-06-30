import { useEffect, useRef, useState } from 'react';
// Removed bad react-dom import
import { BrowserRouter, Routes as RouterRoutes, Route as RouterRoute, Navigate as RouterNavigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { LoginPage } from './pages/LoginPage';

import { MonthlyBudgetPage } from './pages/MonthlyBudgetPage';
import { SettingsPage } from './pages/SettingsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { HouseholdMembersPage } from './pages/HouseholdMembersPage';
import { ScanReceiptPage } from './pages/ScanReceiptPage';
import { NewTransactionPage } from './pages/NewTransactionPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { SearchPage } from './pages/SearchPage';
import { ReportsPage } from './pages/ReportsPage';
import { useAuth, useHousehold } from './hooks';

const DEBUG_BUILD = 'loading-debug-2026-06-30';
const DEBUG_STORAGE_KEY = 'contotron_debug_loading_enabled';
const FORCE_LOADING_DEBUG = true;

type LoadingDebugPanelProps = {
  authLoading: boolean;
  hasUser: boolean;
  householdLoading: boolean;
  hasHousehold: boolean;
  isBootstrapping: boolean;
  initialRouteResolved: boolean;
};

const getSessionNumber = (key: string) => {
  const value = Number(window.sessionStorage.getItem(key) || '0');
  return Number.isFinite(value) ? value : 0;
};

const getDebugLoadingEnabled = () => {
  if (FORCE_LOADING_DEBUG) return true;

  const params = new URLSearchParams(window.location.search);
  const debugParam = params.get('debugLoading');

  if (debugParam === '0') {
    window.localStorage.removeItem(DEBUG_STORAGE_KEY);
    return false;
  }

  if (params.has('debugLoading')) {
    window.localStorage.setItem(DEBUG_STORAGE_KEY, '1');
    return true;
  }

  return window.localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
};

const LoadingDebugPanel = ({
  authLoading,
  hasUser,
  householdLoading,
  hasHousehold,
  isBootstrapping,
  initialRouteResolved,
}: LoadingDebugPanelProps) => {
  const [tick, setTick] = useState(0);
  const bootTimeRef = useRef(Date.now());
  const reloadCountRef = useRef(0);
  const firstLoadRef = useRef('');

  useEffect(() => {
    const nextReloadCount = getSessionNumber('contotron_debug_reload_count') + 1;
    reloadCountRef.current = nextReloadCount;
    firstLoadRef.current = new Date().toLocaleTimeString('it-IT');
    window.sessionStorage.setItem('contotron_debug_reload_count', String(nextReloadCount));
    window.sessionStorage.setItem('contotron_debug_last_load', new Date().toISOString());

    const beforeUnload = () => {
      window.sessionStorage.setItem('contotron_debug_last_unload', new Date().toISOString());
    };

    window.addEventListener('beforeunload', beforeUnload);
    const timer = window.setInterval(() => setTick(value => value + 1), 1000);

    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.clearInterval(timer);
    };
  }, []);

  const uptimeSeconds = Math.floor((Date.now() - bootTimeRef.current) / 1000);
  const lastUnload = window.sessionStorage.getItem('contotron_debug_last_unload') || '-';
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;

  return (
    <div
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        zIndex: 99999,
        width: 320,
        maxWidth: 'calc(100vw - 24px)',
        background: '#111827',
        color: '#e5e7eb',
        border: '1px solid #374151',
        borderRadius: 8,
        padding: 12,
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: 1.45,
        boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Debug caricamento</div>
      <div>build: {DEBUG_BUILD}</div>
      <div>route: {window.location.pathname}</div>
      <div>reload pagina: {reloadCountRef.current}</div>
      <div>uptime: {uptimeSeconds}s / tick {tick}</div>
      <div>load ora: {firstLoadRef.current || '-'}</div>
      <div>last unload: {lastUnload}</div>
      <div>nav type: {navigation?.type || '-'}</div>
      <div>authLoading: {String(authLoading)} / user: {String(hasUser)}</div>
      <div>householdLoading: {String(householdLoading)} / household: {String(hasHousehold)}</div>
      <div>bootstrapping: {String(isBootstrapping)} / resolved: {String(initialRouteResolved)}</div>
    </div>
  );
};

function App() {
  const { user, loading: authLoading } = useAuth();
  const { household, loading: householdLoading } = useHousehold();
  const initialRouteResolved = useRef(false);
  const lastUserRef = useRef(user);
  const lastHouseholdRef = useRef(household);
  const [debugLoading] = useState(() => getDebugLoadingEnabled());
  const isAuthBootstrapping = authLoading && !user;
  const isHouseholdBootstrapping = !!user && householdLoading && !household;
  const isBootstrapping = isAuthBootstrapping || isHouseholdBootstrapping;

  if (user) {
    lastUserRef.current = user;
  } else if (!authLoading) {
    lastUserRef.current = null;
  }

  if (household) {
    lastHouseholdRef.current = household;
  } else if (!householdLoading) {
    lastHouseholdRef.current = null;
  }

  const stableUser = user || (authLoading ? lastUserRef.current : null);
  const stableHousehold = household || (householdLoading ? lastHouseholdRef.current : null);

  useEffect(() => {
    if (!isBootstrapping) {
      initialRouteResolved.current = true;
    }
  }, [isBootstrapping]);

  const debugPanel = debugLoading ? (
    <LoadingDebugPanel
      authLoading={authLoading}
      hasUser={!!stableUser}
      householdLoading={householdLoading}
      hasHousehold={!!stableHousehold}
      isBootstrapping={isBootstrapping}
      initialRouteResolved={initialRouteResolved.current}
    />
  ) : null;

  return (
    <BrowserRouter>
      {!stableUser ? (
        <RouterRoutes>
          <RouterRoute path="/login" element={<LoginPage />} />
          <RouterRoute path="*" element={<LoginPage />} />
        </RouterRoutes>
      ) : !stableHousehold ? (
        <RouterRoutes>
          <RouterRoute path="/onboarding" element={<OnboardingPage />} />
          <RouterRoute path="*" element={<RouterNavigate to="/onboarding" replace />} />
        </RouterRoutes>
      ) : (
        <AppLayout>
          <RouterRoutes>
            <RouterRoute path="/" element={<DashboardPage />} />
            <RouterRoute path="/transazioni" element={<TransactionsPage />} />
            <RouterRoute path="/transazioni/nuova" element={<NewTransactionPage />} />
            <RouterRoute path="/transazioni/:transactionId/modifica" element={<NewTransactionPage />} />
            <RouterRoute path="/mensile" element={<MonthlyBudgetPage />} />
            <RouterRoute path="/documenti" element={<DocumentsPage />} />
            <RouterRoute path="/ricerca" element={<SearchPage />} />
            <RouterRoute path="/report" element={<ReportsPage />} />
            <RouterRoute path="/scan" element={<ScanReceiptPage />} />
            <RouterRoute path="/impostazioni" element={<SettingsPage />} />
            <RouterRoute path="/impostazioni/categorie" element={<CategoriesPage />} />
            <RouterRoute path="/impostazioni/nucleo" element={<HouseholdMembersPage />} />
            <RouterRoute path="*" element={<RouterNavigate to="/" replace />} />
          </RouterRoutes>
        </AppLayout>
      )}
      {debugPanel}
    </BrowserRouter>
  );
}

export default App;
