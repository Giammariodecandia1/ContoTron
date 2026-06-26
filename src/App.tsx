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

function App() {
  const { user, loading: authLoading } = useAuth();
  const { household, loading: householdLoading } = useHousehold();

  if (authLoading || (user && householdLoading)) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Caricamento...</div>;
  }

  if (!user) {
    return (
      <BrowserRouter>
        <RouterRoutes>
          <RouterRoute path="/login" element={<LoginPage />} />
          <RouterRoute path="*" element={<LoginPage />} />
        </RouterRoutes>
      </BrowserRouter>
    );
  }

  if (!household) {
    return (
      <BrowserRouter>
        <RouterRoutes>
          <RouterRoute path="/onboarding" element={<OnboardingPage />} />
          <RouterRoute path="*" element={<RouterNavigate to="/onboarding" replace />} />
        </RouterRoutes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
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
    </BrowserRouter>
  );
}

export default App;
