import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes as RouterRoutes, Route as RouterRoute, Navigate as RouterNavigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { NewTransactionPage } from './pages/NewTransactionPage';
import { useAuth, useHousehold } from './hooks';

const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then(module => ({ default: module.OnboardingPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(module => ({ default: module.DashboardPage })));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage').then(module => ({ default: module.TransactionsPage })));
const MonthlyBudgetPage = lazy(() => import('./pages/MonthlyBudgetPage').then(module => ({ default: module.MonthlyBudgetPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(module => ({ default: module.SettingsPage })));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then(module => ({ default: module.CategoriesPage })));
const HouseholdMembersPage = lazy(() => import('./pages/HouseholdMembersPage').then(module => ({ default: module.HouseholdMembersPage })));
const ScanReceiptPage = lazy(() => import('./pages/ScanReceiptPage').then(module => ({ default: module.ScanReceiptPage })));
const DocumentsPage = lazy(() => import('./pages/DocumentsPage').then(module => ({ default: module.DocumentsPage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then(module => ({ default: module.SearchPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(module => ({ default: module.ReportsPage })));
const RecurringRulesPage = lazy(() => import('./pages/RecurringRulesPage').then(module => ({ default: module.RecurringRulesPage })));

function App() {
  const { user } = useAuth();
  const { household } = useHousehold();

  return (
    <BrowserRouter>
      {!user ? (
        <RouterRoutes>
          <RouterRoute path="/login" element={<LoginPage />} />
          <RouterRoute path="*" element={<LoginPage />} />
        </RouterRoutes>
      ) : !household ? (
        <Suspense fallback={null}>
          <RouterRoutes>
            <RouterRoute path="/onboarding" element={<OnboardingPage />} />
            <RouterRoute path="*" element={<RouterNavigate to="/onboarding" replace />} />
          </RouterRoutes>
        </Suspense>
      ) : (
        <AppLayout>
          <Suspense fallback={null}>
            <RouterRoutes>
              <RouterRoute path="/" element={<RouterNavigate to="/transazioni/nuova" replace />} />
              <RouterRoute path="/dashboard" element={<DashboardPage />} />
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
              <RouterRoute path="/impostazioni/spese-fisse" element={<RecurringRulesPage />} />
              <RouterRoute path="*" element={<RouterNavigate to="/transazioni/nuova" replace />} />
            </RouterRoutes>
          </Suspense>
        </AppLayout>
      )}
    </BrowserRouter>
  );
}

export default App;
